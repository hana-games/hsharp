import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GeneratedProject, TargetId } from "../contracts/interfaces";
import type { Outcome, TypedProgram } from "../contracts/outcome";
import { emit } from "../backends";
import { resolveExecutable, runCommand, toolchainFor } from "./toolchain";

export type VerificationStatus = "passed" | "failed" | "blocked";

export interface ProjectRunResult {
  status: "ok" | "error" | "blocked" | "build-failed" | "run-failed";
  outcome?: Outcome;
  buildLog: string;
  runLog: string;
  directory: string;
  detail?: string;
}

export function materializeProject(project: GeneratedProject, directory: string): void {
  mkdirSync(directory, { recursive: true });
  for (const file of project.files) {
    const target = join(directory, file.path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, file.content, "utf8");
  }
}

export function buildProject(project: GeneratedProject, directory: string): { ok: boolean; log: string } {
  const result = runCommand(project.build, directory);
  const log = [
    `$ ${result.command}`,
    result.stdout.trim(),
    result.stderr.trim(),
    result.error ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  return { ok: result.ok, log };
}

export function parseOutcome(stdout: string): Outcome | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (value.status === "ok" && typeof value.value !== "undefined") {
        return {
          status: "ok",
          type: value.type === "bool" ? "bool" : "i32",
          value: value.value as number | boolean,
        };
      }
      if (value.status === "error" && typeof value.code === "string" && typeof value.node === "number") {
        return {
          status: "error",
          code: value.code,
          node: value.node,
        };
      }
      if (value.status === "badargs") return undefined;
    } catch {
      // Not a machine-readable outcome line.
    }
  }
  return undefined;
}

export function argumentStrings(args: (number | boolean)[]): string[] {
  return args.map((value) => (typeof value === "boolean" ? (value ? "true" : "false") : String(value)));
}

export function runBuiltProject(
  project: GeneratedProject,
  directory: string,
  args: (number | boolean)[],
): { status: "ok" | "error" | "run-failed"; outcome?: Outcome; log: string } {
  const run = runCommand([...project.run, ...argumentStrings(args)], directory, 60_000);
  const log = [`$ ${run.command}`, run.stdout.trim(), run.stderr.trim(), run.error ?? ""]
    .filter(Boolean)
    .join("\n");
  if (run.error || run.status === null) {
    return { status: "run-failed", log };
  }
  const outcome = parseOutcome(run.stdout);
  if (!outcome) return { status: "run-failed", log };
  const expectedExit = outcome.status === "ok" ? run.status === 0 : run.status !== 0;
  if (!expectedExit) {
    return {
      status: "run-failed",
      log,
      outcome,
    };
  }
  return { status: outcome.status, outcome, log };
}

export function compileAndRun(
  program: TypedProgram,
  target: TargetId,
  entry: string,
  args: (number | boolean)[],
  directory: string,
  root: string,
): ProjectRunResult {
  const toolchain = toolchainFor(target, root);
  if (!toolchain.available) {
    return {
      status: "blocked",
      buildLog: "",
      runLog: "",
      directory,
      detail: `${toolchain.name} is unavailable: ${toolchain.detail || toolchain.version}`,
    };
  }

  let project: GeneratedProject;
  try {
    project = emit(program, target, entry);
  } catch (cause) {
    return {
      status: "build-failed",
      buildLog: (cause as Error).message,
      runLog: "",
      directory,
      detail: "code generation threw an exception",
    };
  }

  materializeProject(project, directory);
  const build = buildProject(project, directory);
  if (!build.ok) {
    return {
      status: "build-failed",
      buildLog: build.log,
      runLog: "",
      directory,
      detail: "generated project did not compile",
    };
  }

  const runArgv = [...project.run, ...argumentStrings(args)];
  const run = runCommand(runArgv, directory, 60_000);
  const runLog = [`$ ${run.command}`, run.stdout.trim(), run.stderr.trim(), run.error ?? ""]
    .filter(Boolean)
    .join("\n");

  if (run.error || run.status === null) {
    return {
      status: "run-failed",
      buildLog: build.log,
      runLog,
      directory,
      detail: run.error ?? "process did not start",
    };
  }

  const outcome = parseOutcome(run.stdout);
  if (!outcome) {
    return {
      status: "run-failed",
      buildLog: build.log,
      runLog,
      directory,
      detail: "no machine-readable outcome on stdout",
    };
  }
  const expectedExit = outcome.status === "ok" ? run.status === 0 : run.status !== 0;
  if (!expectedExit) {
    return {
      status: "run-failed",
      buildLog: build.log,
      runLog,
      directory,
      detail: `unexpected process exit status ${run.status} for a ${outcome.status} outcome`,
    };
  }

  return { status: outcome.status, outcome, buildLog: build.log, runLog, directory };
}

export function executableAvailable(name: string): boolean {
  return resolveExecutable(name) !== undefined;
}
