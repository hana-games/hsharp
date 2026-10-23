import type {
  BinaryOp,
  Block,
  CallExpr,
  Expr,
  FieldAccess,
  FunctionDecl,
  IfStmt,
  IntLiteral,
  LetStmt,
  Param,
  Program,
  RecordDecl,
  RecordField,
  RecordFieldInitializer,
  RecordLiteral,
  ReturnStmt,
  Stmt,
  TypeRef,
  UnaryOp,
} from "../contracts/ast";
import type { Diagnostic, SourceSpan } from "../contracts/diagnostics";
import { error } from "../contracts/diagnostics";
import type { Profile } from "../contracts/profile";
import type { Token } from "../contracts/tokens";
import { isKeyword, isPunct, lex, meaningfulTokens } from "./lexer";

const I32_MIN = -2147483648;
/** The one positive magnitude that is legal only as the operand of unary minus. */
const SPECIAL_I32_MIN_MAGNITUDE = 2147483648;

class ParseFailure extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

export interface ParseOutput {
  program?: Program;
  tokens: Token[];
  diagnostics: Diagnostic[];
}

export function parse(text: string, profile: Profile, file: string): ParseOutput {
  const lexed = lex(text, profile, file);
  if (lexed.diagnostics.some((d) => d.severity === "error")) {
    return { tokens: lexed.tokens, diagnostics: lexed.diagnostics };
  }

  const parser = new Parser(meaningfulTokens(lexed.tokens), text, file);
  try {
    const program = parser.parseProgram();
    return { program, tokens: lexed.tokens, diagnostics: lexed.diagnostics };
  } catch (cause) {
    if (cause instanceof ParseFailure) {
      return { tokens: lexed.tokens, diagnostics: [...lexed.diagnostics, cause.diagnostic] };
    }
    throw cause;
  }
}

class Parser {
  private index = 0;
  private nextId = 0;
  private readonly declaredRecordNames = new Set<string>();

  constructor(
    private readonly tokens: Token[],
    private readonly text: string,
    private readonly file: string,
  ) {
    // `record` is fixed data syntax, not a profile keyword. Identify declared
    // record names up front so a record literal can be told apart from the
    // block that follows an if condition.
    for (let offset = 0; offset + 2 < tokens.length; offset++) {
      const token = tokens[offset];
      const name = tokens[offset + 1];
      const open = tokens[offset + 2];
      if (
        token.kind === "identifier" &&
        token.text === "record" &&
        name.kind === "identifier" &&
        isPunct(open, "{")
      ) {
        this.declaredRecordNames.add(name.text);
      }
    }
  }

  parseProgram(): Program {
    const start = this.current().span.start;
    const records: RecordDecl[] = [];
    const functions: FunctionDecl[] = [];
    while (!this.atEnd()) {
      if (this.current().kind === "identifier" && this.current().text === "record") {
        records.push(this.parseRecord());
      } else {
        functions.push(this.parseFunction());
      }
    }
    const end = this.current().span.end;
    return {
      kind: "Program",
      id: this.nextId++,
      span: { file: this.file, start, end },
      records,
      functions,
      sourceText: this.text,
    };
  }

  private parseRecord(): RecordDecl {
    const recordToken = this.expectIdentifier("record name");
    const nameToken = this.expectIdentifier("record name");
    this.expectPunct("{");
    const fields: RecordField[] = [];
    while (!isPunct(this.current(), "}")) {
      if (this.atEnd()) throw this.fail("E_SYNTAX", "unclosed record; expected \"}\"", this.current());
      const fieldName = this.expectIdentifier("field name");
      this.expectPunct(":");
      const type = this.parseType();
      fields.push({
        kind: "RecordField",
        id: this.nextId++,
        span: { file: this.file, start: fieldName.span.start, end: type.span.end },
        name: fieldName.text,
        nameSpan: fieldName.span,
        type,
      });
      if (!this.matchPunct(",")) break;
    }
    const close = this.expectPunct("}");
    return {
      kind: "RecordDecl",
      id: this.nextId++,
      span: { file: this.file, start: recordToken.span.start, end: close.span.end },
      name: nameToken.text,
      nameSpan: nameToken.span,
      fields,
    };
  }

