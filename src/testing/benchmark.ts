import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { performance } from "node:perf_hooks";
import { emit } from "../backends";
import { TARGET_IDS } from "../contracts/interfaces";
import { COMPILER_VERSION } from "../contracts/version";
import { STANDARD_PROFILE } from "../frontend/profile";
import { analyze } from "../pipeline";
import type { AnalyzeResponse } from "../service/protocol";

interface Measurement {
  name: string;
  iterations: number;
  totalMs: number;
  averageMs: number;
  budgetMs: number;
  pass: boolean;
  detail: string;
}

const budgets = {
  analyzeSmall: 2,
  analyzeMedium: 30,
  analyzeLarge: 150,
  emitSmallAll: 8,
  emitLargeAll: 150,
  bridgeRoundtrip: 30,
  previewSmall: 25,
};

async function main(): Promise<void> {
  const smallSource = readFileSync(resolve("tests", "benchmarks", "small.hs"), "utf8");
  const mediumSource = readFileSync(resolve("tests", "benchmarks", "medium.hs"), "utf8");
  const largeSource = readFileSync(resolve("tests", "benchmarks", "large.hs"), "utf8");
  const small = analyze(smallSource, "small.hs", STANDARD_PROFILE);
  const medium = analyze(mediumSource, "medium.hs", STANDARD_PROFILE);
  const large = analyze(largeSource, "large.hs", STANDARD_PROFILE);
  if (!small.typed) throw new Error(`small benchmark source did not compile: ${describe(small.diagnostics)}`);
  if (!medium.typed) throw new Error(`medium benchmark source did not compile: ${describe(medium.diagnostics)}`);
  if (!large.typed) throw new Error(`large benchmark source did not compile: ${describe(large.diagnostics)}`);

  const measurements: Measurement[] = [];
  measurements.push(
    measure("analyze small document", 1000, budgets.analyzeSmall, () => {
      analyze(smallSource, "small.hs", STANDARD_PROFILE);
    }, `${smallSource.length} chars`),
  );
  measurements.push(
    measure("analyze 40 functions", 200, budgets.analyzeMedium, () => {
      analyze(mediumSource, "medium.hs", STANDARD_PROFILE);
    }, `${mediumSource.length} chars`),
  );
  measurements.push(
    measure("analyze 300 functions", 50, budgets.analyzeLarge, () => {
      analyze(largeSource, "large.hs", STANDARD_PROFILE);
    }, `${largeSource.length} chars`),
  );
  measurements.push(
    measure("generate all six small", 500, budgets.emitSmallAll, () => {
      for (const target of TARGET_IDS) emit(small.typed!, target, "calculate");
    }, "C# + Rust + Go + Java + C++ + JavaScript"),
  );
  measurements.push(
    measure("generate all six 300 functions", 20, budgets.emitLargeAll, () => {
      for (const target of TARGET_IDS) emit(large.typed!, target, "main");
    }, "C# + Rust + Go + Java + C++ + JavaScript"),
  );

  const preview = measure("analyze + generate all six", 500, budgets.previewSmall, () => {
    const result = analyze(smallSource, "small.hs", STANDARD_PROFILE);
    if (!result.typed) return;
    for (const target of TARGET_IDS) emit(result.typed, target, "calculate");
  }, "cold preview pipeline");
  measurements.push(preview);

  const bridge = await measureBridge(smallSource);
  measurements.push(bridge);

  const report = {
    schema: "hs-benchmark/1",
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    compilerVersion: COMPILER_VERSION,
    budgets,
    measurements,
    pass: measurements.every((entry) => entry.pass),
  };

  const reportDir = resolve("reports");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(resolve(reportDir, "benchmark.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`h# performance — Node ${process.version} on ${report.platform}`);
    console.log("");
    console.log("| Measurement | Average | Budget | Result |");
    console.log("|---|---:|---:|---|");
    for (const entry of measurements) {
      console.log(
        `| ${entry.name} (${entry.detail}) | ${entry.averageMs.toFixed(3)} ms | ${entry.budgetMs} ms | ${entry.pass ? "pass" : "FAIL"} |`,
      );
    }
    console.log("");
    console.log(`report: reports/benchmark.json`);
    console.log(report.pass ? "all latency budgets met" : "latency budget exceeded");
  }

  if (!report.pass) process.exitCode = 1;
}

function measure(
  name: string,
  iterations: number,
  budgetMs: number,
  operation: () => void,
  detail: string,
): Measurement {
  for (let i = 0; i < Math.min(iterations, 20); i++) operation();
  const started = performance.now();
  for (let i = 0; i < iterations; i++) operation();
  const totalMs = performance.now() - started;
  const averageMs = totalMs / iterations;
  return {
    name,
    iterations,
    totalMs: round(totalMs),
    averageMs: round(averageMs),
    budgetMs,
    pass: averageMs <= budgetMs,
    detail,
  };
}

async function measureBridge(smallSource: string): Promise<Measurement> {
  const child = spawn(process.execPath, [resolve(__dirname, "..", "cli", "index.js"), "bridge"], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  const pending = new Map<number, (value: AnalyzeResponse) => void>();
  lines.on("line", (line) => {
    const response = JSON.parse(line) as AnalyzeResponse;
    const resolvePending = pending.get(Number(response.id));
    if (resolvePending) {
      pending.delete(Number(response.id));
      resolvePending(response);
    }
  });

  const send = (request: object, id: number): Promise<AnalyzeResponse> =>
    new Promise((resolvePromise) => {
      pending.set(id, resolvePromise);
      child.stdin!.write(`${JSON.stringify(request)}\n`);
    });

  await send({ id: 0, command: "ping" }, 0);
  const iterations = 100;
  const started = performance.now();
  for (let i = 1; i <= iterations; i++) {
    const response = await send(
      {
        id: i,
        command: "analyze",
        text: `${smallSource}\n// edit ${i}`,
        file: "bridge.hs",
        targets: ["csharp"],
      },
      i,
    );
    if (!response.ok || response.generated === undefined) {
      throw new Error(`bridge request failed: ${JSON.stringify(response)}`);
    }
  }
  const totalMs = performance.now() - started;
  child.stdin!.write(`${JSON.stringify({ id: "bye", command: "shutdown" })}\n`);
  const averageMs = totalMs / iterations;
  return {
    name: "bridge analyze + C# over stdio",
    iterations,
    totalMs: round(totalMs),
    averageMs: round(averageMs),
    budgetMs: budgets.bridgeRoundtrip,
    pass: averageMs <= budgets.bridgeRoundtrip,
    detail: "persistent process, one JSON line per edit",
  };
}

function describe(diagnostics: { message: string }[]): string {
  return diagnostics.map((diagnostic) => diagnostic.message).join("; ");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
