import type { Block, Expr, FunctionDecl, Stmt } from "../contracts/ast";
import type { FunctionSignature, TypedProgram } from "../contracts/outcome";
import type { TargetId } from "../contracts/interfaces";
import { isPrimitiveTypeName, type TypeName } from "../contracts/tokens";

export type CheckedOp = "add" | "sub" | "mul" | "neg";

export interface RecordFieldInfo {
  name: string;
  targetName: string;
  type: TypeName;
}

export interface RecordInfo {
  name: string;
  targetName: string;
  fields: RecordFieldInfo[];
}

export type RecordMap = Map<string, RecordInfo>;

/** Collects checked record declarations using their collision-safe target names. */
export function collectRecords(program: TypedProgram): RecordMap {
  const records: RecordMap = new Map();
  for (const record of program.ast.records) {
    if (!record.targetName) continue;
    records.set(record.name, {
      name: record.name,
      targetName: record.targetName,
      fields: record.fields.map((field, index) => ({
        name: field.name,
        targetName: field.targetName ?? `f${index + 1}`,
        type: field.type.name,
      })),
    });
  }
  return records;
}

/** Target type spelling: primitives share the integer representation. */
export function targetType(type: TypeName, records: RecordMap, intType: string): string {
  if (isPrimitiveTypeName(type)) return intType;
  return records.get(type)?.targetName ?? intType;
}

export interface Dialect {
  target: TargetId;
  /** Integer type used for values and Boolean storage (0/1). */
  intType: string;
  intMinLiteral: string;
  declare(name: string, type: string, init: string): string[];
  declareRes(name: string, init: string): string[];
  assign(name: string, expr: string): string[];
  ifOpen(cond: string): string;
  elseOpen(): string;
  closeBlock(): string;
  returnStmt(expr: string): string;
  resFailed(expr: string): string;
  resValue(expr: string): string;
  resOk(expr: string): string;
  resFail(code: number, node: number): string;
  checked(op: CheckedOp, args: string[], node: number): string;
  call(fn: string, args: string[]): string;
  recordLiteral(record: RecordInfo, values: string[]): string;
  fieldAccess(target: string, record: RecordInfo, index: number): string;
}

interface Lowered {
  text: string;
  type: TypeName;
}

class CodeBuilder {
  private readonly lines: string[] = [];
  private indent = 0;
  private tempCounter = 0;

  constructor(private readonly dialect: Dialect) {}

  line(text: string): void {
    this.lines.push("    ".repeat(this.indent) + text);
  }

  declare(name: string, type: string, init: string): void {
    for (const line of this.dialect.declare(name, type, init)) this.line(line);
  }

  declareRes(name: string, init: string): void {
    for (const line of this.dialect.declareRes(name, init)) this.line(line);
  }

  assign(name: string, expr: string): void {
    for (const line of this.dialect.assign(name, expr)) this.line(line);
  }

  ifOpen(cond: string): void {
    this.line(this.dialect.ifOpen(cond));
    this.indent += 1;
  }

  elseOpen(): void {
    this.indent -= 1;
    this.line(this.dialect.elseOpen());
    this.indent += 1;
  }

  closeBlock(): void {
    this.indent -= 1;
    this.line(this.dialect.closeBlock());
  }

  temp(prefix: string): string {
    return `${prefix}${this.tempCounter++}`;
  }

  finish(): string {
    return this.lines.join("\n");
  }
}

class Lowerer {
  constructor(
    private readonly builder: CodeBuilder,
    private readonly dialect: Dialect,
    private readonly records: RecordMap,
  ) {}

  lowerBlock(block: Block): void {
    for (const stmt of block.statements) {
      this.lowerStatement(stmt);
      // Statements after a definitely-returning statement are unreachable.
      // Omitting them keeps generated Java valid and does not change behavior.
      if (statementDefinitelyReturns(stmt)) break;
    }
  }

