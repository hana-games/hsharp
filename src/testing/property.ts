import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { TargetId } from "../contracts/interfaces";
import type { Outcome } from "../contracts/outcome";
import type { TypeName } from "../contracts/tokens";
import { CORE_VERSION, COMPILER_VERSION } from "../contracts/version";
import { STANDARD_PROFILE } from "../frontend/profile";
import { compileAndRun } from "../harness/project";
import { detectToolchains } from "../harness/toolchain";
import { analyze } from "../pipeline";
import { evaluate } from "../reference/interpreter";
import { chooseEntry } from "../semantic/entry";

export interface GeneratedCase {
  seed: number;
  size: number;
  source: string;
}

interface GenVar {
  name: string;
  type: TypeName;
}

interface GenFunction {
  name: string;
  params: GenVar[];
  returnType: TypeName;
}

interface Scope {
  vars: GenVar[];
  functions: GenFunction[];
}

class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 1;
  }

  next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  int(max: number): number {
    return max <= 0 ? 0 : Math.floor(this.next() * max);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}

const INT_LITERALS = ["0", "1", "2", "3", "7", "10", "42", "-1", "-7", "2147483647", "-2147483648"];
const COMPARISONS = ["<", "<=", ">", ">=", "==", "!="] as const;

function atom(rng: Rng, scope: Scope, type: TypeName, depth: number): string {
  const options: Array<() => string> = [];
  for (const variable of scope.vars) {
    if (variable.type === type) options.push(() => variable.name);
  }
  for (const fn of scope.functions) {
    if (fn.returnType !== type) continue;
    options.push(() => {
      const args = fn.params.map((param) => expr(rng, scope, param.type, depth - 1));
      return `${fn.name}(${args.join(", ")})`;
    });
  }
  if (type === "i32") {
    for (const literal of INT_LITERALS) options.push(() => literal);
  } else {
    options.push(() => "true", () => "false");
  }
  return options[rng.int(options.length)]();
}

function expr(rng: Rng, scope: Scope, type: TypeName, depth: number): string {
  if (depth <= 0 || rng.chance(0.3)) return atom(rng, scope, type, depth);
  if (type === "i32") {
    switch (rng.int(4)) {
      case 0:
        return `(${expr(rng, scope, "i32", depth - 1)} + ${expr(rng, scope, "i32", depth - 1)})`;
      case 1:
        return `(${expr(rng, scope, "i32", depth - 1)} - ${expr(rng, scope, "i32", depth - 1)})`;
      case 2:
        return `(${expr(rng, scope, "i32", depth - 1)} * ${expr(rng, scope, "i32", depth - 1)})`;
      default:
        return `(-${expr(rng, scope, "i32", depth - 1)})`;
    }
  }
  switch (rng.int(5)) {
    case 0:
      return `(${expr(rng, scope, "bool", depth - 1)} && ${expr(rng, scope, "bool", depth - 1)})`;
    case 1:
      return `(${expr(rng, scope, "bool", depth - 1)} || ${expr(rng, scope, "bool", depth - 1)})`;
    case 2:
      return `(!(${expr(rng, scope, "bool", depth - 1)}))`;
    case 3:
      return `(${expr(rng, scope, "i32", depth - 1)} ${rng.pick(COMPARISONS)} ${expr(rng, scope, "i32", depth - 1)})`;
    default:
      return atom(rng, scope, "bool", depth);
  }
}

function bodyFor(rng: Rng, scope: Scope, returnType: TypeName, size: number): string[] {
  const body: string[] = [];
  const vars = [...scope.vars];
  const letCount = Math.max(1, Math.min(2, size));
  const depth = Math.max(1, Math.min(3, size));
  for (let index = 0; index < letCount; index++) {
    const type: TypeName = rng.chance(0.6) ? "i32" : "bool";
    const name = `v${index + 1}`;
    const value = expr(rng, { ...scope, vars }, type, depth);
    body.push(`    let ${name}: ${type} = ${value};`);
    vars.push({ name, type });
  }
  const localScope: Scope = { ...scope, vars };
  body.push(`    if ${expr(rng, localScope, "bool", depth)} {`);
  body.push(`        return ${expr(rng, localScope, returnType, depth)};`);
  body.push("    }");
  if (rng.chance(0.35)) {
    body.push("    else {");
    body.push(`        return ${expr(rng, localScope, returnType, depth)};`);
    body.push("    }");
  }
  body.push(`    return ${expr(rng, localScope, returnType, depth)};`);
  return body;
}

