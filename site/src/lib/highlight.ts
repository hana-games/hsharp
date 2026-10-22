export type TokenType =
  | "comment"
  | "keyword"
  | "type"
  | "number"
  | "string"
  | "operator"
  | "plain";

export interface Token {
  text: string;
  type: TokenType;
}

const targetKeywords: Record<string, Set<string>> = {
  csharp: new Set([
    "using", "internal", "static", "class", "readonly", "struct", "public", "private", "new",
    "return", "if", "else", "bool", "int", "long", "void", "string", "true", "false", "null",
    "out", "var", "foreach", "in", "as", "is", "checked", "unchecked", "Main",
  ]),
  rust: new Set([
    "use", "struct", "impl", "fn", "let", "mut", "if", "else", "return", "bool", "i32", "i64",
    "true", "false", "match", "Ok", "Err", "Res", "as", "pub", "for", "in", "loop", "while",
  ]),
  go: new Set([
    "package", "import", "func", "var", "const", "type", "struct", "return", "if", "else",
    "for", "range", "bool", "int", "int32", "int64", "string", "true", "false", "nil", "defer",
    "go", "chan", "map", "case", "switch", "default",
  ]),
  java: new Set([
    "package", "import", "public", "private", "static", "final", "class", "return", "if", "else",
    "boolean", "int", "long", "void", "String", "true", "false", "null", "new", "this", "try",
    "catch", "throw", "throws",
  ]),
  json: new Set(["true", "false", "null"]),
  bash: new Set(["npm", "node", "hs", "curl", "cd", "git", "code", "dotnet", "cargo", "go", "javac", "java"]),
};

const hsharpTypes = new Set(["i32", "bool"]);

export function tokenize(
  code: string,
  language: string,
  keywords: string[] | Record<string, string> = [],
): Token[] {
  const configuredKeywords = Array.isArray(keywords) ? keywords : Object.values(keywords ?? {});
  const keywordSet =
    language === "hsharp"
      ? new Set([
          ...(configuredKeywords.length > 0
            ? configuredKeywords
            : ["fn", "let", "if", "else", "return", "true", "false"]),
          ...hsharpTypes,
        ])
      : targetKeywords[language] ?? new Set<string>();
  const typeSet = language === "hsharp" ? hsharpTypes : new Set<string>();

  const tokens: Token[] = [];
  let plain = "";
  let i = 0;

  const flush = () => {
    if (plain.length > 0) {
      tokens.push({ text: plain, type: "plain" });
      plain = "";
    }
  };
  const push = (text: string, type: TokenType) => {
    flush();
    tokens.push({ text, type });
  };

  while (i < code.length) {
    const current = code[i];

    if (current === "/" && code[i + 1] === "/") {
      const start = i;
      i += 2;
      while (i < code.length && code[i] !== "\n") i++;
      push(code.slice(start, i), "comment");
      continue;
    }

    if (current === '"' || current === "'" || current === "`") {
      const quote = current;
      const start = i;
      i++;
      while (i < code.length) {
        if (code[i] === "\\" && quote !== "`") {
          i += 2;
          continue;
        }
        if (code[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      push(code.slice(start, i), "string");
      continue;
    }

    if (/[A-Za-z_]/.test(current)) {
      const start = i;
      i++;
      while (i < code.length && /[A-Za-z0-9_]/.test(code[i])) i++;
      const word = code.slice(start, i);
      if (typeSet.has(word)) push(word, "type");
      else if (keywordSet.has(word)) push(word, "keyword");
      else plain += word;
      continue;
    }

    if (/[0-9]/.test(current)) {
      const start = i;
      i++;
      while (i < code.length && /[0-9]/.test(code[i])) i++;
      push(code.slice(start, i), "number");
      continue;
    }

    if (/[+\-*/=<>!&|%^~?:]/.test(current)) {
      const start = i;
      i++;
      while (i < code.length && /[+\-*/=<>!&|%^~?:]/.test(code[i])) i++;
      push(code.slice(start, i), "operator");
      continue;
    }

    plain += current;
    i++;
  }

  flush();
  return tokens;
}