  private parseFunction(): FunctionDecl {
    const fnToken = this.expectKeyword("fn");
    const nameToken = this.expectIdentifier("function name");
    this.expectPunct("(");
    const params: Param[] = [];
    if (!isPunct(this.current(), ")")) {
      do {
        const paramName = this.expectIdentifier("parameter name");
        this.expectPunct(":");
        const type = this.parseType();
        params.push({
          kind: "Param",
          id: this.nextId++,
          span: { file: this.file, start: paramName.span.start, end: type.span.end },
          name: paramName.text,
          nameSpan: paramName.span,
          type,
        });
      } while (this.matchPunct(","));
    }
    this.expectPunct(")");
    this.expectPunct("->");
    const returnType = this.parseType();
    const body = this.parseBlock();

    return {
      kind: "FunctionDecl",
      id: this.nextId++,
      span: { file: this.file, start: fnToken.span.start, end: body.span.end },
      name: nameToken.text,
      nameSpan: nameToken.span,
      params,
      returnType,
      body,
    };
  }

  private parseType(): TypeRef {
    const token = this.current();
    if (token.kind === "type" && token.typeName !== undefined) {
      this.advance();
      return { kind: "TypeRef", id: this.nextId++, span: token.span, name: token.typeName };
    }
    if (token.kind === "identifier") {
      this.advance();
      return { kind: "TypeRef", id: this.nextId++, span: token.span, name: token.text };
    }
    throw this.fail("E_SYNTAX", `expected a type but found ${describe(token)}`, token);
  }

  private parseBlock(): Block {
    const open = this.expectPunct("{");
    const statements: Stmt[] = [];
    while (!isPunct(this.current(), "}")) {
      if (this.atEnd()) throw this.fail("E_SYNTAX", "unclosed block; expected \"}\"", this.current());
      statements.push(this.parseStatement());
    }
    const close = this.expectPunct("}");
    return {
      kind: "Block",
      id: this.nextId++,
      span: { file: this.file, start: open.span.start, end: close.span.end },
      statements,
    };
  }

  private parseStatement(): Stmt {
    const token = this.current();
    if (isKeyword(token, "let")) return this.parseLet();
    if (isKeyword(token, "if")) return this.parseIf();
    if (isKeyword(token, "return")) return this.parseReturn();
    throw this.fail(
      "E_SYNTAX",
      `expected "let", "if", or "return" but found ${describe(token)}`,
      token,
      this.expectedKeywordHint(token),
    );
  }

  private parseLet(): LetStmt {
    const letToken = this.expectKeyword("let");
    const nameToken = this.expectIdentifier("variable name");
    this.expectPunct(":");
    const type = this.parseType();
    this.expectPunct("=");
    const value = this.parseExpression();
    const semicolon = this.expectPunct(";");
    return {
      kind: "LetStmt",
      id: this.nextId++,
      span: { file: this.file, start: letToken.span.start, end: semicolon.span.end },
      name: nameToken.text,
      nameSpan: nameToken.span,
      type,
      value,
    };
  }

  private parseIf(): IfStmt {
    const ifToken = this.expectKeyword("if");
    const condition = this.parseExpression();
    const thenBlock = this.parseBlock();
    let elseBlock: Block | undefined;
    if (isKeyword(this.current(), "else")) {
      this.advance();
      if (isKeyword(this.current(), "if")) {
        const nested = this.parseIf();
        elseBlock = {
          kind: "Block",
          id: this.nextId++,
          span: nested.span,
          statements: [nested],
        };
      } else {
        elseBlock = this.parseBlock();
      }
    }
    const end = elseBlock ? elseBlock.span.end : thenBlock.span.end;
    return {
      kind: "IfStmt",
      id: this.nextId++,
      span: { file: this.file, start: ifToken.span.start, end },
      condition,
      thenBlock,
      elseBlock,
    };
  }

