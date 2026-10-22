import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizeAst } from "../contracts/ast";
import { formatDiagnostic } from "../contracts/diagnostics";
import type { TargetId } from "../contracts/interfaces";
import type { Outcome } from "../contracts/outcome";
import { CORE_VERSION, COMPILER_VERSION } from "../contracts/version";
import { emit } from "../backends";
import { convert } from "../frontend/convert";
import { loadProfileFile, STANDARD_PROFILE } from "../frontend/profile";
import { buildProject, materializeProject, runBuiltProject } from "../harness/project";
import { detectToolchains } from "../harness/toolchain";
import { analyze, loadSource } from "../pipeline";
import { evaluate } from "../reference/interpreter";
import { chooseEntry } from "../semantic/entry";

export interface ExpectedOutcome {
  status: "ok" | "error";
  type?: "i32" | "bool";
  value?: number | boolean;
  code?: string;
  /** Optional independently pinned failing source-node id. */
  node?: number;
}

export interface PositiveCase {
  id: string;
  program: string;
  entry?: string;
  args?: (number | boolean)[];
  expected: ExpectedOutcome;
  notes?: string;
}

export interface NegativeCase {
  id: string;
  kind?: "program" | "profile";
  program?: string;
  profile?: string;
  expectDiagnostic: string;
  notes?: string;
}

export interface ConformanceManifest {
  schema: string;
  profiles: string[];
  cases: PositiveCase[];
  negative: NegativeCase[];
}

export interface ProfileReport {
  id: string;
  structure: boolean;
  roundTrip: boolean;
  diagnostics: string[];
}

export interface TargetReport {
  target: TargetId;
  profile: string;
  status: "passed" | "failed" | "blocked";
  outcome?: Outcome;
  detail?: string;
}

export interface CaseReport {
  id: string;
  notes?: string;
  reference: {
    status: "passed" | "failed";
    expected: ExpectedOutcome;
    outcome?: Outcome;
    detail?: string;
  };
  profiles: ProfileReport[];
  targets: TargetReport[];
}

export interface NegativeReport {
  id: string;
  status: "passed" | "failed";
  expectedDiagnostic: string;
  diagnostics: string[];
  detail?: string;
}

export interface ConformanceReport {
  schema: string;
  mode: "full" | "interpreter-only";
  generatedAt: string;
  compilerVersion: string;
  coreVersion: string;
  nodeVersion: string;
  profiles: { id: string; path: string }[];
  toolchains: ReturnType<typeof detectToolchains>;
  cases: CaseReport[];
  negative: NegativeReport[];
  summary: {
    cases: number;
    targets: number;
    passed: number;
    failed: number;
    blocked: number;
  };
}

export interface ConformanceOptions {
  root: string;
  manifestPath?: string;
  targets: TargetId[];
  quick?: boolean;
  reportDir?: string;
  quiet?: boolean;
}

