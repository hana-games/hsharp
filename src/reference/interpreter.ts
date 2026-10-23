import type { Block, Expr, FunctionDecl, RecordDecl, Stmt, UnaryOp } from "../contracts/ast";
import type { FunctionSignature, Outcome, RuntimeArguments, TypedProgram, HsValue } from "../contracts/outcome";
import { isRecordValue, OVERFLOW_CODE, type RecordValue } from "../contracts/outcome";
import { isPrimitiveTypeName, type TypeName } from "../contracts/tokens";

const I32_MIN = -2147483648n;
const I32_MAX = 2147483647n;

class ReturnSignal {
  constructor(readonly value: HsValue) {}
}

class RuntimeFailure {
  constructor(
    readonly code: string,
    readonly node: number,
  ) {}
}

export class EvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationError";
  }
}

interface RuntimeFunction {
  decl: FunctionDecl;
  signature: FunctionSignature;
}

/**
 * Reference interpreter. Uses BigInt and checks the i32 range after every
 * arithmetic operation, independently of every generated backend.
 */
export function evaluate(program: TypedProgram, entry: string, args: RuntimeArguments): Outcome {
  const functions = new Map<string, RuntimeFunction>();
  for (const fn of program.ast.functions) {
    const signature = program.functions.find((s) => s.name === fn.name);
    if (signature) functions.set(fn.name, { decl: fn, signature });
  }

  const entryFunction = functions.get(entry);
  if (!entryFunction) {
    throw new EvaluationError(`entry function "${entry}" was not found`);
  }
  if (entryFunction.signature.params.length !== args.values.length) {
    throw new EvaluationError(
      `entry function "${entry}" expects ${entryFunction.signature.params.length} argument(s), received ${args.values.length}`,
    );
  }
  const recordParam = entryFunction.signature.params.find((param) => !isPrimitiveTypeName(param.type));
  if (recordParam) {
    throw new EvaluationError(
      `entry function "${entry}" cannot take record parameter "${recordParam.name}"`,
    );
  }
  args.values.forEach((value, index) => {
    const param = entryFunction.signature.params[index];
    const actual = valueTypeOf(value);
    if (!actual) {
      throw new EvaluationError(
        `argument ${index + 1} of "${entry}" must be a Boolean or an integer in the i32 range`,
      );
    }
    if (param.type !== actual) {
      throw new EvaluationError(
        `argument ${index + 1} of "${entry}" has type ${actual}, expected ${param.type}`,
      );
    }
  });

  const records = new Map<string, RecordDecl>();
  for (const record of program.ast.records) records.set(record.name, record);

  const interpreter = new Interpreter(functions, records);
  try {
    const values: HsValue[] = args.values.map((value, index) => ({
      type: entryFunction.signature.params[index].type,
      value,
    }));
    const result = interpreter.call(entryFunction, values);
    if (isRecordValue(result.value)) {
      throw new EvaluationError(`entry function "${entry}" returned a record`);
    }
    return { status: "ok", type: result.type, value: result.value };
  } catch (cause) {
    if (cause instanceof RuntimeFailure) {
      return { status: "error", code: cause.code, node: cause.node };
    }
    throw cause;
  }
}

class Interpreter {
  constructor(
    private readonly functions: Map<string, RuntimeFunction>,
    private readonly records: Map<string, RecordDecl>,
  ) {}

  call(fn: RuntimeFunction, args: HsValue[]): HsValue {
    const env = new Map<string, HsValue>();
    fn.signature.params.forEach((_param, index) => {
      env.set(fn.decl.params[index].symbolId!, args[index]);
    });
    try {
      this.executeBlock(fn.decl.body, env);
    } catch (cause) {
      if (cause instanceof ReturnSignal) return cause.value;
      throw cause;
    }
    throw new EvaluationError(`function "${fn.signature.name}" reached the end without returning`);
  }

  private executeBlock(block: Block, env: Map<string, HsValue>): void {
    for (const stmt of block.statements) {
      this.executeStatement(stmt, env);
    }
  }

  private executeStatement(stmt: Stmt, env: Map<string, HsValue>): void {
    switch (stmt.kind) {
      case "LetStmt": {
        const value = this.evalExpr(stmt.value, env);
        env.set(stmt.symbolId!, value);
        return;
      }
      case "IfStmt": {
        const condition = this.evalExpr(stmt.condition, env);
        if (condition.type !== "bool") throw new EvaluationError("if condition is not Boolean");
        if (condition.value === true) {
          this.executeBlock(stmt.thenBlock, env);
        } else if (stmt.elseBlock) {
          this.executeBlock(stmt.elseBlock, env);
        }
        return;
      }
      case "ReturnStmt": {
        throw new ReturnSignal(this.evalExpr(stmt.value, env));
      }
    }
  }

