#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Diagnostic } from "../contracts/diagnostics";
import { formatDiagnostic, hasErrors } from "../contracts/diagnostics";
import type { TargetId } from "../contracts/interfaces";
import { TARGET_IDS } from "../contracts/interfaces";
import type { Profile } from "../contracts/profile";
import { COMPILER_VERSION, CORE_VERSION } from "../contracts/version";
import { emit } from "../backends";
import { loadProfileFile, STANDARD_PROFILE } from "../frontend/profile";
import { compileAndRun, materializeProject } from "../harness/project";
import { detectToolchains } from "../harness/toolchain";
import { loadProgram } from "../pipeline";
import { evaluate } from "../reference/interpreter";
import { chooseEntry } from "../semantic/entry";
import { exportSyntax, importSyntax } from "../syntax/transfer";
import { runConformance } from "../testing/conformance";
import { runBridge } from "../service/bridge";

interface Cli {
  positionals: string[];
  flags: Map<string, string | boolean>;
}

const BOOLEAN_FLAGS = new Set([
  "json",
  "dry-run",
  "all-targets",
  "quick",
  "run",
  "help",
  "version",
  "quiet",
]);

function parseCli(argv: string[]): Cli {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      if (equals >= 0) {
        flags.set(arg.slice(2, equals), arg.slice(equals + 1));
        continue;
      }
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags.set(key, true);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

function flagString(cli: Cli, key: string): string | undefined {
  const value = cli.flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function flagBool(cli: Cli, key: string): boolean {
  return cli.flags.get(key) === true;
}

function printDiagnostics(diagnostics: Diagnostic[], json: boolean): void {
  if (json) return;
  for (const diagnostic of diagnostics) {
    console.error(formatDiagnostic(diagnostic));
  }
}

function loadProfileOrExit(path: string | undefined): Profile {
  if (!path) return STANDARD_PROFILE;
  const result = loadProfileFile(path);
  if (!result.loaded) {
    printDiagnostics(result.diagnostics, false);
    process.exit(1);
  }
  return result.loaded.profile;
}

function targetFrom(value: string | undefined): TargetId {
  if (!value) throw new Error("missing --target (csharp, rust, go, or java)");
  if (!(TARGET_IDS as readonly string[]).includes(value)) {
    throw new Error(`unknown target "${value}"`);
  }
  return value as TargetId;
}

function parseArgsFlag(value: string | undefined): (number | boolean)[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      if (part === "true") return true;
      if (part === "false") return false;
      const number = Number(part);
      if (!Number.isSafeInteger(number)) throw new Error(`argument "${part}" is neither an integer nor a boolean`);
      if (number < -2147483648 || number > 2147483647) {
        throw new Error(`argument "${part}" is outside the i32 range`);
      }
      return number;
    });
}

function main(argv: string[]): number {
  const cli = parseCli(argv);
  const command = cli.positionals[0];

  if (command === undefined || command === "help" || flagBool(cli, "help")) {
    console.log(usage());
    return 0;
  }
  if (command === "version" || flagBool(cli, "version")) {
    console.log(`hs ${COMPILER_VERSION} (core ${CORE_VERSION})`);
    return 0;
  }

  switch (command) {
    case "check":
      return commandCheck(cli);
    case "build":
      return commandBuild(cli);
    case "syntax":
      return commandSyntax(cli);
    case "test":
      return commandTest(cli);
    case "doctor":
      return commandDoctor(cli);
    case "demo":
      return commandDemo(cli);
    case "bridge":
      return commandBridge();
    default:
      console.error(`unknown command "${command}"`);
      console.error(usage());
      return 2;
  }
}