  private lowerStatement(stmt: Stmt): void {
    switch (stmt.kind) {
      case "LetStmt": {
        const value = this.lowerExpr(stmt.value);
        this.builder.declare(stmt.targetName!, this.typeText(stmt.type.name), value.text);
        return;
      }
      case "IfStmt": {
        const condition = this.lowerExpr(stmt.condition);
        this.builder.ifOpen(`${condition.text} != 0`);
        this.lowerBlock(stmt.thenBlock);
        if (stmt.elseBlock) {
          this.builder.elseOpen();
          this.lowerBlock(stmt.elseBlock);
        }
        this.builder.closeBlock();
        return;
      }
      case "ReturnStmt": {
        const value = this.lowerExpr(stmt.value);
        if (!isPrimitiveTypeName(value.type)) {
          throw new Error(`internal: record return from "${value.type}" was not rejected by the checker`);
        }
        this.builder.line(this.dialect.returnStmt(this.dialect.resOk(value.text)));
        return;
      }
    }
  }

  private typeText(type: TypeName): string {
    return targetType(type, this.records, this.dialect.intType);
  }

  private lowerExpr(expr: Expr): Lowered {
    switch (expr.kind) {
      case "IntLiteral":
        return {
          text: expr.value === -2147483648 ? this.dialect.intMinLiteral : String(expr.value),
          type: "i32",
        };
      case "BoolLiteral":
        return { text: expr.value ? "1" : "0", type: "bool" };
      case "VarRef":
        return { text: expr.targetName!, type: expr.resolvedType ?? "i32" };
      case "RecordLiteral": {
        const record = this.records.get(expr.recordName);
        if (!record) throw new Error(`internal: unknown record "${expr.recordName}"`);
        const values = record.fields.map(() => "0");
        for (const initializer of expr.fields) {
          const index = initializer.fieldIndex ?? -1;
          const value = this.lowerExpr(initializer.value);
          if (index < 0 || index >= values.length) {
            throw new Error(`internal: unknown field "${initializer.name}"`);
          }
          values[index] = value.text;
        }
        const temp = this.builder.temp("t");
        this.builder.declare(temp, record.targetName, this.dialect.recordLiteral(record, values));
        return { text: temp, type: expr.recordName };
      }
      case "FieldAccess": {
        const target = this.lowerExpr(expr.target);
        const record = this.records.get(target.type);
        const index = expr.fieldIndex;
        if (!record || index === undefined || record.fields[index] === undefined) {
          throw new Error(`internal: unknown field "${expr.field}"`);
        }
        return {
          text: this.dialect.fieldAccess(target.text, record, index),
          type: record.fields[index].type,
        };
      }
      case "UnaryExpr": {
        const operand = this.lowerExpr(expr.operand);
        if (expr.op === "-") {
          return { text: this.checked("neg", [operand.text], expr.id), type: "i32" };
        }
        const temp = this.builder.temp("t");
        this.builder.declare(temp, this.dialect.intType, "0");
        this.builder.ifOpen(`${operand.text} == 0`);
        this.builder.assign(temp, "1");
        this.builder.closeBlock();
        return { text: temp, type: "bool" };
      }
      case "BinaryExpr": {
        if (expr.op === "&&") {
          const left = this.lowerExpr(expr.left);
          const temp = this.builder.temp("t");
          this.builder.declare(temp, this.dialect.intType, "0");
          this.builder.ifOpen(`${left.text} != 0`);
          const right = this.lowerExpr(expr.right);
          this.builder.assign(temp, right.text);
          this.builder.closeBlock();
          return { text: temp, type: "bool" };
        }
        if (expr.op === "||") {
          const left = this.lowerExpr(expr.left);
          const temp = this.builder.temp("t");
          this.builder.declare(temp, this.dialect.intType, "1");
          this.builder.ifOpen(`${left.text} == 0`);
          const right = this.lowerExpr(expr.right);
          this.builder.assign(temp, right.text);
          this.builder.closeBlock();
          return { text: temp, type: "bool" };
        }

        const left = this.lowerExpr(expr.left);
        const right = this.lowerExpr(expr.right);
        switch (expr.op) {
          case "+":
            return { text: this.checked("add", [left.text, right.text], expr.id), type: "i32" };
          case "-":
            return { text: this.checked("sub", [left.text, right.text], expr.id), type: "i32" };
          case "*":
            return { text: this.checked("mul", [left.text, right.text], expr.id), type: "i32" };
          case "==":
          case "!=":
          case "<":
          case "<=":
          case ">":
          case ">=": {
            const temp = this.builder.temp("t");
            this.builder.declare(temp, this.dialect.intType, "0");
            this.builder.ifOpen(this.comparison(expr.op, left, right));
            this.builder.assign(temp, "1");
            this.builder.closeBlock();
            return { text: temp, type: "bool" };
          }
          default:
            throw new Error(`internal: unsupported binary operator ${expr.op}`);
        }
      }
      case "CallExpr": {
        const returnType = expr.calleeReturnType ?? "i32";
        if (!isPrimitiveTypeName(returnType)) {
          throw new Error(`internal: record-returning call to "${expr.callee}" was not rejected by the checker`);
        }
        // Left-to-right evaluation is preserved by lowering arguments in order.
        const args = expr.args.map((arg) => this.lowerExpr(arg).text);
        const res = this.builder.temp("r");
        this.builder.declareRes(res, this.dialect.call(expr.calleeTargetName!, args));
        this.builder.ifOpen(this.dialect.resFailed(res));
        this.builder.line(this.dialect.returnStmt(res));
        this.builder.closeBlock();
        const temp = this.builder.temp("t");
        this.builder.declare(temp, this.typeText(returnType), this.dialect.resValue(res));
        return { text: temp, type: returnType };
      }
    }
  }

