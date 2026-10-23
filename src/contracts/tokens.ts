import type { SourceSpan } from "./diagnostics";

export type KeywordRole = "fn" | "let" | "if" | "else" | "return" | "true" | "false";

export const KEYWORD_ROLES: readonly KeywordRole[] = [
  "fn",
  "let",
  "if",
  "else",
  "return",
  "true",
  "false",
];

export const CANONICAL_KEYWORDS: Readonly<Record<KeywordRole, string>> = {
  fn: "fn",
  let: "let",
  if: "if",
  else: "else",
  return: "return",
  true: "true",
  false: "false",
};

/** Primitive types spelled directly in source. Record names are also types. */
export const TYPE_NAMES = ["i32", "bool"] as const;
export type PrimitiveTypeName = (typeof TYPE_NAMES)[number];

/** A resolved type: a primitive or a declared record name. */
export type TypeName = string;

export function isPrimitiveTypeName(name: string): name is PrimitiveTypeName {
  return name === "i32" || name === "bool";
}

export type TokenKind =
  | "keyword"
  | "type"
  | "identifier"
  | "integer"
  | "punct"
  | "reserved"
  | "whitespace"
  | "comment"
  | "eof"
  | "invalid";

export interface Token {
  kind: TokenKind;
  /** Exact source text of the token. For eof this is the empty string. */
  text: string;
  /** Set for kind === "keyword". */
  role?: KeywordRole;
  /** Set for kind === "type". */
  typeName?: PrimitiveTypeName;
  /** Absolute span including start/end offsets and line/column. */
  span: SourceSpan;
}

export function isTrivia(token: Token): boolean {
  return token.kind === "whitespace" || token.kind === "comment";
}

/** A complete token stream, including whitespace and comments. */
export interface SourceText {
  file: string;
  text: string;
  tokens: Token[];
}