function commandCheck(cli: Cli): number {
  const file = cli.positionals[1];
  if (!file) throw new Error("usage: hs check <file> [--profile <profile.json>]");
  const profile = loadProfileOrExit(flagString(cli, "profile"));
  const loaded = loadProgram(file, profile);
  const json = flagBool(cli, "json");
  const ok = !hasErrors(loaded.diagnostics) && loaded.typed !== undefined;
  if (json) {
    console.log(
      JSON.stringify(
        {
          file,
          profile: profile.id,
          ok,
          diagnostics: loaded.diagnostics,
          functions: loaded.typed?.functions.map((fn) => fn.name) ?? [],
        },
        null,
        2,
      ),
    );
  } else {
    printDiagnostics(loaded.diagnostics, false);
    if (ok) {
      console.log(
        `ok: ${file} (profile ${profile.id}, ${loaded.typed!.functions.length} function(s), core ${CORE_VERSION})`,
      );
    }
  }
  return ok ? 0 : 1;
}

function commandBuild(cli: Cli): number {
  const file = cli.positionals[1];
  if (!file) throw new Error("usage: hs build <file> --target <csharp|rust|go|java>");
  const target = targetFrom(flagString(cli, "target"));
  const profile = loadProfileOrExit(flagString(cli, "profile"));
  const loaded = loadProgram(file, profile);
  const json = flagBool(cli, "json");
  if (!loaded.typed) {
    printDiagnostics(loaded.diagnostics, json);
    if (json) console.log(JSON.stringify({ ok: false, diagnostics: loaded.diagnostics }, null, 2));
    return 1;
  }
  const entryChoice = chooseEntry(loaded.typed, flagString(cli, "entry"));
  if (!entryChoice.entry) {
    const diagnostic = entryChoice.diagnostic!;
    printDiagnostics([diagnostic], json);
    if (json) console.log(JSON.stringify({ ok: false, diagnostics: [diagnostic] }, null, 2));
    return 1;
  }
  const entry = entryChoice.entry;
  const out = flagString(cli, "out") ?? resolve("build", basename(file).replace(/\.[^.]+$/, ""), target);
  const project = emit(loaded.typed, target, entry);
  materializeProject(project, out);

  if (flagBool(cli, "run")) {
    const result = compileAndRun(
      loaded.typed,
      target,
      entry,
      parseArgsFlag(flagString(cli, "args")),
      out,
      process.cwd(),
    );
    if (json) {
      console.log(JSON.stringify({ target, entry, ...result }, null, 2));
    } else {
      console.error(result.buildLog);
      if (result.status === "blocked" || result.status === "build-failed" || result.status === "run-failed") {
        console.error(`verification ${result.status}: ${result.detail ?? ""}`);
      } else {
        console.log(JSON.stringify(result.outcome));
      }
    }
    return result.status === "ok" || result.status === "error" ? 0 : result.status === "blocked" ? 2 : 1;
  }

  if (json) {
    console.log(JSON.stringify({ target, directory: out, entry, files: project.files.map((f) => f.path) }, null, 2));
  } else {
    printDiagnostics(loaded.diagnostics, false);
    console.log(`generated ${target} project for ${entry} in ${out}`);
    for (const generated of project.files) console.log(`  ${generated.path}`);
    console.log(`build: ${project.build.join(" ")}`);
  }
  return 0;
}

function commandSyntax(cli: Cli): number {
  const subcommand = cli.positionals[1];
  if (subcommand === "export") return commandExport(cli);
  if (subcommand === "import") return commandImport(cli);
  throw new Error("usage: hs syntax <export|import> ...");
}

function commandExport(cli: Cli): number {
  const file = cli.positionals[2];
  const profile = flagString(cli, "profile");
  const out = flagString(cli, "out");
  if (!file || !profile || !out) {
    throw new Error(
      "usage: hs syntax export <canonical.hs> --profile <profile.json> --out <personal.hs> [--manifest <file>]",
    );
  }
  const result = exportSyntax({
    sourceFile: file,
    profileFile: profile,
    outputFile: out,
    manifestFile: flagString(cli, "manifest"),
  });
  const json = flagBool(cli, "json");
  if (hasErrors(result.diagnostics) || !result.manifest) {
    printDiagnostics(result.diagnostics, json);
    if (json) console.log(JSON.stringify({ ok: false, diagnostics: result.diagnostics }, null, 2));
    return 1;
  }
  if (json) {
    console.log(
      JSON.stringify(
        { ok: true, output: out, manifest: result.manifestPath, manifestData: result.manifest },
        null,
        2,
      ),
    );
  } else {
    console.log(`exported ${file} -> ${out}`);
    console.log(`manifest: ${result.manifestPath}`);
    console.log(`profile: ${result.manifest.profile.id} (${result.manifest.profile.fingerprint})`);
    console.log(`base:    ${result.manifest.canonical.fingerprint}`);
  }
  return 0;
}

