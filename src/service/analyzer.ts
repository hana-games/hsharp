import { statSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { emit } from "../backends";
import type { Diagnostic } from "../contracts/diagnostics";
import { error } from "../contracts/diagnostics";
import { TARGET_IDS, type TargetId } from "../contracts/interfaces";
import type { Profile } from "../contracts/profile";
import { CORE_VERSION, COMPILER_VERSION } from "../contracts/version";
import { loadProfileFile, STANDARD_PROFILE } from "../frontend/profile";
import { parse } from "../frontend/parser";
import { check } from "../semantic/checker";
import { chooseEntry } from "../semantic/entry";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  AnalyzeTimings,
  GeneratedTarget,
} from "./protocol";

interface CachedProfile {
  mtimeMs: number;
  size: number;
  profile?: Profile;
  diagnostics: Diagnostic[];
}

/**
 * In-process editor backend. A single instance lives for the lifetime of the
 * bridge process, so profile files are cached and Node startup is paid once.
 */
export class HSharpAnalyzer {
  private readonly profileCache = new Map<string, CachedProfile>();

  analyze(request: AnalyzeRequest): AnalyzeResponse {
    const started = performance.now();
    const file = request.file && request.file.length > 0 ? request.file : "<editor>";
    const text = request.text.replace(/^\uFEFF/, "");

    const profileResult = this.resolveProfile(request.profilePath);
    const diagnostics: Diagnostic[] = [...profileResult.diagnostics];

    const parsed = parse(text, profileResult.profile, file);
    const parseEnd = performance.now();
    diagnostics.push(...parsed.diagnostics);

    let checkEnd = parseEnd;
    let entryEnd = checkEnd;
    let entry: string | undefined;
    let entryError: string | undefined;
    let generated: GeneratedTarget[] | undefined;

    if (!parsed.program) {
      checkEnd = parseEnd;
      entryEnd = parseEnd;
    } else {
      const checked = check(parsed.program);
      checkEnd = performance.now();
      diagnostics.push(...checked.diagnostics);

      if (checked.typed) {
        const choice = chooseEntry(checked.typed, request.entry);
        entry = choice.entry;
        if (!entry) {
          entryError = choice.diagnostic?.message;
        }
      }
      entryEnd = performance.now();

      const targets = normalizeTargets(request.targets);
      if (checked.typed && entry && targets.length > 0) {
        generated = [];
        for (const target of targets) {
          try {
            const project = emit(checked.typed, target, entry);
            generated.push({
              target,
              files: project.files.map((generatedFile) => ({
                path: generatedFile.path,
                content: generatedFile.content,
              })),
            });
          } catch (cause) {
            diagnostics.push(
              error("E_EMIT", `code generation for ${target} failed: ${(cause as Error).message}`),
            );
          }
        }
      }
    }

    const finished = performance.now();
    const timings: AnalyzeTimings = {
      parseMs: round(parseEnd - started),
      checkMs: round(checkEnd - parseEnd),
      entryMs: round(entryEnd - checkEnd),
      emitMs: round(finished - entryEnd),
      totalMs: round(finished - started),
    };

    return {
      id: request.id,
      ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
      command: "analyze",
      compilerVersion: COMPILER_VERSION,
      coreVersion: CORE_VERSION,
      diagnostics,
      functions: parsed.program?.functions.map((fn) => fn.name) ?? [],
      entry,
      entryError,
      timings,
      generated,
    };
  }

  private resolveProfile(profilePath: string | undefined): {
    profile: Profile;
    diagnostics: Diagnostic[];
  } {
    if (!profilePath) return { profile: STANDARD_PROFILE, diagnostics: [] };

    const path = resolve(profilePath);
    let stamp: { mtimeMs: number; size: number };
    try {
      const stat = statSync(path);
      stamp = { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      const loaded = loadProfileFile(path);
      return {
        profile: loaded.loaded?.profile ?? STANDARD_PROFILE,
        diagnostics: loaded.diagnostics,
      };
    }

    const cached = this.profileCache.get(path);
    if (cached && cached.mtimeMs === stamp.mtimeMs && cached.size === stamp.size) {
      return {
        profile: cached.profile ?? STANDARD_PROFILE,
        diagnostics: cached.diagnostics,
      };
    }

    const loaded = loadProfileFile(path);
    this.profileCache.set(path, {
      ...stamp,
      profile: loaded.loaded?.profile,
      diagnostics: loaded.diagnostics,
    });
    return {
      profile: loaded.loaded?.profile ?? STANDARD_PROFILE,
      diagnostics: loaded.diagnostics,
    };
  }
}

function normalizeTargets(targets: TargetId[] | undefined): TargetId[] {
  if (!Array.isArray(targets)) return [];
  const result: TargetId[] = [];
  for (const target of targets) {
    if ((TARGET_IDS as readonly string[]).includes(target) && !result.includes(target)) {
      result.push(target);
    }
  }
  return result;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