  private evalExpr(expr: Expr, env: Map<string, HsValue>): HsValue {
    switch (expr.kind) {
      case "IntLiteral":
        return { type: "i32", value: expr.value };
      case "BoolLiteral":
        return { type: "bool", value: expr.value };
      case "VarRef": {
        const value = env.get(expr.symbolId!);
        if (!value) throw new EvaluationError(`internal: unbound local "${expr.name}"`);
        return value;
      }
      case "CallExpr": {
        const target = this.functions.get(expr.callee);
        if (!target) throw new EvaluationError(`internal: unresolved call to "${expr.callee}"`);
        // Arguments are evaluated left to right before the call.
        const values = expr.args.map((arg) => this.evalExpr(arg, env));
        return this.call(target, values);
      }
      case "RecordLiteral": {
        const record = this.records.get(expr.recordName);
        if (!record) throw new EvaluationError(`internal: unknown record "${expr.recordName}"`);
        let fields: HsValue[] = record.fields.map((field) => ({
          type: field.type.name,
          value: field.type.name === "bool" ? false : 0,
        }));
        if (expr.base) {
          const base = this.evalExpr(expr.base, env);
          if (!isRecordValue(base.value) || base.value.recordName !== expr.recordName) {
            throw new EvaluationError(`internal: record update base has the wrong type`);
          }
          fields = [...base.value.fields];
        }
        for (const initializer of expr.fields) {
          const index =
            initializer.fieldIndex ??
            record.fields.findIndex((field) => field.name === initializer.name);
          if (index < 0) {
            throw new EvaluationError(`internal: unknown field "${initializer.name}"`);
          }
          // Source-order evaluation is preserved; storage uses declaration order.
          fields[index] = this.evalExpr(initializer.value, env);
        }
        const value: RecordValue = {
          kind: "record",
          recordName: expr.recordName,
          fields,
        };
        return { type: expr.recordName, value };
      }
      case "FieldAccess": {
        const target = this.evalExpr(expr.target, env);
        if (!isRecordValue(target.value)) {
          throw new EvaluationError(`internal: field access on non-record value`);
        }
        const index = expr.fieldIndex ?? -1;
        const field = target.value.fields[index];
        if (index < 0 || field === undefined) {
          throw new EvaluationError(`internal: unknown field "${expr.field}"`);
        }
        return field;
      }
      case "UnaryExpr": {
        const operand = this.evalExpr(expr.operand, env);
        return this.evalUnary(expr.op, operand, expr.id);
      }
      case "BinaryExpr": {
        if (expr.op === "&&") {
          const left = this.evalExpr(expr.left, env);
          if (left.value === false) return { type: "bool", value: false };
          const right = this.evalExpr(expr.right, env);
          return { type: "bool", value: right.value === true };
        }
        if (expr.op === "||") {
          const left = this.evalExpr(expr.left, env);
          if (left.value === true) return { type: "bool", value: true };
          const right = this.evalExpr(expr.right, env);
          return { type: "bool", value: right.value === true };
        }
        const left = this.evalExpr(expr.left, env);
        const right = this.evalExpr(expr.right, env);
        return this.evalBinary(expr.op, left, right, expr.id);
      }
    }
  }

  private evalUnary(op: UnaryOp, operand: HsValue, node: number): HsValue {
    if (op === "!") return { type: "bool", value: operand.value !== true };
    const value = toBigInt(operand);
    const result = -value;
    this.requireI32(result, node);
    return { type: "i32", value: Number(result) };
  }

  private evalBinary(op: string, left: HsValue, right: HsValue, node: number): HsValue {
    switch (op) {
      case "+":
      case "-":
      case "*": {
        const a = toBigInt(left);
        const b = toBigInt(right);
        const result = op === "+" ? a + b : op === "-" ? a - b : a * b;
        this.requireI32(result, node);
        return { type: "i32", value: Number(result) };
      }
      case "<":
        return { type: "bool", value: toBigInt(left) < toBigInt(right) };
      case "<=":
        return { type: "bool", value: toBigInt(left) <= toBigInt(right) };
      case ">":
        return { type: "bool", value: toBigInt(left) > toBigInt(right) };
      case ">=":
        return { type: "bool", value: toBigInt(left) >= toBigInt(right) };
      case "==":
        return { type: "bool", value: valuesEqual(left, right) };
      case "!=":
        return { type: "bool", value: !valuesEqual(left, right) };
      default:
        throw new EvaluationError(`internal: unsupported operator ${op}`);
    }
  }

  private requireI32(value: bigint, node: number): void {
    if (value < I32_MIN || value > I32_MAX) {
      throw new RuntimeFailure(OVERFLOW_CODE, node);
    }
  }
}

function valuesEqual(left: HsValue, right: HsValue): boolean {
  const leftValue = left.value;
  const rightValue = right.value;
  if (isRecordValue(leftValue) || isRecordValue(rightValue)) {
    if (!isRecordValue(leftValue) || !isRecordValue(rightValue)) return false;
    if (left.type !== right.type) return false;
    if (leftValue.recordName !== rightValue.recordName) return false;
    if (leftValue.fields.length !== rightValue.fields.length) return false;
    const rightFields = rightValue.fields;
    return leftValue.fields.every((field, index) => valuesEqual(field, rightFields[index]));
  }
  return leftValue === rightValue;
}

function toBigInt(value: HsValue): bigint {
  if (typeof value.value !== "number") {
    throw new EvaluationError("internal: arithmetic on a non-integer value");
  }
  return BigInt(value.value);
}

function valueTypeOf(value: number | boolean): TypeName | undefined {
  if (typeof value === "boolean") return "bool";
  if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) return "i32";
  return undefined;
}
