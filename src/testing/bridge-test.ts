import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
import type { AnalyzeResponse } from "../service/protocol";

async function main(): Promise<void> {
  const child = spawn(process.execPath, [resolve(__dirname, "..", "cli", "index.js"), "bridge"], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });

  const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  const queued: string[] = [];
  const waiters: ((line: string) => void)[] = [];
  lines.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else queued.push(line);
  });

  const nextLine = (timeoutMs = 10_000): Promise<string> =>
    new Promise((resolveLine, rejectLine) => {
      const queuedLine = queued.shift();
      if (queuedLine !== undefined) {
        resolveLine(queuedLine);
        return;
      }
      const timer = setTimeout(() => {
        rejectLine(new Error("bridge did not answer in time"));
      }, timeoutMs);
      waiters.push((line) => {
        clearTimeout(timer);
        resolveLine(line);
      });
    });

  const send = async (request: object): Promise<Record<string, unknown>> => {
    child.stdin!.write(`${JSON.stringify(request)}\n`);
    return JSON.parse(await nextLine()) as Record<string, unknown>;
  };

  const ping = await send({ id: 1, command: "ping" });
  assert.equal(ping.ok, true);
  assert.equal(ping.command, "ping");
  assert.equal(typeof ping.compilerVersion, "string");

  const text = readFileSync(resolve("examples", "calculate.hs"), "utf8");
  const analyzed = (await send({
    id: 2,
    command: "analyze",
    text,
    file: "calculate.hs",
    targets: ["csharp", "rust", "go", "java"],
  })) as unknown as AnalyzeResponse;

  assert.equal(analyzed.ok, true);
  assert.equal(analyzed.entry, "calculate");
  assert.equal(analyzed.generated?.length, 4);
  assert.ok((analyzed.timings?.totalMs ?? -1) >= 0);
  assert.ok((analyzed.timings?.totalMs ?? 999) < 100);

  const invalid = await send({
    id: 3,
    command: "analyze",
    text: "fn main( -> i32 { return 1; }",
    file: "invalid.hs",
    targets: ["csharp"],
  });
  assert.equal(invalid.ok, false);
  assert.ok(Array.isArray(invalid.diagnostics) && invalid.diagnostics.length > 0);

  const malformed = await send({ id: 4, command: "analyze" });
  assert.equal(malformed.ok, false);
  assert.match(String(malformed.error), /text must be a string/);

  await send({ id: 5, command: "shutdown" });
  await new Promise<void>((resolveClose) => {
    if (child.exitCode !== null) {
      resolveClose();
      return;
    }
    child.once("close", () => resolveClose());
  });

  console.log("ok   bridge protocol (ping, analyze x4 targets, invalid syntax, bad request, shutdown)");
}

main().catch((cause) => {
  console.error("FAIL bridge protocol");
  console.error(cause);
  process.exitCode = 1;
});
