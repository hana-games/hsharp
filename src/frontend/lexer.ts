import type { Diagnostic, SourceLocation, SourceSpan } from "../contracts/diagnostics";
import { error, spanAt } from "../contracts/diagnostics";
import type { Profile } from "../contracts/profile";
import {
  CANONICAL_KEYWORDS,
  TYPE_NAMES,
  type KeywordRole,
  type Token,
  type TokenKind,
} from "../contracts/tokens";
import { profileKeywordMap } from "./profile";

const TWO_CHAR_PUNCT = ["->", "==", "!=", "<=", ">=", "&&", "||"];
const ONE_CHAR_PUNCT = "(){}:;,=+-*!<>.";

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

class Locator {
  private readonly lineStarts: number[] = [0];

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") this.lineStarts.push(i + 1);
    }
  }

  location(offset: number): SourceLocation {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return {
      file: "",
      line: low + 1,
      column: offset - this.lineStarts[low] + 1,
      offset,
    };
  }

  span(file: string, start: number, end: number): SourceSpan {
    return {
      file,
      start: { ...this.location(start), file },
      end: { ...this.location(end), file },
    };
  }
}

/**
 * Lexes an entire source file, preserving whitespace and comments so the token
 * stream can be re-printed for syntax conversion.
 */
export function lex(text: string, profile: Profile, file: string): LexResult {
  const diagnostics: Diagnostic[] = [];
  const tokens: Token[] = [];
  const locator = new Locator(text);
  const active = profileKeywordMap(profile);
  const canonical = new Set(Object.values(CANONICAL_KEYWORDS));
  const typeNames = new Set<string>(TYPE_NAMES);

  const push = (kind: TokenKind, start: number, end: number, extra: Partial<Token> = {}): void => {
    tokens.push({
      kind,
      text: text.slice(start, end),
      span: locator.span(file, start, end),
      ...extra,
    });
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];

    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      const start = i;
      while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\r" || text[i] === "\n")) i++;
      push("whitespace", start, i);
      continue;
    }

    if (char === "/" && text[i + 1] === "/") {
      const start = i;
      i += 2;
      while (i < text.length && text[i] !== "\n") i++;
      push("comment", start, i);
      continue;
    }

    if (char === "/" || char === "%") {
      const start = i;
      i += 1;
      diagnostics.push(
        error("E_UNSUPPORTED_OPERATOR", `operator "${char}" is not part of the POC core`, locator.span(file, start, i)),
      );
      push("invalid", start, i);
      continue;
    }

    if (isIdentifierStart(charCodeAt(text, i))) {
      const start = i;
      i += 1;
      while (i < text.length && isIdentifierPart(charCodeAt(text, i))) i++;
      const word = text.slice(start, i);
      const role = active.get(word);
      if (role !== undefined) {
        push("keyword", start, i, { role });
      } else if (typeNames.has(word)) {
        push("type", start, i, { typeName: word as "i32" | "bool" | "string" });
      } else if (canonical.has(word)) {
        push("reserved", start, i);
        diagnostics.push(
          error(
            "E_RESERVED_WORD",
            `"${word}" is a reserved canonical keyword and cannot be used with profile "${profile.id}"`,
            locator.span(file, start, i),
            `use the profile word for this role instead`,
          ),
        );
      } else {
        push("identifier", start, i);
      }
      continue;
    }

    if (isDigit(charCodeAt(text, i))) {
      const start = i;
      i += 1;
      while (i < text.length && isDigit(charCodeAt(text, i))) i++;
      push("integer", start, i);
      continue;
    }

    if (char === '"') {
      const start = i;
      i += 1;
      let closed = false;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        diagnostics.push(
          error("E_STRING_UNTERMINATED", "unterminated string literal", locator.span(file, start, i)),
        );
      }
      push("string", start, i);
      continue;
    }

    if (char === "'") {
      const start = i;
      i += 1;
      diagnostics.push(
        error("E_UNSUPPORTED_LITERAL", "single-quoted literals are not part of the POC core", locator.span(file, start, i)),
      );
      push("invalid", start, i);
      continue;
    }

    const two = text.slice(i, i + 2);
    if (TWO_CHAR_PUNCT.includes(two)) {
      push("punct", i, i + 2);
      i += 2;
      continue;
    }

    if (ONE_CHAR_PUNCT.includes(char)) {
      push("punct", i, i + 1);
      i += 1;
      continue;
    }

    const start = i;
    i += 1;
    diagnostics.push(
      error("E_UNEXPECTED_CHARACTER", `unexpected character "${char}"`, locator.span(file, start, i)),
    );
    push("invalid", start, i);
  }

  push("eof", text.length, text.length);
  return { tokens, diagnostics };
}

export function keywordRoleOf(token: Token): KeywordRole | undefined {
  return token.kind === "keyword" ? token.role : undefined;
}

export function isPunct(token: Token, text: string): boolean {
  return token.kind === "punct" && token.text === text;
}

export function isKeyword(token: Token, role: KeywordRole): boolean {
  return token.kind === "keyword" && token.role === role;
}

export function meaningfulTokens(tokens: Token[]): Token[] {
  return tokens.filter((t) => t.kind !== "whitespace" && t.kind !== "comment");
}

export function eofSpan(file: string, text: string): SourceSpan {
  const lines = text.split("\n");
  const line = lines.length;
  const column = (lines[lines.length - 1]?.length ?? 0) + 1;
  return spanAt(file, line, column, text.length);
}

function charCodeAt(text: string, index: number): number {
  return index < text.length ? text.charCodeAt(index) : -1;
}

function isIdentifierStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isIdentifierPart(code: number): boolean {
  return isIdentifierStart(code) || (code >= 48 && code <= 57);
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}
