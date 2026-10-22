import type { Block, Expr, FunctionDecl, Program, Stmt } from "../contracts/ast";
import type { Diagnostic } from "../contracts/diagnostics";
import { error } from "../contracts/diagnostics";
import type { FunctionSignature, TypedProgram } from "../contracts/outcome";
import type { TypeName } from "../contracts/tokens";

interface Symbol {
  symbolId: string;
  targetName: string;
  name: string;
  type: TypeName;
  kind: "local" | "param";
}

class Scope {
  private readonly names = new Map<string, Symbol>();
  constructor(readonly parent: Scope | null) {}

  lookup(name: string): Symbol | undefined {
    return this.names.get(name) ?? this.parent?.lookup(name);
  }

  declare(symbol: Symbol): void {
    this.names.set(symbol.name, symbol);
  }

  entries(): Symbol[] {
    return [...this.names.values()];
  }
}

export interface CheckResult {
  typed?: TypedProgram;
  diagnostics: Diagnostic[];
}

/** Checks names, types, returns, and the call graph; annotates the AST in place. */
export function check(program: Program): CheckResult {
  const checker = new Checker(program);
  return checker.run();
}

class Checker {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly functions = new Map<string, FunctionDecl>();
  private readonly signatures = new Map<string, FunctionSignature>();
  private readonly callGraph = new Map<string, Set<string>>();
  private localCounter = 0;

  constructor(private readonly program: Program) {}

  run(): CheckResult {
    this.registerFunctions();
    for (const fn of this.functions.values()) {
      this.checkFunction(fn);
    }
    this.checkCallGraph();
    if (this.diagnostics.some((d) => d.severity === "error")) {
      return { diagnostics: this.diagnostics };
    }
    const functions = [...this.functions.values()].map((fn) => this.signatures.get(fn.name)!);
    return {
      diagnostics: this.diagnostics,
      typed: {
        ast: this.program,
        functions,
        entryCandidates: functions,
      },
    };
  }

  private registerFunctions(): void {
    this.program.functions.forEach((fn, index) => {
      if (this.functions.has(fn.name)) {
        this.diagnostics.push(
          error("E_DUPLICATE_FUNCTION", `function "${fn.name}" is declared more than once`, fn.nameSpan),
        );
        return;
      }
      fn.symbolId = `function:${index + 1}`;
      fn.targetName = `f${index + 1}`;
      this.functions.set(fn.name, fn);
      this.signatures.set(fn.name, {
        symbolId: fn.symbolId,
        targetName: fn.targetName,
        name: fn.name,
        params: fn.params.map((p) => ({ name: p.name, type: p.type.name })),
        returnType: fn.returnType.name,
      });
      this.callGraph.set(fn.name, new Set());
    });
  }

  private checkFunction(fn: FunctionDecl): void {
    const signature = this.signatures.get(fn.name)!;
    this.currentFunctionName = fn.name;
    const scope = new Scope(null);
    const seenParams = new Set<string>();
    for (const param of fn.params) {
      if (seenParams.has(param.name)) {
        this.diagnostics.push(
          error("E_DUPLICATE_PARAMETER", `parameter "${param.name}" is declared more than once`, param.nameSpan),
        );
      }
      seenParams.add(param.name);
      const symbol = this.declareLocal(scope, param.name, param.type.name, param.nameSpan, "param");
      if (symbol) {
        param.symbolId = symbol.symbolId;
        param.targetName = symbol.targetName;
      }
    }

    this.checkBlock(fn.body, scope, signature.returnType);

    if (!definitelyReturns(fn.body)) {
      this.diagnostics.push(
        error(
          "E_MISSING_RETURN",
          `function "${fn.name}" can reach the end without returning a value`,
          fn.nameSpan,
          `return a value of type ${signature.returnType} on every path`,
        ),
      );
    }
  }

