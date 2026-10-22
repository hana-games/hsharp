export interface SourceLocation {
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column, counted in UTF-16 code units. */
  column: number;
  /** 0-based offset in the source text. */
  offset: number;
}

export interface SourceSpan {
  file: string;
  start: SourceLocation;
  end: SourceLocation;
}

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  span?: SourceSpan;
  /** Optional actionable hint printed below the message. */
  hint?: string;
}

export function spanAt(file: string, line: number, column: number, offset: number): SourceSpan {
  const location: SourceLocation = { file, line, column, offset };
  return { file, start: location, end: { ...location } };
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = diagnostic.span
    ? `${diagnostic.span.file}:${diagnostic.span.start.line}:${diagnostic.span.start.column}`
    : "<config>";
  const first = `${location}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
  return diagnostic.hint ? `${first}\n  hint: ${diagnostic.hint}` : first;
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

export class HsDiagnosticError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(formatDiagnostic(diagnostic));
    this.name = "HsDiagnosticError";
  }
}

export function error(code: string, message: string, span?: SourceSpan, hint?: string): Diagnostic {
  return { code, severity: "error", message, span, hint };
}