  private comparison(op: string, left: Lowered, right: Lowered): string {
    if (op === "==" || op === "!=") {
      const record = this.records.get(left.type);
      const equality = record
        ? this.recordEquality(left.text, right.text, record)
        : `${left.text} == ${right.text}`;
      return op === "==" ? equality : `!(${equality})`;
    }
    return `${left.text} ${op} ${right.text}`;
  }

  private recordEquality(left: string, right: string, record: RecordInfo): string {
    if (record.fields.length === 0) return "1 == 1";
    return record.fields
      .map(
        (_field, index) =>
          `${this.dialect.fieldAccess(left, record, index)} == ${this.dialect.fieldAccess(right, record, index)}`,
      )
      .join(" && ");
  }

  private checked(op: CheckedOp, args: string[], node: number): string {
    const res = this.builder.temp("r");
    this.builder.declareRes(res, this.dialect.checked(op, args, node));
    this.builder.ifOpen(this.dialect.resFailed(res));
    this.builder.line(this.dialect.returnStmt(res));
    this.builder.closeBlock();
    const temp = this.builder.temp("t");
    this.builder.declare(temp, this.dialect.intType, this.dialect.resValue(res));
    return temp;
  }
}

export function emitFunctionBody(
  fn: FunctionDecl,
  dialect: Dialect,
  records: RecordMap,
): string {
  const builder = new CodeBuilder(dialect);
  new Lowerer(builder, dialect, records).lowerBlock(fn.body);
  // The checker guarantees every path returns. Keep a fallback only for
  // defensive code generation of unchecked input; Java rejects unreachable code.
  if (!blockDefinitelyReturns(fn.body)) {
    builder.line(dialect.returnStmt(dialect.resFail(2, 0)));
  }
  return builder.finish();
}

function blockDefinitelyReturns(block: Block): boolean {
  return block.statements.some((stmt) => statementDefinitelyReturns(stmt));
}

function statementDefinitelyReturns(stmt: Stmt): boolean {
  if (stmt.kind === "ReturnStmt") return true;
  if (stmt.kind === "IfStmt" && stmt.elseBlock) {
    return blockDefinitelyReturns(stmt.thenBlock) && blockDefinitelyReturns(stmt.elseBlock);
  }
  return false;
}

export function functionBySignature(
  program: TypedProgram,
  signature: FunctionSignature,
): FunctionDecl {
  const fn = program.ast.functions.find((candidate) => candidate.name === signature.name);
  if (!fn) throw new Error(`internal: missing function "${signature.name}"`);
  return fn;
}