  private declareLocal(
    scope: Scope,
    name: string,
    type: TypeName,
    span: import("../contracts/diagnostics").SourceSpan,
    kind: "local" | "param",
  ): Symbol | undefined {
    if (this.functions.has(name)) {
      this.diagnostics.push(
        error(
          "E_NAME_SHADOWS_FUNCTION",
          `local name "${name}" shadows a function visible in this program`,
          span,
          "choose a distinct name",
        ),
      );
    }
    if (scope.lookup(name)) {
      this.diagnostics.push(
        error("E_REDECLARED_NAME", `name "${name}" is already visible in this scope`, span),
      );
    }
    this.localCounter += 1;
    const symbol: Symbol = {
      symbolId: `local:${this.localCounter}`,
      targetName: `v${this.localCounter}`,
      name,
      type,
      kind,
    };
    scope.declare(symbol);
    return symbol;
  }

  private checkBlock(block: Block, scope: Scope, returnType: TypeName): void {
    for (const stmt of block.statements) {
      this.checkStatement(stmt, scope, returnType);
    }
  }

  private checkStatement(stmt: Stmt, scope: Scope, returnType: TypeName): void {
    switch (stmt.kind) {
      case "LetStmt": {
        const valueType = this.checkExpr(stmt.value, scope);
        if (valueType !== stmt.type.name) {
          this.diagnostics.push(
            error(
              "E_TYPE_MISMATCH",
              `cannot bind ${valueType} to "${stmt.name}" of type ${stmt.type.name}`,
              stmt.value.span,
            ),
          );
        }
        const symbol = this.declareLocal(scope, stmt.name, stmt.type.name, stmt.nameSpan, "local");
        if (symbol) {
          stmt.symbolId = symbol.symbolId;
          stmt.targetName = symbol.targetName;
        }
        return;
      }
      case "IfStmt": {
        const conditionType = this.checkExpr(stmt.condition, scope);
        if (conditionType !== "bool") {
          this.diagnostics.push(
            error(
              "E_CONDITION_TYPE",
              `if condition must be bool, found ${conditionType}`,
              stmt.condition.span,
            ),
          );
        }
        this.checkBlock(stmt.thenBlock, new Scope(scope), returnType);
        if (stmt.elseBlock) this.checkBlock(stmt.elseBlock, new Scope(scope), returnType);
        return;
      }
      case "ReturnStmt": {
        const valueType = this.checkExpr(stmt.value, scope);
        if (valueType !== returnType) {
          this.diagnostics.push(
            error(
              "E_RETURN_TYPE",
              `return value has type ${valueType} but the function returns ${returnType}`,
              stmt.value.span,
            ),
          );
        }
        return;
      }
    }
  }

