import type { Block, Expr, FunctionDecl, Stmt } from "../contracts/ast";
import type { FunctionSignature, TypedProgram } from "../contracts/outcome";
import type { TargetId } from "../contracts/interfaces";

export type CheckedOp = "add" | "sub" | "mul" | "neg";

export interface Dialect {
  target: TargetId;
  /** Integer type used for values and Boolean storage (0/1). */
  intType: string;
  intMinLiteral: string;
  declare(name: string, init: string): string[];
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
}

class CodeBuilder {
  private readonly lines: string[] = [];
  private indent = 0;
  private tempCounter = 0;

  constructor(private readonly dialect: Dialect) {}

  line(text: string): void {
    this.lines.push("    ".repeat(this.indent) + text);
  }

  declare(name: string, init: string): void {
    for (const line of this.dialect.declare(name, init)) this.line(line);
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
        this.builder.declare(stmt.targetName!, value);
        return;
      }
      case "IfStmt": {
        const condition = this.lowerExpr(stmt.condition);
        this.builder.ifOpen(`${condition} != 0`);
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
        this.builder.line(this.dialect.returnStmt(this.dialect.resOk(value)));
        return;
      }
    }
  }

  /** Returns an integer-valued expression. Booleans are normalized to 0 or 1. */
  private lowerExpr(expr: Expr): string {
    switch (expr.kind) {
      case "IntLiteral":
        return expr.value === -2147483648 ? this.dialect.intMinLiteral : String(expr.value);
      case "BoolLiteral":
        return expr.value ? "1" : "0";
      case "VarRef":
        return expr.targetName!;
      case "UnaryExpr": {
        const operand = this.lowerExpr(expr.operand);
        if (expr.op === "-") {
          return this.checked("neg", [operand], expr.id);
        }
        const temp = this.builder.temp("t");
        this.builder.declare(temp, "0");
        this.builder.ifOpen(`${operand} == 0`);
        this.builder.assign(temp, "1");
        this.builder.closeBlock();
        return temp;
      }
      case "BinaryExpr": {
        if (expr.op === "&&") {
          const left = this.lowerExpr(expr.left);
          const temp = this.builder.temp("t");
          this.builder.declare(temp, "0");
          this.builder.ifOpen(`${left} != 0`);
          const right = this.lowerExpr(expr.right);
          this.builder.assign(temp, right);
          this.builder.closeBlock();
          return temp;
        }
        if (expr.op === "||") {
          const left = this.lowerExpr(expr.left);
          const temp = this.builder.temp("t");
          this.builder.declare(temp, "1");
          this.builder.ifOpen(`${left} == 0`);
          const right = this.lowerExpr(expr.right);
          this.builder.assign(temp, right);
          this.builder.closeBlock();
          return temp;
        }

        const left = this.lowerExpr(expr.left);
        const right = this.lowerExpr(expr.right);
        switch (expr.op) {
          case "+":
            return this.checked("add", [left, right], expr.id);
          case "-":
            return this.checked("sub", [left, right], expr.id);
          case "*":
            return this.checked("mul", [left, right], expr.id);
          case "==":
          case "!=":
          case "<":
          case "<=":
          case ">":
          case ">=": {
            const temp = this.builder.temp("t");
            this.builder.declare(temp, "0");
            this.builder.ifOpen(`${left} ${expr.op} ${right}`);
            this.builder.assign(temp, "1");
            this.builder.closeBlock();
            return temp;
          }
          default:
            throw new Error(`internal: unsupported binary operator ${expr.op}`);
        }
      }
      case "CallExpr": {
        // Left-to-right evaluation is preserved by lowering arguments in order.
        const args = expr.args.map((arg) => this.lowerExpr(arg));
        const res = this.builder.temp("r");
        this.builder.declareRes(res, this.dialect.call(expr.calleeTargetName!, args));
        this.builder.ifOpen(this.dialect.resFailed(res));
        this.builder.line(this.dialect.returnStmt(res));
        this.builder.closeBlock();
        const temp = this.builder.temp("t");
        this.builder.declare(temp, this.dialect.resValue(res));
        return temp;
      }
    }
  }

  private checked(op: CheckedOp, args: string[], node: number): string {
    const res = this.builder.temp("r");
    this.builder.declareRes(res, this.dialect.checked(op, args, node));
    this.builder.ifOpen(this.dialect.resFailed(res));
    this.builder.line(this.dialect.returnStmt(res));
    this.builder.closeBlock();
    const temp = this.builder.temp("t");
    this.builder.declare(temp, this.dialect.resValue(res));
    return temp;
  }
}

export function emitFunctionBody(
  fn: FunctionDecl,
  dialect: Dialect,
): string {
  const builder = new CodeBuilder(dialect);
  new Lowerer(builder, dialect).lowerBlock(fn.body);
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