export function generateCase(seed: number, size = 3): GeneratedCase {
  const rng = new Rng(seed);
  const functions: GenFunction[] = [];
  const chunks: string[] = [];
  const helperCount = size <= 1 ? 1 : 2;
  const paramCount = (): number => rng.int(3);
  const returnType = (): TypeName => (rng.chance(0.65) ? "i32" : "bool");

  for (let index = 0; index < helperCount; index++) {
    const name = `f${index + 1}`;
    const params: GenVar[] = [];
    const numberOfParams = paramCount();
    for (let parameter = 0; parameter < numberOfParams; parameter++) {
      params.push({
        name: `p${parameter + 1}`,
        type: rng.chance(0.6) ? "i32" : "bool",
      });
    }
    const type = returnType();
    const signature = params.map((param) => `${param.name}: ${param.type}`).join(", ");
    const body = bodyFor(rng, { vars: params, functions }, type, size);
    chunks.push(`fn ${name}(${signature}) -> ${type} {\n${body.join("\n")}\n}`);
    functions.push({ name, params, returnType: type });
  }

  const mainBody = bodyFor(rng, { vars: [], functions }, "i32", size);
  chunks.push(`fn main() -> i32 {\n${mainBody.join("\n")}\n}`);
  return { seed, size, source: `${chunks.join("\n\n")}\n` };
}

