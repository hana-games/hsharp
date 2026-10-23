import type { SourceSpan } from "./diagnostics";
import type { TypeName } from "./tokens";

export interface NodeBase {
  /** Unique within one parse, assigned in source order. Stable for a given input. */
  id: number;
  span: SourceSpan;
  /** True when the expression was explicitly parenthesized. */
  grouped?: boolean;
}

export interface Program extends NodeBase {
  kind: "Program";
  records: RecordDecl[];
  functions: FunctionDecl[];
  /** Identifier spelling per node id is available through the source spans; the AST is not printed. */
  sourceText: string;
}

export interface RecordDecl extends NodeBase {
  kind: "RecordDecl";
  name: string;
  nameSpan: SourceSpan;
  fields: RecordField[];
  /** Filled by the semantic checker. */
  symbolId?: string;
  targetName?: string;
}

export interface RecordField extends NodeBase {
  kind: "RecordField";
  name: string;
  nameSpan: SourceSpan;
  type: TypeRef;
  /** Filled by the semantic checker. */
  symbolId?: string;
  targetName?: string;
  fieldIndex?: number;
}

export interface TypeRef extends NodeBase {
  kind: "TypeRef";
  name: TypeName;
}

export interface Param extends NodeBase {
  kind: "Param";
  name: string;
  nameSpan: SourceSpan;
  type: TypeRef;
  /** Filled by the semantic checker. */
  symbolId?: string;
  targetName?: string;
}

export interface FunctionDecl extends NodeBase {
  kind: "FunctionDecl";
  name: string;
  nameSpan: SourceSpan;
  params: Param[];
  returnType: TypeRef;
  body: Block;
  /** Filled by the semantic checker. */
  symbolId?: string;
  targetName?: string;
}

export interface Block extends NodeBase {
  kind: "Block";
  statements: Stmt[];
}

export type Stmt = LetStmt | IfStmt | ReturnStmt;

export interface LetStmt extends NodeBase {
  kind: "LetStmt";
  name: string;
  nameSpan: SourceSpan;
  type: TypeRef;
  value: Expr;
  /** Filled by the semantic checker. */
  symbolId?: string;
  targetName?: string;
}

export interface IfStmt extends NodeBase {
  kind: "IfStmt";
  condition: Expr;
  thenBlock: Block;
  elseBlock?: Block;
}

export interface ReturnStmt extends NodeBase {
  kind: "ReturnStmt";
  value: Expr;
}

export type Expr =
  | IntLiteral
  | BoolLiteral
  | StringLiteral
  | VarRef
  | CallExpr
  | UnaryExpr
  | BinaryExpr
  | RecordLiteral
  | FieldAccess;

export interface IntLiteral extends NodeBase {
  kind: "IntLiteral";
  value: number;
}

export interface BoolLiteral extends NodeBase {
  kind: "BoolLiteral";
  value: boolean;
}

export interface StringLiteral extends NodeBase {
  kind: "StringLiteral";
  /** Decoded Unicode scalar sequence. */
  value: string;
}

export interface VarRef extends NodeBase {
  kind: "VarRef";
  name: string;
  /** Filled by the semantic checker. */
  symbolId?: string;
  targetName?: string;
  resolvedType?: TypeName;
}

export interface RecordLiteral extends NodeBase {
  kind: "RecordLiteral";
  recordName: string;
  recordNameSpan: SourceSpan;
  fields: RecordFieldInitializer[];
  /** Optional base for update-as-new-value: `Point { ...base, x: 3 }`. */
  base?: Expr;
  /** Filled by the semantic checker. */
  recordTargetName?: string;
}

export interface RecordFieldInitializer extends NodeBase {
  kind: "RecordFieldInitializer";
  name: string;
  nameSpan: SourceSpan;
  value: Expr;
  /** Filled by the semantic checker. */
  fieldIndex?: number;
  fieldTargetName?: string;
}

export interface FieldAccess extends NodeBase {
  kind: "FieldAccess";
  target: Expr;
  field: string;
  fieldSpan: SourceSpan;
  /** Filled by the semantic checker. */
  fieldIndex?: number;
  /** Record type of the access target. */
  recordType?: TypeName;
}

export interface CallExpr extends NodeBase {
  kind: "CallExpr";
  callee: string;
  calleeSpan: SourceSpan;
  args: Expr[];
  /** Filled by the semantic checker. */
  calleeSymbolId?: string;
  calleeTargetName?: string;
  calleeReturnType?: TypeName;
}