function commandImport(cli: Cli): number {
  const file = cli.positionals[2];
  if (!file) {
    throw new Error("usage: hs syntax import <personal.hs> [--manifest <file>] [--dry-run]");
  }
  const dryRun = flagBool(cli, "dry-run");
  const result = importSyntax({
    personalFile: file,
    manifestFile: flagString(cli, "manifest"),
    dryRun,
  });
  const json = flagBool(cli, "json");
  if (hasErrors(result.diagnostics)) {
    printDiagnostics(result.diagnostics, json);
    if (json) console.log(JSON.stringify({ ok: false, diagnostics: result.diagnostics }, null, 2));
    return 1;
  }
  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          canonical: result.canonicalPath,
          applied: result.applied,
          dryRun,
          diff: result.diff,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  console.log(result.diff ?? "");
  if (result.nextText === result.previousText) {
    console.log("no changes");
  } else if (dryRun) {
    console.log(`dry run: canonical source ${result.canonicalPath} was not modified`);
  } else {
    console.log(`imported changes into ${result.canonicalPath}`);
  }
  return 0;
}

function commandTest(cli: Cli): number {
  const targetList = flagString(cli, "targets");
  const targets = targetList
    ? (targetList.split(",").map((part) => part.trim()) as TargetId[])
    : ([...TARGET_IDS] as TargetId[]);
  for (const target of targets) {
    if (!(TARGET_IDS as readonly string[]).includes(target)) throw new Error(`unknown target "${target}"`);
  }
  const root = flagString(cli, "root") ?? process.cwd();
  const reportDir = flagString(cli, "report-dir") ?? resolve(root, "reports");
  const result = runConformance({
    root,
    manifestPath: flagString(cli, "manifest"),
    targets,
    quick: flagBool(cli, "quick"),
    reportDir,
    quiet: flagBool(cli, "quiet"),
  });
  if (flagBool(cli, "json")) {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    console.log(result.text);
    console.log(
      `summary: ${result.report.summary.failed} failed, ${result.report.summary.blocked} blocked; report written to ${reportDir}`,
    );
  }
  return result.exitCode;
}

