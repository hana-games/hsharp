import { readFileSync } from "node:fs";
import type { Program } from "./contracts/ast";
import type { Diagnostic } from "./contracts/diagnostics";
import { error } from "./contracts/diagnostics";
import type { TypedProgram } from "./contracts/outcome";
import type { Profile } from "./contracts/profile";
import type { SourceText } from "./contracts/tokens";
import { parse } from "./frontend/parser";
import { STANDARD_PROFILE } from "./frontend/profile";
import { check } from "./semantic/checker";

export interface LoadedProgram {
  file: string;
  text: string;
  profile: Profile;
  tokens?: SourceText;
  program?: Program;
  typed?: TypedProgram;
  diagnostics: Diagnostic[];
}

export function loadSource(file: string): { text?: string; diagnostics: Diagnostic[] } {
  try {
    return { text: readFileSync(file, "utf8").replace(/^\uFEFF/, ""), diagnostics: [] };
  } catch (cause) {
    return {
      diagnostics: [
        error("E_SOURCE_IO", `cannot read source file "${file}": ${(cause as Error).message}`),
      ],
    };
  }
}

export function analyze(text: string, file: string, profile: Profile = STANDARD_PROFILE): LoadedProgram {
  text = text.replace(/^\uFEFF/, "");
  const parsed = parse(text, profile, file);
  const diagnostics = [...parsed.diagnostics];
  if (!parsed.program) {
    return { file, text, profile, tokens: { file, text, tokens: parsed.tokens }, diagnostics };
  }
  const checked = check(parsed.program);
  diagnostics.push(...checked.diagnostics);
  const tokens: SourceText = { file, text, tokens: parsed.tokens };
  return {
    file,
    text,
    profile,
    tokens,
    program: parsed.program,
    typed: checked.typed,
    diagnostics,
  };
}

export function loadProgram(file: string, profile: Profile = STANDARD_PROFILE): LoadedProgram {
  const source = loadSource(file);
  if (source.text === undefined) {
    return { file, text: "", profile, diagnostics: source.diagnostics };
  }
  return analyze(source.text, file, profile);
}