  private parseReturn(): ReturnStmt {
    const returnToken = this.expectKeyword("return");
    const value = this.parseExpression();
    const semicolon = this.expectPunct(";");
    return {
      kind: "ReturnStmt",
      id: this.nextId++,
      span: { file: this.file, start: returnToken.span.start, end: semicolon.span.end },
      value,
    };
  }

  private parseExpression(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (isPunct(this.current(), "||")) {
      const token = this.advance();
      const right = this.parseAnd();
      left = this.binary("||", left, right, token.span.start);
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseEquality();
    while (isPunct(this.current(), "&&")) {
      const token = this.advance();
      const right = this.parseEquality();
      left = this.binary("&&", left, right, token.span.start);
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseOrdering();
    let compared = false;
    while (isPunct(this.current(), "==") || isPunct(this.current(), "!=")) {
      if (compared || (isComparison(left) && !left.grouped)) throw this.chainedComparison();
      const token = this.advance();
      const right = this.parseOrdering();
      if (isComparison(right) && !right.grouped) throw this.chainedComparison();
      left = this.binary(token.text as BinaryOp, left, right, token.span.start);
      compared = true;
    }
    return left;
  }

  private parseOrdering(): Expr {
    let left = this.parseAdditive();
    let compared = false;
    while (
      isPunct(this.current(), "<") ||
      isPunct(this.current(), "<=") ||
      isPunct(this.current(), ">") ||
      isPunct(this.current(), ">=")
    ) {
      if (compared) throw this.chainedComparison();
      const token = this.advance();
      const right = this.parseAdditive();
      left = this.binary(token.text as BinaryOp, left, right, token.span.start);
      compared = true;
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (isPunct(this.current(), "+") || isPunct(this.current(), "-")) {
      const token = this.advance();
      const right = this.parseMultiplicative();
      left = this.binary(token.text as BinaryOp, left, right, token.span.start);
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (isPunct(this.current(), "*")) {
      const token = this.advance();
      const right = this.parseUnary();
      left = this.binary("*", left, right, token.span.start);
    }
    return left;
  }

  private parseUnary(): Expr {
    if (isPunct(this.current(), "-")) {
      const minus = this.current();
      const next = this.peek(1);
      if (next.kind === "integer" && Number(next.text) === SPECIAL_I32_MIN_MAGNITUDE) {
        this.advance();
        this.advance();
        return {
          kind: "IntLiteral",
          id: this.nextId++,
          span: { file: this.file, start: minus.span.start, end: next.span.end },
          value: I32_MIN,
        };
      }
      this.advance();
      const operand = this.parseUnary();
      return this.unary("-", operand, minus.span.start);
    }
    if (isPunct(this.current(), "!")) {
      const bang = this.advance();
      const operand = this.parseUnary();
      return this.unary("!", operand, bang.span.start);
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    while (isPunct(this.current(), ".")) {
      this.advance();
      const field = this.expectIdentifier("field name");
      const access: FieldAccess = {
        kind: "FieldAccess",
        id: this.nextId++,
        span: { file: this.file, start: expr.span.start, end: field.span.end },
        target: expr,
        field: field.text,
        fieldSpan: field.span,
      };
      expr = access;
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const token = this.current();
    if (token.kind === "integer") {
      const parsed = Number(token.text);
      if (!Number.isSafeInteger(parsed) || parsed > SPECIAL_I32_MIN_MAGNITUDE) {
        throw this.fail(
          "E_INT_RANGE",
          `integer literal ${token.text} is outside the i32 range`,
          token,
          "accepted range is -2147483648 through 2147483647",
        );
      }
      if (parsed === SPECIAL_I32_MIN_MAGNITUDE) {
        throw this.fail(
          "E_INT_RANGE",
          "2147483648 is out of range as a positive i32 literal",
          token,
          "write -2147483648 to represent the minimum value",
        );
      }
      this.advance();
      const literal: IntLiteral = {
        kind: "IntLiteral",
        id: this.nextId++,
        span: token.span,
        value: parsed,
      };
      return literal;
    }

    if (isKeyword(token, "true") || isKeyword(token, "false")) {
      this.advance();
      return {
        kind: "BoolLiteral",
        id: this.nextId++,
        span: token.span,
        value: token.role === "true",
      };
    }

    if (token.kind === "string") {
      this.advance();
      return {
        kind: "StringLiteral",
        id: this.nextId++,
        span: token.span,
        value: this.decodeString(token),
      };
    }

    if (token.kind === "identifier") {
      this.advance();
      if (isPunct(this.current(), "(")) {
        return this.parseCall(token);
      }
      if (isPunct(this.current(), "{") && this.isRecordLiteralStart(token.text)) {
        return this.parseRecordLiteral(token);
      }
      return {
        kind: "VarRef",
        id: this.nextId++,
        span: token.span,
        name: token.text,
      };
    }

    if (isPunct(token, "(")) {
      this.advance();
      const inner = this.parseExpression();
      this.expectPunct(")");
      return { ...inner, grouped: true };
    }

    throw this.fail(
      "E_SYNTAX",
      `expected an expression but found ${describe(token)}`,
      token,
      this.expectedKeywordHint(token),
    );
  }

  private isRecordLiteralStart(name: string): boolean {
    const afterOpen = this.peek(1);
    if (this.declaredRecordNames.has(name)) {
      return (
        afterOpen.kind === "identifier" ||
        isPunct(afterOpen, "}") ||
        isPunct(afterOpen, ".")
      );
    }
    return afterOpen.kind === "identifier" && isPunct(this.peek(2), ":");
  }

  private parseRecordLiteral(nameToken: Token): RecordLiteral {
    this.expectPunct("{");
    let base: Expr | undefined;
    const fields: RecordFieldInitializer[] = [];
    if (isPunct(this.current(), ".")) {
      this.expectPunct(".");
      this.expectPunct(".");
      this.expectPunct(".");
      base = this.parseExpression();
      this.matchPunct(",");
    }
    while (!isPunct(this.current(), "}")) {
      if (this.atEnd()) throw this.fail("E_SYNTAX", "unclosed record literal; expected \"}\"", this.current());
      const fieldName = this.expectIdentifier("field name");
      this.expectPunct(":");
      const value = this.parseExpression();
      fields.push({
        kind: "RecordFieldInitializer",
        id: this.nextId++,
        span: { file: this.file, start: fieldName.span.start, end: value.span.end },
        name: fieldName.text,
        nameSpan: fieldName.span,
        value,
      });
      if (!this.matchPunct(",")) break;
    }
    const close = this.expectPunct("}");
    return {
      kind: "RecordLiteral",
      id: this.nextId++,
      span: { file: this.file, start: nameToken.span.start, end: close.span.end },
      recordName: nameToken.text,
      recordNameSpan: nameToken.span,
      fields,
      base,
    };
  }

  private decodeString(token: Token): string {
    const raw = token.text.slice(1, -1);
    let value = "";
    for (let index = 0; index < raw.length; index++) {
      const char = raw[index];
      if (char !== "\\") {
        value += char;
        continue;
      }
      const escaped = raw[++index];
      switch (escaped) {
        case "\\":
          value += "\\";
          break;
        case '"':
          value += '"';
          break;
        case "n":
          value += "\n";
          break;
        case "r":
          value += "\r";
          break;
        case "t":
          value += "\t";
          break;
        case "u": {
          if (raw[index + 1] !== "{") throw this.fail("E_STRING_ESCAPE", "expected \\u{...} escape", token);
          const close = raw.indexOf("}", index + 2);
          if (close < 0) throw this.fail("E_STRING_ESCAPE", "unclosed \\u{...} escape", token);
          const hex = raw.slice(index + 2, close);
          if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) {
            throw this.fail("E_STRING_ESCAPE", "invalid Unicode escape", token);
          }
          const codePoint = Number.parseInt(hex, 16);
          if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
            throw this.fail("E_STRING_SURROGATE", "invalid Unicode scalar value", token);
          }
          value += String.fromCodePoint(codePoint);
          index = close;
          break;
        }
        default:
          throw this.fail("E_STRING_ESCAPE", `unknown string escape "\\${escaped ?? ""}"`, token);
      }
    }
    return value;
  }

  private parseCall(calleeToken: Token): CallExpr {
    this.expectPunct("(");
    const args: Expr[] = [];
    if (!isPunct(this.current(), ")")) {
      do {
        args.push(this.parseExpression());
      } while (this.matchPunct(","));
    }
    const close = this.expectPunct(")");
    return {
      kind: "CallExpr",
      id: this.nextId++,
      span: { file: this.file, start: calleeToken.span.start, end: close.span.end },
      callee: calleeToken.text,
      calleeSpan: calleeToken.span,
      args,
    };
  }

  private unary(op: UnaryOp, operand: Expr, start: SourceSpan["start"]): Expr {
    return {
      kind: "UnaryExpr",
      id: this.nextId++,
      span: { file: this.file, start, end: operand.span.end },
      op,
      operand,
    };
  }

  private binary(op: BinaryOp, left: Expr, right: Expr, _start: SourceSpan["start"]): Expr {
    return {
      kind: "BinaryExpr",
      id: this.nextId++,
      span: { file: this.file, start: left.span.start, end: right.span.end },
      op,
      left,
      right,
    };
  }

  private chainedComparison(): ParseFailure {
    return this.fail(
      "E_CHAINED_COMPARISON",
      "chained comparisons are rejected",
      this.current(),
      "compare each pair separately and combine the Boolean results with && or ||",
    );
  }

  private current(): Token {
    return this.tokens[Math.min(this.index, this.tokens.length - 1)];
  }

  private peek(offset: number): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
  }

  private advance(): Token {
    const token = this.current();
    if (this.index < this.tokens.length - 1) this.index++;
    return token;
  }

  private atEnd(): boolean {
    return this.current().kind === "eof";
  }

  private matchPunct(text: string): boolean {
    if (isPunct(this.current(), text)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expectPunct(text: string): Token {
    const token = this.current();
    if (!isPunct(token, text)) {
      throw this.fail("E_SYNTAX", `expected "${text}" but found ${describe(token)}`, token);
    }
    this.advance();
    return token;
  }

  private expectKeyword(role: "fn" | "let" | "if" | "else" | "return"): Token {
    const token = this.current();
    if (!isKeyword(token, role)) {
      throw this.fail("E_SYNTAX", `expected "${role}" but found ${describe(token)}`, token);
    }
    this.advance();
    return token;
  }

  private expectIdentifier(context: string): Token {
    const token = this.current();
    if (token.kind !== "identifier") {
      throw this.fail("E_SYNTAX", `expected ${context} but found ${describe(token)}`, token);
    }
    this.advance();
    return token;
  }

  private fail(code: string, message: string, token: Token, hint?: string): ParseFailure {
    return new ParseFailure(error(code, message, token.span, hint));
  }

  private expectedKeywordHint(token: Token): string | undefined {
    if (token.kind === "reserved") {
      return `"${token.text}" is reserved by the canonical core; each role must use the word selected by the active profile`;
    }
    return undefined;
  }
}

function describe(token: Token): string {
  if (token.kind === "eof") return "end of file";
  return `"${token.text}"`;
}

function isComparison(expr: Expr): boolean {
  return (
    expr.kind === "BinaryExpr" &&
    (expr.op === "==" || expr.op === "!=" || expr.op === "<" || expr.op === "<=" || expr.op === ">" || expr.op === ">=")
  );
}
