import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TargetId } from "../contracts/interfaces";

export interface CommandResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  command: string;
}

export interface ToolchainInfo {
  target: TargetId;
  name: string;
  available: boolean;
  version: string;
  detail: string;
  commands: string[];
}

const FALLBACK_DIRS: Record<string, string[]> = {
  go: ["C:\\Program Files\\Go\\bin\\go.exe"],
  javac: [],
  java: [],
};

function javaHomes(): string[] {
  const roots = [
    "C:\\Program Files\\Microsoft",
    "C:\\Program Files\\Eclipse Adoptium",
    "C:\\Program Files\\Java",
    "C:\\Program Files\\Amazon Corretto",
    "C:\\Program Files\\BellSoft",
  ];
  const homes: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && /jdk/i.test(entry.name)) homes.push(join(root, entry.name));
      }
    } catch {
      // Ignore unreadable installation roots.
    }
  }
  return homes;
}

export function resolveExecutable(name: string): string | undefined {
  const probe = spawnSync(process.platform === "win32" ? "where.exe" : "which", [name], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.status === 0) {
    const first = probe.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (first) return first;
  }

  const direct = FALLBACK_DIRS[name];
  if (direct) {
    for (const candidate of direct) if (existsSync(candidate)) return candidate;
  }

  if (name === "java" || name === "javac") {
    for (const home of javaHomes()) {
      const candidate = join(home, "bin", `${name}.exe`);
      if (existsSync(candidate)) return candidate;
    }
  }

  return undefined;
}

export function runCommand(argv: string[], cwd: string, timeoutMs = 180_000): CommandResult {
  const resolved = resolveExecutable(argv[0]) ?? argv[0];
  const result = spawnSync(resolved, argv.slice(1), {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error) {
    return {
      ok: false,
      status: null,
      stdout,
      stderr,
      error: result.error.message,
      command: argv.join(" "),
    };
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout,
    stderr,
    command: argv.join(" "),
  };
}

function versionOf(argv: string[], cwd: string): { available: boolean; version: string; detail: string } {
  if (!resolveExecutable(argv[0])) {
    return {
      available: false,
      version: "not found",
      detail: `"${argv[0]}" is not on PATH and no known installation was found`,
    };
  }
  const result = runCommand(argv, cwd, 30_000);
  const text = `${result.stdout}\n${result.stderr}`.trim();
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  return {
    available: result.ok,
    version: result.ok ? firstLine : `error (${result.error ?? `exit ${result.status}`})`,
    detail: result.ok ? "" : text,
  };
}

export function detectToolchains(cwd: string): ToolchainInfo[] {
  const dotnet = versionOf(["dotnet", "--version"], cwd);
  const cargo = versionOf(["cargo", "--version"], cwd);
  const rustc = versionOf(["rustc", "--version"], cwd);
  const go = versionOf(["go", "version"], cwd);
  const javac = versionOf(["javac", "-version"], cwd);
  const java = versionOf(["java", "-version"], cwd);

  // Generated projects target net10.0; an older SDK cannot build them.
  const dotnetMajor = Number.parseInt(dotnet.version, 10);
  const dotnetSupportsTarget = Number.isFinite(dotnetMajor) && dotnetMajor >= 10;
  const csharpAvailable = dotnet.available && dotnetSupportsTarget;
  const csharpDetail = dotnetSupportsTarget
    ? dotnet.detail
    : `generated projects target net10.0; detected SDK ${dotnet.version} (need 10 or later)`;

  // Generated go.mod declares go 1.22.
  const goMatch = /go(\d+)\.(\d+)/.exec(go.version);
  const goSupported =
    goMatch !== null && (Number(goMatch[1]) > 1 || (Number(goMatch[1]) === 1 && Number(goMatch[2]) >= 22));
  const goAvailable = go.available && goSupported;
  const goDetail = goSupported
    ? go.detail
    : `generated go.mod requires Go 1.22 or later; detected ${go.version || "no version"}`;

  return [
    {
      target: "csharp",
      name: ".NET SDK",
      available: csharpAvailable,
      version: dotnet.version,
      detail: csharpDetail,
      commands: ["dotnet"],
    },
    {
      target: "rust",
      name: "Rust (cargo)",
      available: cargo.available && rustc.available,
      version: `${cargo.version}; ${rustc.version}`,
      detail: cargo.detail || rustc.detail,
      commands: ["cargo", "rustc"],
    },
    {
      target: "go",
      name: "Go",
      available: goAvailable,
      version: go.version,
      detail: goDetail,
      commands: ["go"],
    },
    {
      target: "java",
      name: "Java (javac)",
      available: javac.available && java.available,
      version: `${javac.version}; ${java.version}`,
      detail: javac.detail || java.detail,
      commands: ["javac", "java"],
    },
  ];
}

export function toolchainFor(target: TargetId, cwd: string): ToolchainInfo {
  const info = detectToolchains(cwd).find((entry) => entry.target === target);
  if (!info) throw new Error(`internal: unknown target ${target}`);
  return info;
}
