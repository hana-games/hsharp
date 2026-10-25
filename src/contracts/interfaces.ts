import type { Program } from "./ast";
import type { Diagnostic } from "./diagnostics";
import type { Outcome, RuntimeArguments, TypedProgram } from "./outcome";
import type { Profile } from "./profile";
import type { SourceText } from "./tokens";

export type TargetId = "csharp" | "rust" | "go" | "java" | "cpp" | "javascript";

export const TARGET_IDS: readonly TargetId[] = [
  "csharp",
  "rust",
  "go",
  "java",
  "cpp",
  "javascript",
];

export interface ParseResult {
  program?: Program;
  tokens: SourceText;
  diagnostics: Diagnostic[];
}

export interface EmitResult {
  target: TargetId;
  files: { path: string; content: string }[];
}

export interface GeneratedProject extends EmitResult {
  /** Command that builds the project inside its directory. */
  build: string[];
  /** Command that runs the entry point; arguments are appended by the caller. */
  run: string[];
}

export interface ParseFunction {
  (text: string, profile: Profile, file: string): ParseResult;
}

export interface CheckFunction {
  (program: Program): { typed?: TypedProgram; diagnostics: Diagnostic[] };
}

export interface EvaluateFunction {
  (program: TypedProgram, entry: string, args: RuntimeArguments): Outcome;
}

export interface EmitFunction {
  (program: TypedProgram, entry: string, options?: { projectName?: string }): GeneratedProject;
}

export interface ConvertFunction {
  (source: SourceText, from: Profile, to: Profile): { text: string; diagnostics: Diagnostic[] };
}
