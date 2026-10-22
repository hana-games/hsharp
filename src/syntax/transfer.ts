import { dirname, isAbsolute, relative, resolve } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { Diagnostic } from "../contracts/diagnostics";
import { error } from "../contracts/diagnostics";
import { CORE_VERSION, COMPILER_VERSION } from "../contracts/version";
import { convert } from "../frontend/convert";
import { loadProfileFile, STANDARD_PROFILE, fingerprint } from "../frontend/profile";
import { analyze, loadProgram, loadSource } from "../pipeline";
import { normalizeAst } from "../contracts/ast";

export const MANIFEST_SCHEMA = "hs-export/1";

export interface ExportManifest {
  schema: string;
  coreVersion: string;
  compilerVersion: string;
  canonical: { path: string; fingerprint: string };
  profile: { id: string; version: string; path: string; fingerprint: string };
  personal: { path: string; fingerprint: string };
}

export interface ExportOptions {
  sourceFile: string;
  profileFile: string;
  outputFile: string;
  manifestFile?: string;
}

export interface ExportResult {
  diagnostics: Diagnostic[];
  manifest?: ExportManifest;
  manifestPath?: string;
  text?: string;
}

function relativePath(fromFile: string, toPath: string): string {
  const rel = relative(dirname(fromFile), resolve(toPath));
  return rel.split("\\").join("/");
}

export function resolveManifestPath(manifestPath: string, stored: string): string {
  return isAbsolute(stored) ? stored : resolve(dirname(manifestPath), stored);
}

function samePath(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function parseManifest(raw: unknown): { manifest?: ExportManifest; diagnostic?: Diagnostic } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { diagnostic: error("E_IMPORT_MANIFEST", "export manifest must be a JSON object") };
  }
  const record = raw as Record<string, unknown>;
  if (record.schema !== MANIFEST_SCHEMA) {
    return {
      diagnostic: error("E_IMPORT_MANIFEST", `unsupported manifest schema "${String(record.schema)}"`),
    };
  }
  const canonical = record.canonical as Record<string, unknown> | undefined;
  const profile = record.profile as Record<string, unknown> | undefined;
  const personal = record.personal as Record<string, unknown> | undefined;
  if (
    !canonical ||
    typeof canonical.path !== "string" ||
    typeof canonical.fingerprint !== "string" ||
    !profile ||
    typeof profile.path !== "string" ||
    typeof profile.fingerprint !== "string" ||
    typeof profile.id !== "string" ||
    !personal ||
    typeof personal.path !== "string" ||
    typeof personal.fingerprint !== "string"
  ) {
    return {
      diagnostic: error(
        "E_IMPORT_MANIFEST",
        "export manifest is missing canonical, profile, or personal path/fingerprint fields",
      ),
    };
  }
  return { manifest: record as unknown as ExportManifest };
}

