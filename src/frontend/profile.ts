import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Diagnostic } from "../contracts/diagnostics";
import { error } from "../contracts/diagnostics";
import type { LoadedProfile, Profile } from "../contracts/profile";
import {
  CANONICAL_KEYWORDS,
  KEYWORD_ROLES,
  TYPE_NAMES,
  type KeywordRole,
} from "../contracts/tokens";
import { CORE_VERSION, LANGUAGE_FAMILY, PROFILE_SCHEMA_VERSION } from "../contracts/version";

const TOP_LEVEL_KEYS = new Set(["id", "version", "core", "family", "keywords"]);
const WORD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const STANDARD_PROFILE: Profile = {
  id: "standard",
  version: PROFILE_SCHEMA_VERSION,
  core: CORE_VERSION,
  family: LANGUAGE_FAMILY,
  keywords: { ...CANONICAL_KEYWORDS },
};

export function fingerprint(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function profileKeywordMap(profile: Profile): Map<string, KeywordRole> {
  const map = new Map<string, KeywordRole>();
  for (const role of KEYWORD_ROLES) map.set(profile.keywords[role], role);
  return map;
}

export function canonicalKeywordSet(): Set<string> {
  return new Set(Object.values(CANONICAL_KEYWORDS));
}

export function typeNameSet(): Set<string> {
  return new Set(TYPE_NAMES);
}

export interface ProfileValidation {
  profile?: Profile;
  diagnostics: Diagnostic[];
}

/** Validates a parsed JSON value against the POC profile schema. */
export function validateProfile(raw: unknown): ProfileValidation {
  const diagnostics: Diagnostic[] = [];

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { diagnostics: [error("E_PROFILE_SHAPE", "profile must be a JSON object")] };
  }

  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      diagnostics.push(
        error("E_PROFILE_UNKNOWN_OPTION", `unknown profile option "${key}"`, undefined, "the POC profile format has no executable or grammar extensions"),
      );
    }
  }

  const id = record.id;
  if (typeof id !== "string" || id.length === 0) {
    diagnostics.push(error("E_PROFILE_ID", "profile \"id\" must be a non-empty string"));
  } else if (!ID_PATTERN.test(id)) {
    diagnostics.push(error("E_PROFILE_ID", `profile id "${id}" must use letters, digits, dot, dash, or underscore`));
  }

  if (record.version !== PROFILE_SCHEMA_VERSION) {
    diagnostics.push(
      error(
        "E_PROFILE_VERSION",
        `profile version must be "${PROFILE_SCHEMA_VERSION}" (received ${JSON.stringify(record.version)})`,
      ),
    );
  }

  if (record.core !== CORE_VERSION) {
    diagnostics.push(
      error(
        "E_PROFILE_CORE_VERSION",
        `profile targets core ${JSON.stringify(record.core)} but this compiler implements core "${CORE_VERSION}" only`,
        undefined,
        "regenerate the profile from the documented core version",
      ),
    );
  }

  if (record.family !== LANGUAGE_FAMILY) {
    diagnostics.push(
      error(
        "E_PROFILE_FAMILY",
        `profile family must be "${LANGUAGE_FAMILY}" for this compiler (received ${JSON.stringify(record.family)})`,
      ),
    );
  }

  const keywordsRaw = record.keywords;
  if (keywordsRaw === null || typeof keywordsRaw !== "object" || Array.isArray(keywordsRaw)) {
    diagnostics.push(error("E_PROFILE_KEYWORDS", "profile \"keywords\" must be an object"));
    return { diagnostics };
  }

  const keywordsRecord = keywordsRaw as Record<string, unknown>;
  for (const key of Object.keys(keywordsRecord)) {
    if (!(KEYWORD_ROLES as readonly string[]).includes(key)) {
      diagnostics.push(error("E_PROFILE_UNKNOWN_ROLE", `unknown keyword role "${key}"`));
    }
  }

  const keywords = {} as Record<KeywordRole, string>;
  for (const role of KEYWORD_ROLES) {
    const word = keywordsRecord[role];
    if (typeof word !== "string") {
      diagnostics.push(error("E_PROFILE_MISSING_ROLE", `missing keyword role "${role}"`));
      continue;
    }
    if (!WORD_PATTERN.test(word)) {
      diagnostics.push(
        error("E_PROFILE_KEYWORD_FORM", `keyword for "${role}" must match [A-Za-z_][A-Za-z0-9_]* (received "${word}")`),
      );
      continue;
    }
    keywords[role] = word;
  }

  // Role words must be distinct. Two roles sharing one word makes parsing ambiguous.
  const seen = new Map<string, KeywordRole>();
  for (const role of KEYWORD_ROLES) {
    const word = keywords[role];
    if (word === undefined) continue;
    const other = seen.get(word);
    if (other !== undefined && other !== role) {
      diagnostics.push(
        error(
          "E_PROFILE_DUPLICATE_KEYWORD",
          `keyword "${word}" is used for both "${other}" and "${role}"`,
        ),
      );
    } else {
      seen.set(word, role);
    }
  }

  // Canonical keywords and type names remain reserved even when remapped.
  for (const role of KEYWORD_ROLES) {
    const word = keywords[role];
    if (word === undefined) continue;
    if (word === "record") {
      diagnostics.push(
        error(
          "E_PROFILE_RESERVED_KEYWORD",
          `keyword "${word}" for "${role}" collides with fixed record declaration syntax`,
        ),
      );
      continue;
    }
    if ((TYPE_NAMES as readonly string[]).includes(word)) {
      diagnostics.push(
        error(
          "E_PROFILE_RESERVED_KEYWORD",
          `keyword "${word}" for "${role}" collides with a reserved type name`,
        ),
      );
      continue;
    }
    for (const canonicalRole of KEYWORD_ROLES) {
      if (word === CANONICAL_KEYWORDS[canonicalRole] && canonicalRole !== role) {
        diagnostics.push(
          error(
            "E_PROFILE_RESERVED_KEYWORD",
            `keyword "${word}" for "${role}" is the canonical keyword for "${canonicalRole}" and cannot be reassigned`,
            undefined,
            `use "${word}" only for "${canonicalRole}", or pick another word`,
          ),
        );
      }
    }
  }

  for (const role of KEYWORD_ROLES) {
    if (keywords[role] === undefined) keywords[role] = CANONICAL_KEYWORDS[role];
  }

  if (diagnostics.length > 0) return { diagnostics };
  return {
    profile: {
      id: id as string,
      version: PROFILE_SCHEMA_VERSION,
      core: CORE_VERSION,
      family: LANGUAGE_FAMILY,
      keywords,
    },
    diagnostics,
  };
}

export function loadProfileFile(path: string): { loaded?: LoadedProfile; diagnostics: Diagnostic[] } {
  let text: string;
  try {
    text = readFileSync(resolve(path), "utf8").replace(/^\uFEFF/, "");
  } catch (cause) {
    return {
      diagnostics: [
        error("E_PROFILE_IO", `cannot read profile "${path}": ${(cause as Error).message}`),
      ],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    return {
      diagnostics: [
        error("E_PROFILE_JSON", `profile "${path}" is not valid JSON: ${(cause as Error).message}`),
      ],
    };
  }

  const validation = validateProfile(raw);
  if (!validation.profile) return { diagnostics: validation.diagnostics };
  const profile = { ...validation.profile, path: resolve(path) };
  return {
    loaded: { profile, text, fingerprint: fingerprint(text) },
    diagnostics: validation.diagnostics,
  };
}