export function outcomesEqual(left: Outcome | undefined, right: Outcome | undefined): boolean {
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export interface ReducedSource {
  source: string;
  attempts: number;
}

export function reduceSource(
  source: string,
  stillFails: (candidate: string) => boolean,
  maxAttempts = 24,
): ReducedSource {
  let current = source;
  let attempts = 0;
  let changed = true;
  while (changed && attempts < maxAttempts) {
    changed = false;
    const lines = current.split("\n");
    for (let index = 0; index < lines.length && attempts < maxAttempts; index++) {
      if (!lines[index].trim()) continue;
      if (lines[index].trimStart().startsWith("fn main(")) continue;
      const candidate = [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n");
      if (!candidate.trim()) continue;
      attempts++;
      if (stillFails(candidate)) {
        current = candidate;
        changed = true;
        break;
      }
    }
  }
  return { source: current, attempts };
}

export interface PropertyTargetReport {
  target: TargetId;
  status: "passed" | "failed" | "blocked";
  outcome?: Outcome;
  detail?: string;
}

export interface PropertyCaseReport {
  id: string;
  seed: number;
  size: number;
  status: "passed" | "failed" | "blocked";
  source: string;
  reference?: Outcome;
  targets: PropertyTargetReport[];
  reduced?: string;
  reductionAttempts?: number;
  detail?: string;
}

export interface PropertyReport {
  schema: "hs-property/1";
  generatedAt: string;
  compilerVersion: string;
  coreVersion: string;
  seed: number;
  count: number;
  maxSize: number;
  toolchains: ReturnType<typeof detectToolchains>;
  cases: PropertyCaseReport[];
  summary: {
    cases: number;
    targetRuns: number;
    passed: number;
    failed: number;
    blocked: number;
  };
}

export interface PropertyOptions {
  root: string;
  seed?: number;
  count?: number;
  maxSize?: number;
  targets: TargetId[];
  reportDir?: string;
  quiet?: boolean;
  reduce?: boolean;
}

export function runProperty(options: PropertyOptions): {
  report: PropertyReport;
  text: string;
  exitCode: number;
} {
  const root = resolve(options.root);
  const seed = options.seed ?? 1;
  const count = Math.max(1, Math.min(200, options.count ?? 10));
  const maxSize = Math.max(1, Math.min(5, options.maxSize ?? 3));
  const targets = options.targets.length > 0 ? options.targets : (["csharp", "rust", "go", "java"] as TargetId[]);
  const toolchains = detectToolchains(root);
  const cases: PropertyCaseReport[] = [];

  for (let index = 0; index < count; index++) {
    const caseSeed = seed + index;
    const size = 1 + (index % maxSize);
    const generated = generateCase(caseSeed, size);
    const id = `seed-${caseSeed}-size-${size}`;
    const file = `<property:${id}>`;
    if (!options.quiet) process.stderr.write(`property ${index + 1}/${count} ${id}\n`);

    const report: PropertyCaseReport = {
      id,
      seed: caseSeed,
      size,
      status: "failed",
      source: generated.source,
      targets: [],
    };

    const loaded = analyze(generated.source, file, STANDARD_PROFILE);
    if (!loaded.typed || !loaded.program) {
      report.detail = `generator produced an invalid program:\n${loaded.diagnostics.map((diagnostic) => diagnostic.message).join("\n")}`;
      cases.push(report);
      continue;
    }
    const entry = chooseEntry(loaded.typed, "main").entry;
    if (!entry) {
      report.detail = "generator did not produce a usable entry function";
      cases.push(report);
      continue;
    }

    let reference: Outcome;
    try {
      reference = evaluate(loaded.typed, entry, { values: [] });
      report.reference = reference;
    } catch (cause) {
      report.detail = `reference interpreter threw: ${(cause as Error).message}`;
      cases.push(report);
      continue;
    }

    let failed = false;
    let blocked = false;
    for (const target of targets) {
      const directory = resolve(root, "build", "property", id, target);
      const run = compileAndRun(loaded.typed, target, entry, [], directory, root);
      if (run.status === "blocked") {
        blocked = true;
        report.targets.push({ target, status: "blocked", detail: run.detail });
        continue;
      }
      if (run.status === "build-failed" || run.status === "run-failed" || !run.outcome) {
        failed = true;
        report.targets.push({ target, status: "failed", detail: run.detail ?? run.buildLog ?? run.runLog });
        continue;
      }
      if (outcomesEqual(reference, run.outcome)) {
        report.targets.push({ target, status: "passed", outcome: run.outcome });
      } else {
        failed = true;
        report.targets.push({ target, status: "failed", outcome: run.outcome, detail: "outcome differs from the reference interpreter" });
      }
    }

    report.status = failed ? "failed" : blocked ? "blocked" : "passed";
    if (report.status === "failed" && options.reduce !== false) {
      const failing = report.targets.find((target) => target.status === "failed" && target.outcome !== undefined);
      if (failing) {
        const reduced = reduceSource(generated.source, (candidate) => {
          const candidateLoaded = analyze(candidate, `<property-reduced:${id}>`, STANDARD_PROFILE);
          if (!candidateLoaded.typed || !candidateLoaded.program) return false;
          const candidateEntry = chooseEntry(candidateLoaded.typed, "main").entry;
          if (!candidateEntry) return false;
          let candidateReference: Outcome;
          try {
            candidateReference = evaluate(candidateLoaded.typed, candidateEntry, { values: [] });
          } catch {
            return false;
          }
          const candidateRun = compileAndRun(
            candidateLoaded.typed,
            failing.target,
            candidateEntry,
            [],
            resolve(root, "build", "property", `${id}-reduce`, failing.target),
            root,
          );
          return candidateRun.outcome !== undefined && !outcomesEqual(candidateReference, candidateRun.outcome);
        });
        if (reduced.attempts > 0 && reduced.source !== generated.source) {
          report.reduced = reduced.source;
          report.reductionAttempts = reduced.attempts;
        }
      }
    }
    cases.push(report);
  }

  const summary = {
    cases: cases.length,
    targetRuns: cases.length * targets.length,
    passed: cases.filter((item) => item.status === "passed").length,
    failed: cases.filter((item) => item.status === "failed").length,
    blocked: cases.filter((item) => item.status === "blocked").length,
  };
  const report: PropertyReport = {
    schema: "hs-property/1",
    generatedAt: new Date().toISOString(),
    compilerVersion: COMPILER_VERSION,
    coreVersion: CORE_VERSION,
    seed,
    count,
    maxSize,
    toolchains,
    cases,
    summary,
  };

  const reportDir = resolve(root, options.reportDir ?? "reports");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "property.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(join(reportDir, "property.md"), propertyMarkdown(report), "utf8");

  const text = `property: ${summary.cases} cases, ${summary.targetRuns} target runs, ${summary.passed} passed, ${summary.failed} failed, ${summary.blocked} blocked`;
  return { report, text, exitCode: summary.failed > 0 ? 1 : summary.blocked > 0 ? 2 : 0 };
}

function outcomeText(outcome: Outcome | undefined): string {
  if (!outcome) return "none";
  if (outcome.status === "ok") return `${outcome.type} ${String(outcome.value)}`;
  return `${outcome.code}${outcome.node === undefined ? "" : ` @ node ${outcome.node}`}`;
}

function propertyMarkdown(report: PropertyReport): string {
  const lines = [
    "# h# property report",
    "",
    `Generated: ${report.generatedAt}`,
    `Seed: ${report.seed} · cases: ${report.count} · max size: ${report.maxSize}`,
    "",
    "| Cases | Target runs | Passed | Failed | Blocked |",
    "|---:|---:|---:|---:|---:|",
    `| ${report.summary.cases} | ${report.summary.targetRuns} | ${report.summary.passed} | ${report.summary.failed} | ${report.summary.blocked} |`,
    "",
  ];
  for (const item of report.cases) {
    lines.push(`## ${item.id} — ${item.status}`, "");
    lines.push(`Reference: ${outcomeText(item.reference)}`, "");
    for (const target of item.targets) {
      lines.push(`- **${target.target}**: ${target.status}${target.outcome ? ` — ${outcomeText(target.outcome)}` : ""}${target.detail ? ` — ${target.detail}` : ""}`);
    }
    if (item.detail) lines.push("", item.detail);
    if (item.reduced) {
      lines.push("", `Reduced reproducer (${item.reductionAttempts} attempts):`, "", "```hsharp", item.reduced.trimEnd(), "```");
    }
    lines.push("", "<details><summary>Seed source</summary>", "", "```hsharp", item.source.trimEnd(), "```", "", "</details>", "");
  }
  return `${lines.join("\n")}\n`;
}