export function exportSyntax(options: ExportOptions): ExportResult {
  const diagnostics: Diagnostic[] = [];
  const profileResult = loadProfileFile(options.profileFile);
  diagnostics.push(...profileResult.diagnostics);
  if (!profileResult.loaded) return { diagnostics };
  const profile = profileResult.loaded.profile;

  const canonical = loadProgram(options.sourceFile, STANDARD_PROFILE);
  diagnostics.push(...canonical.diagnostics);
  if (!canonical.typed || !canonical.program) return { diagnostics };
  if (!canonical.tokens) {
    diagnostics.push(error("E_EXPORT_INTERNAL", "canonical token stream is unavailable"));
    return { diagnostics };
  }

  const converted = convert(canonical.tokens, STANDARD_PROFILE, profile);
  diagnostics.push(...converted.diagnostics);
  if (diagnostics.some((d) => d.severity === "error")) return { diagnostics };

  // Structural guarantee: the converted text must parse and check identically.
  const reparsed = analyze(converted.text, options.outputFile, profile);
  diagnostics.push(...reparsed.diagnostics);
  if (!reparsed.typed || !reparsed.program) return { diagnostics };
  if (JSON.stringify(normalizeAst(reparsed.program)) !== JSON.stringify(normalizeAst(canonical.program))) {
    diagnostics.push(
      error(
        "E_EXPORT_STRUCTURE",
        "converted source does not preserve the normalized AST",
        undefined,
        "this is a compiler defect; do not edit the exported file",
      ),
    );
    return { diagnostics };
  }

  const manifestPath = options.manifestFile ?? `${options.outputFile}.manifest.json`;
  const manifest: ExportManifest = {
    schema: MANIFEST_SCHEMA,
    coreVersion: CORE_VERSION,
    compilerVersion: COMPILER_VERSION,
    canonical: {
      path: relativePath(manifestPath, options.sourceFile),
      fingerprint: fingerprint(canonical.text),
    },
    profile: {
      id: profile.id,
      version: profile.version,
      path: relativePath(manifestPath, options.profileFile),
      fingerprint: profileResult.loaded.fingerprint,
    },
    personal: {
      path: relativePath(manifestPath, options.outputFile),
      fingerprint: fingerprint(converted.text),
    },
  };

  // Refuse self-overwrites: an export must never destroy the canonical source,
  // the profile, or the manifest itself.
  const outputResolved = resolve(options.outputFile);
  if (
    samePath(outputResolved, options.sourceFile) ||
    samePath(outputResolved, options.profileFile) ||
    samePath(outputResolved, manifestPath) ||
    samePath(manifestPath, options.sourceFile) ||
    samePath(manifestPath, options.profileFile)
  ) {
    diagnostics.push(
      error(
        "E_EXPORT_PATH",
        "export output and manifest must be distinct from the canonical source and profile",
        undefined,
        "choose an output path in a separate personal workspace directory",
      ),
    );
    return { diagnostics };
  }

  mkdirSync(dirname(resolve(options.outputFile)), { recursive: true });
  writeFileSync(options.outputFile, converted.text, "utf8");
  mkdirSync(dirname(resolve(manifestPath)), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { diagnostics, manifest, manifestPath, text: converted.text };
}

export interface ImportOptions {
  personalFile: string;
  manifestFile?: string;
  dryRun?: boolean;
}

export interface ImportResult {
  diagnostics: Diagnostic[];
  manifestPath?: string;
  canonicalPath?: string;
  previousText?: string;
  nextText?: string;
  diff?: string;
  applied?: boolean;
}

export function importSyntax(options: ImportOptions): ImportResult {
  const diagnostics: Diagnostic[] = [];
  const manifestPath = options.manifestFile ?? `${options.personalFile}.manifest.json`;

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (cause) {
    return {
      diagnostics: [
        error(
          "E_IMPORT_MANIFEST",
          `cannot read export manifest "${manifestPath}": ${(cause as Error).message}`,
        ),
      ],
    };
  }
  const parsedManifest = parseManifest(rawManifest);
  if (!parsedManifest.manifest) return { diagnostics: [parsedManifest.diagnostic!] };
  const manifest = parsedManifest.manifest;

  const declaredPersonalPath = resolveManifestPath(manifestPath, manifest.personal.path);
  if (!samePath(declaredPersonalPath, options.personalFile)) {
    return {
      diagnostics: [
        error(
          "E_IMPORT_MANIFEST",
          `manifest belongs to personal file "${declaredPersonalPath}", not "${options.personalFile}"`,
          undefined,
          "pass the matching --manifest or import the file named in the manifest",
        ),
      ],
    };
  }

  const personalSource = loadSource(options.personalFile);
  diagnostics.push(...personalSource.diagnostics);
  if (personalSource.text === undefined) return { diagnostics };

  const profilePath = resolveManifestPath(manifestPath, manifest.profile.path);
  const profileResult = loadProfileFile(profilePath);
  diagnostics.push(...profileResult.diagnostics);
  if (!profileResult.loaded) return { diagnostics };
  if (profileResult.loaded.fingerprint !== manifest.profile.fingerprint) {
    diagnostics.push(
      error(
        "E_IMPORT_PROFILE_CHANGED",
        `profile "${profileResult.loaded.profile.id}" changed since export`,
        undefined,
        "re-export the canonical source with the current profile before importing",
      ),
    );
    return { diagnostics };
  }

  const canonicalPath = resolveManifestPath(manifestPath, manifest.canonical.path);
  const canonicalSource = loadSource(canonicalPath);
  diagnostics.push(...canonicalSource.diagnostics);
  if (canonicalSource.text === undefined) return { diagnostics };
  if (fingerprint(canonicalSource.text) !== manifest.canonical.fingerprint) {
    diagnostics.push(
      error(
        "E_IMPORT_STALE_BASE",
        `canonical source "${canonicalPath}" changed after the personal file was exported`,
        undefined,
        "rebase manually or re-export from the current canonical source; automatic merging is out of scope",
      ),
    );
    return { diagnostics };
  }

  const personal = analyze(personalSource.text, options.personalFile, profileResult.loaded.profile);
  diagnostics.push(...personal.diagnostics);
  if (!personal.typed || !personal.tokens) return { diagnostics };

  const converted = convert(personal.tokens, profileResult.loaded.profile, STANDARD_PROFILE);
  diagnostics.push(...converted.diagnostics);
  if (diagnostics.some((d) => d.severity === "error")) return { diagnostics };

  const canonicalChecked = analyze(converted.text, canonicalPath, STANDARD_PROFILE);
  diagnostics.push(...canonicalChecked.diagnostics);
  if (!canonicalChecked.typed) return { diagnostics };

  const diff = lineDiff(canonicalSource.text, converted.text);
  if (!options.dryRun) {
    writeFileSync(canonicalPath, converted.text, "utf8");
    // The imported edit becomes the new shared base. Refresh the manifest so
    // the next edit/import cycle validates against the current files.
    const updated: ExportManifest = {
      ...manifest,
      canonical: { ...manifest.canonical, fingerprint: fingerprint(converted.text) },
      personal: { ...manifest.personal, fingerprint: fingerprint(personalSource.text) },
    };
    writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  }

  return {
    diagnostics,
    manifestPath,
    canonicalPath,
    previousText: canonicalSource.text,
    nextText: converted.text,
    diff,
    applied: !options.dryRun,
  };
}

/** Minimal LCS-based line diff for user-visible import summaries. */
export function lineDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push(`- ${a[i]}`);
      i++;
    } else {
      lines.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < a.length) lines.push(`- ${a[i++]}`);
  while (j < b.length) lines.push(`+ ${b[j++]}`);
  return lines.join("\n");
}