export type UnaryOp = "-" | "!";
export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||";

export interface UnaryExpr extends NodeBase {
  kind: "UnaryExpr";
  op: UnaryOp;
  operand: Expr;
}

export interface BinaryExpr extends NodeBase {
  kind: "BinaryExpr";
  op: BinaryOp;
  left: Expr;
  right: Expr;
}

/**
 * Structure-only representation used to prove that syntax profiles map to the
 * same program. Locations, node ids, comments, and annotations are excluded.
 */
export function normalizeAst(program: Program): unknown {
  return normalizeProgram(program);
}

function normalizeProgram(program: Program): unknown {
  return {
    kind: "Program",
    records: program.records.map((record) => ({
      kind: "RecordDecl",
      name: record.name,
      fields: record.fields.map((field) => ({ name: field.name, type: field.type.name })),
    })),
    functions: program.functions.map((fn) => ({
      kind: "FunctionDecl",
      name: fn.name,
      params: fn.params.map((p) => ({ name: p.name, type: p.type.name })),
      returnType: fn.returnType.name,
      body: normalizeBlock(fn.body),
    })),
  };
}

function normalizeBlock(block: Block): unknown {
  return { kind: "Block", statements: block.statements.map(normalizeStmt) };
}

function normalizeStmt(stmt: Stmt): unknown {
  switch (stmt.kind) {
    case "LetStmt":
      return {
        kind: "LetStmt",
        name: stmt.name,
        type: stmt.type.name,
        value: normalizeExpr(stmt.value),
      };
    case "IfStmt":
      return {
        kind: "IfStmt",
        condition: normalizeExpr(stmt.condition),
        thenBlock: normalizeBlock(stmt.thenBlock),
        elseBlock: stmt.elseBlock ? normalizeBlock(stmt.elseBlock) : null,
      };
    case "ReturnStmt":
      return { kind: "ReturnStmt", value: normalizeExpr(stmt.value) };
  }
}

function normalizeExpr(expr: Expr): unknown {
  switch (expr.kind) {
    case "IntLiteral":
      return { kind: "IntLiteral", value: expr.value };
    case "BoolLiteral":
      return { kind: "BoolLiteral", value: expr.value };
    case "StringLiteral":
      return { kind: "StringLiteral", value: expr.value };
    case "VarRef":
      return { kind: "VarRef", name: expr.name };
    case "CallExpr":
      return { kind: "CallExpr", callee: expr.callee, args: expr.args.map(normalizeExpr) };
    case "UnaryExpr":
      return { kind: "UnaryExpr", op: expr.op, operand: normalizeExpr(expr.operand) };
    case "BinaryExpr":
      return {
        kind: "BinaryExpr",
        op: expr.op,
        left: normalizeExpr(expr.left),
        right: normalizeExpr(expr.right),
      };
    case "RecordLiteral":
      return {
        kind: "RecordLiteral",
        recordName: expr.recordName,
        base: expr.base ? normalizeExpr(expr.base) : null,
        fields: expr.fields.map((field) => ({ name: field.name, value: normalizeExpr(field.value) })),
      };
    case "FieldAccess":
      return { kind: "FieldAccess", target: normalizeExpr(expr.target), field: expr.field };
  }
}

export function walkExpr(expr: Expr, visit: (node: Expr) => void): void {
  visit(expr);
  switch (expr.kind) {
    case "UnaryExpr":
      walkExpr(expr.operand, visit);
      break;
    case "BinaryExpr":
      walkExpr(expr.left, visit);
      walkExpr(expr.right, visit);
      break;
    case "CallExpr":
      for (const arg of expr.args) walkExpr(arg, visit);
      break;
    case "RecordLiteral":
      if (expr.base) walkExpr(expr.base, visit);
      for (const field of expr.fields) walkExpr(field.value, visit);
      break;
    case "FieldAccess":
      walkExpr(expr.target, visit);
      break;
    default:
      break;
  }
}

export function walkStatements(block: Block, visit: (stmt: Stmt) => void): void {
  for (const stmt of block.statements) {
    visit(stmt);
    if (stmt.kind === "IfStmt") {
      walkStatements(stmt.thenBlock, visit);
      if (stmt.elseBlock) walkStatements(stmt.elseBlock, visit);
    }
  }
}
