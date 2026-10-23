import type { Block, Expr, FunctionDecl, Stmt } from "../contracts/ast";
import type { FunctionSignature, TypedProgram } from "../contracts/outcome";
import type { TargetId } from "../contracts/interfaces";
import {
  isListTypeName,
  isPrimitiveTypeName,
  listElementTypeName,
  type TypeName,
} from "../contracts/tokens";

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

export interface VariantAlternativeInfo {
  name: string;
  targetName: string;
  tag: number;
  /** Positional payload types; every type is scalar in this slice. */
  payload: TypeName[];
}

export interface VariantInfo {
  name: string;
  targetName: string;
  alternatives: VariantAlternativeInfo[];
  /** Largest payload arity, used to size the generated tagged value. */
  maxArity: number;
}

export type VariantMap = Map<string, VariantInfo>;

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

/** Collects checked variant declarations using their collision-safe target names. */
export function collectVariants(program: TypedProgram): VariantMap {
  const variants: VariantMap = new Map();
  for (const variant of program.ast.variants) {
    if (!variant.targetName) continue;
    const alternatives = variant.alternatives.map((alternative, index) => ({
      name: alternative.name,
      targetName: alternative.targetName ?? `a${index + 1}`,
      tag: alternative.tag ?? index,
      payload: alternative.payloadTypes ?? alternative.payload.map((type) => type.name),
    }));
    variants.set(variant.name, {
      name: variant.name,
      targetName: variant.targetName,
      alternatives,
      maxArity: alternatives.reduce((max, alternative) => Math.max(max, alternative.payload.length), 0),
    });
  }
  return variants;
}

/** Target type spelling: primitives share the integer representation. */
export function targetType(
  type: TypeName,
  records: RecordMap,
  intType: string,
  stringType: string,
  listType?: (element: string) => string,
  variants?: VariantMap,
): string {
  if (isListTypeName(type)) {
    const element = listElementTypeName(type) ?? "i32";
    const elementTarget = targetType(element, records, intType, stringType, listType, variants);
    return listType ? listType(elementTarget) : elementTarget;
  }
  if (type === "string") return stringType;
  if (isPrimitiveTypeName(type)) return intType;
  return records.get(type)?.targetName ?? variants?.get(type)?.targetName ?? intType;
}

export function quoteString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

export interface Dialect {
  target: TargetId;
  /** Integer type used for values and Boolean storage (0/1). */
  intType: string;
  stringType: string;
  intMinLiteral: string;
  declare(name: string, type: string, init: string): string[];
  declareRes(name: string, init: string): string[];
  assign(name: string, expr: string): string[];
  ifOpen(cond: string): string;
  elseIfOpen(cond: string): string;
  elseOpen(): string;
  closeBlock(): string;
  returnStmt(expr: string): string;
  resFailed(expr: string): string;
  resValue(expr: string): string;
  resOk(expr: string): string;
  resOkRecord(record: RecordInfo, expr: string): string;
  resRecordValue(expr: string, record: RecordInfo): string;
  resOkVariant(variant: VariantInfo, expr: string): string;
  resVariantValue(expr: string, variant: VariantInfo): string;
  resOkString(expr: string): string;
  resStringValue(expr: string): string;
  stringLiteral(value: string): string;
  stringValue(expr: string): string;
  emptyString(): string;
  valueEquals(left: string, right: string, type: TypeName): string;
  resFail(code: number, node: number): string;
  checked(op: CheckedOp, args: string[], node: number): string;
  call(fn: string, args: string[]): string;
  recordLiteral(record: RecordInfo, values: string[]): string;
  fieldAccess(target: string, record: RecordInfo, index: number): string;
  fieldEquals(left: string, right: string, record: RecordInfo, index: number): string;
  /** Tagged value constructor for one variant alternative, padded to max arity. */
  constructVariant(variant: VariantInfo, alternative: VariantAlternativeInfo, values: string[]): string;
  variantTag(expr: string, variant: VariantInfo): string;
  variantPayload(expr: string, variant: VariantInfo, index: number): string;
  variantEquals(left: string, right: string, variant: VariantInfo): string;
  /** Target spelling of a list of the given element type. */
  listType(elementType: string): string;
  listLiteral(values: string[]): string;
  emptyList(): string;
  /** Read a list value as an expression, cloning where ownership requires it. */
  listValue(expr: string): string;
  listLength(expr: string): string;
  /** Bounds-checked indexing; returns a target `Res` expression. */
  listIndex(list: string, index: string, node: number): string;
  listEquals(left: string, right: string, elementType: TypeName): string;
  resOkList(expr: string): string;
  resListValue(expr: string): string;
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

