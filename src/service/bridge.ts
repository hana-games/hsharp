import { createInterface } from "node:readline";
import { CORE_VERSION, COMPILER_VERSION } from "../contracts/version";
import { HSharpAnalyzer } from "./analyzer";
import type { BridgeRequest, BridgeResponse, PingResponse, ErrorResponse } from "./protocol";

/** Runs the line-delimited JSON bridge over stdio until shutdown or EOF. */
export function runBridge(): void {
  const analyzer = new HSharpAnalyzer();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

  lines.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch (cause) {
      write({
        id: null,
        ok: false,
        command: "unknown",
        error: `invalid JSON: ${(cause as Error).message}`,
      });
      return;
    }

    if (raw === null || typeof raw !== "object") {
      write({ id: null, ok: false, command: "unknown", error: "request must be a JSON object" });
      return;
    }

    const request = raw as BridgeRequest;
    const id = typeof request.id === "number" || typeof request.id === "string" ? request.id : null;

    try {
      switch (request.command) {
        case "ping":
          write({
            id: id ?? 0,
            ok: true,
            command: "ping",
            compilerVersion: COMPILER_VERSION,
            coreVersion: CORE_VERSION,
            node: process.version,
          } satisfies PingResponse);
          return;
        case "shutdown":
          write({
            id: id ?? 0,
            ok: true,
            command: "shutdown",
            compilerVersion: COMPILER_VERSION,
            coreVersion: CORE_VERSION,
            node: process.version,
          });
          process.stdout.write("", () => process.exit(0));
          return;
        case "analyze": {
          if (typeof request.text !== "string") {
            write({
              id,
              ok: false,
              command: "analyze",
              error: "analyze.text must be a string",
            } satisfies ErrorResponse);
            return;
          }
          write(analyzer.analyze(request));
          return;
        }
        default:
          write({
            id,
            ok: false,
            command: String((request as { command?: unknown }).command ?? "unknown"),
            error: "unsupported command",
          } satisfies ErrorResponse);
      }
    } catch (cause) {
      write({
        id,
        ok: false,
        command: String((request as { command?: unknown }).command ?? "unknown"),
        error: (cause as Error).message,
      } satisfies ErrorResponse);
    }
  });
}

function write(response: BridgeResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}