export function runConformance(options: ConformanceOptions): { report: ConformanceReport; text: string; exitCode: number } {
  const root = resolve(options.root);
  const manifestPath = options.manifestPath
    ? resolve(options.manifestPath)
    : resolve(root, "tests", "conformance", "cases.json");
  const manifestDir = dirname(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ConformanceManifest;
  if (manifest.schema !== "hs-conformance/1") {
    throw new Error(`unsupported conformance schema "${String(manifest.schema)}"`);
  }
  if (!Array.isArray(manifest.profiles) || manifest.profiles.length === 0) {
    throw new Error("conformance manifest must declare at least one profile");
  }

  const profiles = manifest.profiles.map((relative) => {
    const path = resolve(manifestDir, relative);
    const loaded = loadProfileFile(path);
    if (!loaded.loaded) {
      throw new Error(
        `conformance profile "${path}" is invalid:\n${loaded.diagnostics.map(formatDiagnostic).join("\n")}`,
      );
    }
    return loaded.loaded.profile;
  });
  const standard = profiles.find((profile) => profile.id === "standard") ?? STANDARD_PROFILE;

  const toolchains = detectToolchains(root);
  const caseReports: CaseReport[] = [];
  const negativeReports: NegativeReport[] = [];
  const buildCache = new Map<
    string,
    | { kind: "blocked"; detail: string }
    | { kind: "build-failed"; detail: string }
    | { kind: "built"; project: ReturnType<typeof emit>; directory: string }
  >();

  for (const testCase of manifest.cases) {
    if (!options.quiet) process.stderr.write(`case ${testCase.id}\n`);
    const report: CaseReport = {
      id: testCase.id,
      notes: testCase.notes,
      reference: { status: "failed", expected: testCase.expected },
      profiles: [],
      targets: [],
    };

    const programPath = resolve(manifestDir, testCase.program);
    const source = loadSource(programPath);
    const loaded = analyze(source.text ?? "", programPath, standard);
    if (!loaded.typed || !loaded.program || !loaded.tokens) {
      report.reference.detail = `source did not compile:\n${loaded.diagnostics.map(formatDiagnostic).join("\n")}`;
      caseReports.push(report);
      continue;
    }

    const entryChoice = chooseEntry(loaded.typed, testCase.entry);
    if (!entryChoice.entry) {
      report.reference.detail = entryChoice.diagnostic?.message ?? "entry function unavailable";
      caseReports.push(report);
      continue;
    }
    const entry = entryChoice.entry;

    let referenceOutcome: Outcome | undefined;
    try {
      referenceOutcome = evaluate(loaded.typed, entry, { values: testCase.args ?? [] });
      report.reference.outcome = referenceOutcome;
      report.reference.status = matchesExpected(testCase.expected, referenceOutcome) ? "passed" : "failed";
      if (report.reference.status === "failed") {
        report.reference.detail = "reference interpreter disagreed with the independently specified expectation";
      }
    } catch (cause) {
      report.reference.detail = `reference interpreter error: ${(cause as Error).message}`;
      caseReports.push(report);
      continue;
    }

    // Structural equivalence and round-trip preservation for every profile.
    for (const profile of profiles) {
      report.profiles.push(checkProfileEquivalence(loaded.program, loaded.tokens.text, profile));
    }

    if (!options.quick) {
      const targets = options.targets;
      for (const target of targets) {
        const cacheKey = `${programPath}|${entry}|${target}`;
        let entryState = buildCache.get(cacheKey);
        if (!entryState) {
          const toolchain = toolchains.find((item) => item.target === target);
          if (!toolchain?.available) {
            entryState = {
              kind: "blocked",
              detail: `${toolchain?.name ?? target} is unavailable: ${toolchain?.detail || toolchain?.version || "not detected"}`,
            };
          } else {
            const buildDir = resolve(root, "build", "conformance", testCase.id, target);
            try {
              const project = emit(loaded.typed, target, entry);
              materializeProject(project, buildDir);
              const build = buildProject(project, buildDir);
              entryState = build.ok
                ? { kind: "built", project, directory: buildDir }
                : { kind: "build-failed", detail: `generated project did not compile:\n${tail(build.log, 40)}` };
            } catch (cause) {
              entryState = { kind: "build-failed", detail: (cause as Error).message };
            }
          }
          buildCache.set(cacheKey, entryState);
        }

        if (entryState.kind === "blocked") {
          for (const profile of profiles) {
            report.targets.push({
              target,
              profile: profile.id,
              status: "blocked",
              detail: entryState.detail,
            });
          }
          continue;
        }
        if (entryState.kind === "build-failed") {
          for (const profile of profiles) {
            report.targets.push({
              target,
              profile: profile.id,
              status: "failed",
              detail: entryState.detail,
            });
          }
          continue;
        }

        for (const profile of profiles) {
          const run = runBuiltProject(entryState.project, entryState.directory, testCase.args ?? []);
          if (run.status === "run-failed") {
            report.targets.push({
              target,
              profile: profile.id,
              status: "failed",
              detail: `generated program did not produce an outcome:\n${tail(run.log, 20)}`,
            });
            continue;
          }
          const passed =
            run.outcome !== undefined &&
            matchesExpected(testCase.expected, run.outcome, referenceOutcome);
          report.targets.push({
            target,
            profile: profile.id,
            status: passed ? "passed" : "failed",
            outcome: run.outcome,
            detail: passed ? undefined : `expected ${JSON.stringify(testCase.expected)}`,
          });
        }
      }
    }

    caseReports.push(report);
  }

  for (const negative of manifest.negative) {
    if (!options.quiet) process.stderr.write(`negative ${negative.id}\n`);
    if (negative.kind === "profile") {
      const path = resolve(manifestDir, negative.profile ?? "");
      const loaded = loadProfileFile(path);
      const codes = loaded.diagnostics.map((d) => d.code);
      const passed = loaded.loaded === undefined && codes.includes(negative.expectDiagnostic);
      negativeReports.push({
        id: negative.id,
        status: passed ? "passed" : "failed",
        expectedDiagnostic: negative.expectDiagnostic,
        diagnostics: loaded.diagnostics.map(formatDiagnostic),
        detail: passed
          ? undefined
          : `expected diagnostic ${negative.expectDiagnostic}; received ${codes.join(", ") || "<none>"}`,
      });
      continue;
    }

    const programPath = resolve(manifestDir, negative.program ?? "");
    const source = loadSource(programPath);
    const loaded = analyze(source.text ?? "", programPath, standard);
    const codes = loaded.diagnostics.map((d) => d.code);
    const passed =
      !loaded.typed &&
      loaded.diagnostics.some((d) => d.code === negative.expectDiagnostic && d.severity === "error");
    negativeReports.push({
      id: negative.id,
      status: passed ? "passed" : "failed",
      expectedDiagnostic: negative.expectDiagnostic,
      diagnostics: loaded.diagnostics.map(formatDiagnostic),
      detail: passed
        ? undefined
        : `expected diagnostic ${negative.expectDiagnostic}; received ${codes.join(", ") || "<none>"}`,
    });
  }

  const targetRows = caseReports.flatMap((report) => report.targets);
  const passedRows = targetRows.filter((row) => row.status === "passed").length;
  const blockedRows = targetRows.filter((row) => row.status === "blocked").length;
  const failedCases = caseReports.filter(
    (report) =>
      report.reference.status !== "passed" ||
      report.profiles.some(
        (profile) => !profile.structure || !profile.roundTrip || profile.diagnostics.length > 0,
      ),
  ).length;
  const failedNegative = negativeReports.filter((report) => report.status !== "passed").length;
  const failedRows = targetRows.filter((row) => row.status === "failed").length;
  const failed = failedRows + failedCases + failedNegative;

  const report: ConformanceReport = {
    schema: "hs-conformance-report/1",
    mode: options.quick ? "interpreter-only" : "full",
    generatedAt: new Date().toISOString(),
    compilerVersion: COMPILER_VERSION,
    coreVersion: CORE_VERSION,
    nodeVersion: process.version,
    profiles: profiles.map((profile) => ({ id: profile.id, path: profile.path ?? "" })),
    toolchains,
    cases: caseReports,
    negative: negativeReports,
    summary: {
      cases: caseReports.length,
      targets: targetRows.length,
      passed:
        passedRows + (caseReports.length - failedCases) + (negativeReports.length - failedNegative),
      failed,
      blocked: blockedRows,
    },
  };

  const reportDir = resolve(options.reportDir ?? resolve(root, "reports"));
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(resolve(reportDir, "conformance.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdown = renderMarkdown(report);
  writeFileSync(resolve(reportDir, "conformance.md"), markdown, "utf8");

  const exitCode = failed > 0 ? 1 : blockedRows > 0 ? 2 : 0;
  return { report, text: markdown, exitCode };
}

function checkProfileEquivalence(
  program: import("../contracts/ast").Program,
  canonicalText: string,
  profile: import("../contracts/profile").Profile,
): ProfileReport {
  const probe = analyze(canonicalText, "<canonical>", STANDARD_PROFILE);
  if (!probe.tokens) {
    return { id: profile.id, structure: false, roundTrip: false, diagnostics: ["no token stream"] };
  }
  const converted = convert(probe.tokens, STANDARD_PROFILE, profile);
  if (converted.diagnostics.length > 0) {
    return {
      id: profile.id,
      structure: false,
      roundTrip: false,
      diagnostics: converted.diagnostics.map(formatDiagnostic),
    };
  }
  const parsed = analyze(converted.text, `<${profile.id}>`, profile);
  const diagnostics = parsed.diagnostics.map(formatDiagnostic);
  const structure =
    parsed.program !== undefined &&
    JSON.stringify(normalizeAst(parsed.program)) === JSON.stringify(normalizeAst(program));
  let roundTrip = false;
  if (parsed.tokens) {
    const back = convert(parsed.tokens, profile, STANDARD_PROFILE);
    roundTrip = back.diagnostics.length === 0 && back.text === canonicalText;
    diagnostics.push(...back.diagnostics.map(formatDiagnostic));
  }
  return { id: profile.id, structure, roundTrip, diagnostics };
}

function matchesExpected(
  expected: ExpectedOutcome,
  actual: Outcome,
  reference?: Outcome,
): boolean {
  if (expected.status !== actual.status) return false;
  if (expected.status === "ok" && actual.status === "ok") {
    return expected.type === actual.type && expected.value === actual.value;
  }
  if (expected.status === "error" && actual.status === "error") {
    if (expected.code !== actual.code) return false;
    if (expected.node !== undefined && actual.node !== expected.node) return false;
    if (
      reference?.status === "error" &&
      reference.node !== undefined &&
      actual.node !== reference.node
    ) {
      return false;
    }
    return true;
  }
  return false;
}

function tail(text: string, lines: number): string {
  return text.split(/\r?\n/).slice(-lines).join("\n");
}

function renderMarkdown(report: ConformanceReport): string {
  const lines: string[] = [];
  lines.push("# h# Conformance Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Compiler: ${report.compilerVersion} (core ${report.coreVersion})`);
  lines.push(`- Node: ${report.nodeVersion}`);
  lines.push(
    `- Mode: ${report.mode === "full" ? "full (all configured targets executed)" : "interpreter-only (target verification was not requested)"}`,
  );
  lines.push(`- Profiles: ${report.profiles.map((p) => p.id).join(", ")}`);
  lines.push(`- Cases: ${report.summary.cases}; target executions: ${report.summary.targets}`);
  lines.push(
    `- Result: ${
      report.mode === "interpreter-only"
        ? "INTERPRETER-ONLY (not a target verification)"
        : report.summary.failed === 0 && report.summary.blocked === 0
          ? "PASS"
          : "ATTENTION"
    } (${report.summary.failed} failed, ${report.summary.blocked} blocked)`,
  );
  lines.push("");
  lines.push("## Toolchains");
  lines.push("");
  lines.push("| Target | Tool | Version | Status |");
  lines.push("|---|---|---|---|");
  for (const tool of report.toolchains) {
    lines.push(`| ${tool.target} | ${tool.name} | ${tool.version} | ${tool.available ? "available" : "blocked"} |`);
  }
  lines.push("");
  lines.push("## Cases");
  lines.push("");
  lines.push("| Case | Reference | Profiles | C# | Rust | Go | Java |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const testCase of report.cases) {
    const profileMarks = testCase.profiles
      .map((profile) => `${profile.id}:${profile.structure && profile.roundTrip ? "ok" : "bad"}`)
      .join(" ");
    const cells = (["csharp", "rust", "go", "java"] as TargetId[]).map((target) => {
      const rows = testCase.targets.filter((row) => row.target === target);
      if (rows.length === 0) return "-";
      if (rows.every((row) => row.status === "passed")) return "pass";
      if (rows.some((row) => row.status === "failed")) return "FAIL";
      return "blocked";
    });
    lines.push(`| ${testCase.id} | ${testCase.reference.status} | ${profileMarks} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push(
    "Each target artifact is compiled once per program and entry function; the same profile-independent artifact is then executed for every profile. Structural equivalence and round-trip preservation are verified separately for each profile.",
  );
  lines.push("");
  lines.push("## Negative cases");
  lines.push("");
  lines.push("| Case | Expected diagnostic | Status |");
  lines.push("|---|---|---|");
  for (const negative of report.negative) {
    lines.push(`| ${negative.id} | ${negative.expectedDiagnostic} | ${negative.status} |`);
  }
  lines.push("");
  const failures = report.cases.filter(
    (testCase) =>
      testCase.reference.status === "failed" ||
      testCase.profiles.some((profile) => !profile.structure || !profile.roundTrip) ||
      testCase.targets.some((row) => row.status === "failed"),
  );
  if (failures.length > 0) {
    lines.push("## Failure details");
    lines.push("");
    for (const failure of failures) {
      lines.push(`### ${failure.id}`);
      lines.push("");
      if (failure.reference.detail) lines.push(`- Reference: ${failure.reference.detail}`);
      for (const profile of failure.profiles) {
        if (!profile.structure || !profile.roundTrip || profile.diagnostics.length > 0) {
          lines.push(`- Profile ${profile.id}: structure=${profile.structure} roundTrip=${profile.roundTrip}`);
          for (const diagnostic of profile.diagnostics) lines.push(`  - ${diagnostic}`);
        }
      }
      for (const row of failure.targets.filter((row) => row.status === "failed")) {
        lines.push(`- ${row.target}/${row.profile}: ${row.detail ?? "mismatch"}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}