  elseIfOpen(cond: string): void {
    this.indent -= 1;
    this.line(this.dialect.elseIfOpen(cond));
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
    private readonly variants: VariantMap,
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
        if (value.type === "string") {
          this.builder.line(this.dialect.returnStmt(this.dialect.resOkString(value.text)));
        } else if (isListTypeName(value.type)) {
          this.builder.line(this.dialect.returnStmt(this.dialect.resOkList(value.text)));
        } else if (isPrimitiveTypeName(value.type)) {
          this.builder.line(this.dialect.returnStmt(this.dialect.resOk(value.text)));
        } else {
          const variant = this.variants.get(value.type);
          if (variant) {
            this.builder.line(this.dialect.returnStmt(this.dialect.resOkVariant(variant, value.text)));
            return;
          }
          const record = this.records.get(value.type);
          if (!record) throw new Error(`internal: unknown return type "${value.type}"`);
          this.builder.line(this.dialect.returnStmt(this.dialect.resOkRecord(record, value.text)));
        }
        return;
      }
    }
  }

  private typeText(type: TypeName): string {
    return targetType(
      type,
      this.records,
      this.dialect.intType,
      this.dialect.stringType,
      this.dialect.listType,
      this.variants,
    );
  }

  /** A type-correct placeholder used to initialize a match result before an arm runs. */
  private defaultFor(type: TypeName): string {
    if (type === "string") return this.dialect.emptyString();
    if (isListTypeName(type)) return this.dialect.emptyList();
    if (isPrimitiveTypeName(type)) return "0";
    const record = this.records.get(type);
    if (record) {
      return this.dialect.recordLiteral(
        record,
        record.fields.map((field) => this.defaultFor(field.type)),
      );
    }
    const variant = this.variants.get(type);
    if (variant) {
      const alternative = variant.alternatives[0];
      if (!alternative) throw new Error(`internal: variant "${type}" has no alternatives`);
      return this.dialect.constructVariant(
        variant,
        alternative,
        alternative.payload.map((payload) => this.defaultFor(payload)),
      );
    }
    throw new Error(`internal: cannot build a default value for "${type}"`);
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
      case "StringLiteral":
        return { text: this.dialect.stringLiteral(expr.value), type: "string" };
      case "VarRef": {
        const type = expr.resolvedType ?? "i32";
        return {
          text:
            type === "string"
              ? this.dialect.stringValue(expr.targetName!)
              : isListTypeName(type)
                ? this.dialect.listValue(expr.targetName!)
                : expr.targetName!,
          type,
        };
      }
      case "ListLiteral": {
        const type = expr.resolvedType ?? "list<i32>";
        // Arguments are lowered in source order before the literal is built.
        const values = expr.elements.map((element) => this.lowerExpr(element).text);
        const temp = this.builder.temp("t");
        this.builder.declare(temp, this.typeText(type), this.dialect.listLiteral(values));
        return { text: temp, type };
      }
      case "IndexExpr": {
        const target = this.lowerExpr(expr.target);
        const index = this.lowerExpr(expr.index);
        const elementType = expr.resolvedType ?? "i32";
        const res = this.builder.temp("r");
        this.builder.declareRes(res, this.dialect.listIndex(target.text, index.text, expr.id));
        this.builder.ifOpen(this.dialect.resFailed(res));
        this.builder.line(this.dialect.returnStmt(res));
        this.builder.closeBlock();
        const temp = this.builder.temp("t");
        this.builder.declare(temp, this.dialect.intType, this.dialect.resValue(res));
        return { text: temp, type: elementType };
      }
      case "RecordLiteral": {
        const record = this.records.get(expr.recordName);
        if (!record) throw new Error(`internal: unknown record "${expr.recordName}"`);
        const base = expr.base ? this.lowerExpr(expr.base) : undefined;
        const values = record.fields.map((_field, index) =>
          base ? this.dialect.fieldAccess(base.text, record, index) : "0",
        );
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
        if (expr.variantConstructor) {
          const variant = this.variants.get(expr.variantConstructor.variantName);
          const alternative = variant?.alternatives.find(
            (candidate) => candidate.name === expr.variantConstructor!.alternativeName,
          );
          if (!variant || !alternative) {
            throw new Error(`internal: unresolved constructor "${expr.callee}"`);
          }
          const values = expr.args.map((arg) => this.lowerExpr(arg).text);
          const temp = this.builder.temp("t");
          this.builder.declare(
            temp,
            this.typeText(expr.variantConstructor.variantName),
            this.dialect.constructVariant(variant, alternative, values),
          );
          return { text: temp, type: expr.variantConstructor.variantName };
        }
        if (expr.builtin === "length") {
          const argument = this.lowerExpr(expr.args[0]);
          return { text: this.dialect.listLength(argument.text), type: "i32" };
        }
        const returnType = expr.calleeReturnType ?? "i32";
        // Left-to-right evaluation is preserved by lowering arguments in order.
        const args = expr.args.map((arg) => this.lowerExpr(arg).text);
        const res = this.builder.temp("r");
        this.builder.declareRes(res, this.dialect.call(expr.calleeTargetName!, args));
        this.builder.ifOpen(this.dialect.resFailed(res));
        this.builder.line(this.dialect.returnStmt(res));
        this.builder.closeBlock();
        const temp = this.builder.temp("t");
        if (returnType === "string") {
          this.builder.declare(temp, this.typeText(returnType), this.dialect.resStringValue(res));
        } else if (isListTypeName(returnType)) {
          this.builder.declare(temp, this.typeText(returnType), this.dialect.resListValue(res));
        } else if (isPrimitiveTypeName(returnType)) {
          this.builder.declare(temp, this.typeText(returnType), this.dialect.resValue(res));
        } else {
          const variant = this.variants.get(returnType);
          if (variant) {
            this.builder.declare(temp, this.typeText(returnType), this.dialect.resVariantValue(res, variant));
            return { text: temp, type: returnType };
          }
          const record = this.records.get(returnType);
          if (!record) throw new Error(`internal: unknown return type "${returnType}"`);
          this.builder.declare(temp, this.typeText(returnType), this.dialect.resRecordValue(res, record));
        }
        return { text: temp, type: returnType };
      }
      case "MatchExpr": {
        const variant = this.variants.get(expr.variantName ?? "");
        if (!variant) throw new Error(`internal: unknown match variant "${expr.variantName}"`);
        // The scrutinee is evaluated once into a local value; no arm mutates it.
        const scrutinee = this.lowerExpr(expr.scrutinee);
        const subject = this.builder.temp("t");
        this.builder.declare(subject, this.typeText(variant.name), scrutinee.text);
        const resultType = expr.resolvedType ?? "i32";
        const result = this.builder.temp("t");
        this.builder.declare(result, this.typeText(resultType), this.defaultFor(resultType));

        const arms = expr.arms;
        let openedBlocks = 0;
        arms.forEach((arm, index) => {
          const last = index === arms.length - 1;
          const pattern = arm.pattern;
          if (pattern.kind === "WildcardPattern") {
            if (index === 0) {
              // A lone wildcard needs no test at all.
              const body = this.lowerExpr(arm.body);
              this.builder.assign(result, body.text);
              return;
            }
            this.builder.elseOpen();
            openedBlocks += 1;
          } else if (index === 0) {
            this.builder.ifOpen(`${this.dialect.variantTag(subject, variant)} == ${pattern.tag}`);
            openedBlocks += 1;
          } else if (last) {
            // Checked exhaustiveness makes the final alternative an unconditional else.
            this.builder.elseOpen();
            openedBlocks += 1;
          } else {
            this.builder.elseIfOpen(`${this.dialect.variantTag(subject, variant)} == ${pattern.tag}`);
            openedBlocks += 1;
          }
          if (pattern.kind === "VariantPattern") {
            pattern.bindings.forEach((binding, payloadIndex) => {
              this.builder.declare(
                binding.targetName!,
                this.typeText(binding.resolvedType ?? "i32"),
                this.dialect.variantPayload(subject, variant, payloadIndex),
              );
            });
          }
          const body = this.lowerExpr(arm.body);
          this.builder.assign(result, body.text);
        });
        // Only close the whole if/else chain once.
        if (openedBlocks > 0) this.builder.closeBlock();
        return { text: result, type: resultType };
      }
    }
  }

  private comparison(op: string, left: Lowered, right: Lowered): string {
    if (op === "==" || op === "!=") {
      const record = this.records.get(left.type);
      const variant = this.variants.get(left.type);
      const equality = isListTypeName(left.type)
        ? this.dialect.listEquals(left.text, right.text, listElementTypeName(left.type) ?? "i32")
        : record
          ? this.recordEquality(left.text, right.text, record)
          : variant
            ? this.dialect.variantEquals(left.text, right.text, variant)
            : this.dialect.valueEquals(left.text, right.text, left.type);
      return op === "==" ? equality : `!(${equality})`;
    }
    return `${left.text} ${op} ${right.text}`;
  }

  private recordEquality(left: string, right: string, record: RecordInfo): string {
    if (record.fields.length === 0) return "1 == 1";
    return record.fields
      .map((_field, index) => this.dialect.fieldEquals(left, right, record, index))
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
  variants: VariantMap,
): string {
  const builder = new CodeBuilder(dialect);
  new Lowerer(builder, dialect, records, variants).lowerBlock(fn.body);
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