function commandDoctor(cli: Cli): number {
  const toolchains = detectToolchains(process.cwd());
  const payload = {
    schema: "hs-environment/1",
    generatedAt: new Date().toISOString(),
    compilerVersion: COMPILER_VERSION,
    coreVersion: CORE_VERSION,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    toolchains,
  };
  mkdirSync(resolve("reports"), { recursive: true });
  writeFileSync(resolve("reports", "environment.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  if (flagBool(cli, "json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Node ${process.version} on ${process.platform}-${process.arch}`);
    for (const tool of toolchains) {
      console.log(
        `${tool.available ? "available" : "BLOCKED  "} ${tool.target.padEnd(7)} ${tool.name.padEnd(14)} ${tool.version}`,
      );
      if (!tool.available && tool.detail) console.log(`          ${tool.detail.split("\n")[0]}`);
    }
    console.log(`written: reports/environment.json`);
  }
  return toolchains.every((tool) => tool.available) ? 0 : 2;
}

function commandDemo(_cli: Cli): number {  const root = process.cwd();
  const work = resolve(root, "local", "demo");
  mkdirSync(work, { recursive: true });
  const canonical = resolve(work, "calculate.hs");
  const personal = resolve(work, "calculate.personal.hs");
  const profile = resolve(root, "profiles", "my-syntax.json");
  const source = resolve(root, "examples", "calculate.hs");
  copyFileSync(source, canonical);

  const exported = exportSyntax({ sourceFile: canonical, profileFile: profile, outputFile: personal });
  if (!exported.manifest) {
    printDiagnostics(exported.diagnostics, false);
    return 1;
  }
  console.log(`1. exported canonical source to ${personal} (profile my-syntax)`);

  const personalText = readFileSync(personal, "utf8");
  const edited = personalText.replace("give base + 2;", "give base + 3; // personal edit");
  if (edited === personalText) {
    console.error("demo: expected edit target was not found in the exported personal source");
    return 1;
  }
  writeFileSync(personal, edited, "utf8");
  console.log("2. edited the personal notation (base + 2 -> base + 3)");

  const imported = importSyntax({ personalFile: personal });
  if (hasErrors(imported.diagnostics)) {
    printDiagnostics(imported.diagnostics, false);
    return 1;
  }
  console.log(`3. reimported the edit into ${imported.canonicalPath}`);

  const loaded = loadProgram(canonical, STANDARD_PROFILE);
  if (!loaded.typed) {
    printDiagnostics(loaded.diagnostics, false);
    return 1;
  }
  const entry = chooseEntry(loaded.typed, "calculate").entry!;
  const reference = evaluate(loaded.typed, entry, { values: [10, true] });
  console.log(`4. reference interpreter: ${JSON.stringify(reference)}`);
  if (reference.status !== "ok" || reference.value !== 33) {
    console.error("demo: reference result is not the expected 33");
    return 1;
  }

  let failures = 0;
  let blocked = 0;
  for (const target of TARGET_IDS) {
    const result = compileAndRun(
      loaded.typed,
      target,
      entry,
      [10, true],
      resolve(work, "build", target),
      root,
    );
    if (result.status === "blocked") {
      blocked++;
      console.log(`5. ${target.padEnd(7)} blocked: ${result.detail}`);
    } else if (result.status === "ok" || result.status === "error") {
      const outcome = result.outcome!;
      const replaced = outcome.status === "ok" && outcome.value === 33;
      const check = outcome.status === "error" ? `failure ${outcome.code} (unexpected)` : replaced ? "matches 33" : "MISMATCH";
      console.log(`5. ${target.padEnd(7)} ${JSON.stringify(outcome)} ${check}`);
      if (!replaced) failures++;
    } else {
      failures++;
      console.log(`5. ${target.padEnd(7)} ${result.status}: ${result.detail}`);
      console.log(result.buildLog.split("\n").slice(-12).join("\n"));
    }
  }
  if (failures > 0) return 1;
  return blocked > 0 ? 2 : 0;
}

function commandBridge(): number {
  runBridge();
  return 0;
}

function usage(): string {
  return `hs ${COMPILER_VERSION} - shared program meaning, personal syntax, four targets

Usage:
  hs check <file> [--profile <profile.json>] [--json]
  hs build <file> --target <csharp|rust|go|java> [--out <dir>]
            [--entry <function>] [--profile <profile.json>] [--run] [--args a,b]
  hs syntax export <canonical.hs> --profile <profile.json> --out <personal.hs>
            [--manifest <file>]
  hs syntax import <personal.hs> [--manifest <file>] [--dry-run]
  hs test [--all-targets] [--targets csharp,rust,go,java] [--quick]
            [--report-dir <dir>] [--json]
  hs doctor [--json]
  hs demo
  hs bridge

Canonical source uses the standard profile. A profile is always selected
explicitly; there is no implicit personal preference.

Editor integration:
  hs bridge   line-delimited JSON over stdin/stdout for live analysis and
              generated-code preview. See editors/visual-studio/README.md.`;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (cause) {
  console.error(`hs: ${(cause as Error).message}`);
  process.exitCode = 2;
}