  private checkExpr(expr: Expr, scope: Scope): TypeName {
    switch (expr.kind) {
      case "IntLiteral":
        return "i32";
      case "BoolLiteral":
        return "bool";
      case "VarRef": {
        const symbol = scope.lookup(expr.name);
        if (!symbol) {
          this.diagnostics.push(error("E_UNKNOWN_NAME", `unknown name "${expr.name}"`, expr.span));
          return "i32";
        }
        expr.symbolId = symbol.symbolId;
        expr.targetName = symbol.targetName;
        return symbol.type;
      }
      case "CallExpr": {
        const signature = this.signatures.get(expr.callee);
        if (!signature) {
          this.diagnostics.push(
            error("E_UNKNOWN_FUNCTION", `unknown function "${expr.callee}"`, expr.calleeSpan),
          );
          for (const arg of expr.args) this.checkExpr(arg, scope);
          return "i32";
        }
        expr.calleeSymbolId = signature.symbolId;
        expr.calleeTargetName = signature.targetName;
        expr.calleeReturnType = signature.returnType;
        this.callGraph.get(this.currentFunctionName)?.add(expr.callee);
        if (expr.args.length !== signature.params.length) {
          this.diagnostics.push(
            error(
              "E_ARITY",
              `function "${expr.callee}" expects ${signature.params.length} argument(s), received ${expr.args.length}`,
              expr.span,
            ),
          );
        }
        expr.args.forEach((arg, index) => {
          const argType = this.checkExpr(arg, scope);
          const param = signature.params[index];
          if (param && argType !== param.type) {
            this.diagnostics.push(
              error(
                "E_ARGUMENT_TYPE",
                `argument ${index + 1} of "${expr.callee}" has type ${argType}, expected ${param.type}`,
                arg.span,
              ),
            );
          }
        });
        return signature.returnType;
      }
      case "UnaryExpr": {
        const operandType = this.checkExpr(expr.operand, scope);
        if (expr.op === "-") {
          if (operandType !== "i32") {
            this.diagnostics.push(
              error("E_OPERATOR_TYPE", `unary "-" requires i32, found ${operandType}`, expr.span),
            );
            return "i32";
          }
          return "i32";
        }
        if (operandType !== "bool") {
          this.diagnostics.push(
            error("E_OPERATOR_TYPE", `unary "!" requires bool, found ${operandType}`, expr.span),
          );
          return "bool";
        }
        return "bool";
      }
      case "BinaryExpr": {
        const left = this.checkExpr(expr.left, scope);
        const right = this.checkExpr(expr.right, scope);
        switch (expr.op) {
          case "+":
          case "-":
          case "*":
          case "<":
          case "<=":
          case ">":
          case ">=": {
            const expected = expr.op === "+" || expr.op === "-" || expr.op === "*" ? "i32" : "i32";
            if (left !== expected || right !== expected) {
              this.diagnostics.push(
                error(
                  "E_OPERATOR_TYPE",
                  `operator "${expr.op}" requires ${expected} operands, found ${left} and ${right}`,
                  expr.span,
                ),
              );
            }
            return expr.op === "+" || expr.op === "-" || expr.op === "*" ? "i32" : "bool";
          }
          case "==":
          case "!=": {
            if (left !== right) {
              this.diagnostics.push(
                error(
                  "E_OPERATOR_TYPE",
                  `operator "${expr.op}" requires matching operand types, found ${left} and ${right}`,
                  expr.span,
                ),
              );
            }
            return "bool";
          }
          case "&&":
          case "||": {
            if (left !== "bool" || right !== "bool") {
              this.diagnostics.push(
                error(
                  "E_OPERATOR_TYPE",
                  `operator "${expr.op}" requires bool operands, found ${left} and ${right}`,
                  expr.span,
                ),
              );
            }
            return "bool";
          }
        }
      }
    }
  }

  /** Set while checking a function body so call sites can be attributed. */
  private currentFunctionName = "";

  private checkCallGraph(): void {
    const state = new Map<string, "visiting" | "done">();
    const stack: string[] = [];

    const visit = (name: string): void => {
      const current = state.get(name);
      if (current === "done") return;
      if (current === "visiting") {
        const cycleStart = stack.indexOf(name);
        const cycle = [...stack.slice(cycleStart), name];
        const fn = this.functions.get(name)!;
        this.diagnostics.push(
          error(
            "E_RECURSION",
            `call graph contains a cycle: ${cycle.join(" -> ")}`,
            fn.nameSpan,
            "the POC core rejects direct and indirect recursion",
          ),
        );
        return;
      }
      state.set(name, "visiting");
      stack.push(name);
      for (const callee of this.callGraph.get(name) ?? []) {
        if (this.callGraph.has(callee)) visit(callee);
      }
      stack.pop();
      state.set(name, "done");
    };

    for (const name of this.callGraph.keys()) visit(name);
  }
}

function definitelyReturns(block: Block): boolean {
  for (const stmt of block.statements) {
    if (statementReturns(stmt)) return true;
  }
  return false;
}

function statementReturns(stmt: Stmt): boolean {
  switch (stmt.kind) {
    case "ReturnStmt":
      return true;
    case "IfStmt":
      return (
        stmt.elseBlock !== undefined &&
        definitelyReturns(stmt.thenBlock) &&
        definitelyReturns(stmt.elseBlock)
      );
    case "LetStmt":
      return false;
  }
}
