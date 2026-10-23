import type {
  Block,
  Expr,
  FunctionDecl,
  MatchExpr,
  Program,
  RecordDecl,
  RecordField,
  Stmt,
  TypeRef,
  VariantAlternative,
  VariantDecl,
} from "../contracts/ast";
import type { Diagnostic } from "../contracts/diagnostics";
import { error } from "../contracts/diagnostics";
import { flattenEntryParams } from "../contracts/entry";
import type { FunctionSignature, TypedProgram } from "../contracts/outcome";
import {
  builtinTypeArgumentName,
  isBuiltinOptionResultTypeName,
  isListTypeName,
  isOptionTypeName,
  isPrimitiveTypeName,
  isResultTypeName,
  listElementTypeName,
  listTypeName,
  optionTypeName,
  resultTypeName,
  type TypeName,
} from "../contracts/tokens";

interface Symbol {
  symbolId: string;
  targetName: string;
  name: string;
  type: TypeName;
  kind: "local" | "param";
}

interface RecordSymbol {
  decl: RecordDecl;
  fields: Map<string, RecordField>;
}

interface VariantSymbol {
  decl: VariantDecl;
  alternatives: Map<string, VariantAlternative>;
}

interface AlternativeSymbol {
  variant: VariantDecl;
  alternative: VariantAlternative;
}

/** Checked shape of a compiler-generated Option/Result tagged type. */
interface BuiltinVariantSymbol {
  typeName: TypeName;
  targetName: string;
  kind: "option" | "result";
  typeArgument: TypeName;
  alternatives: BuiltinAlternativeSymbol[];
  byName: Map<string, BuiltinAlternativeSymbol>;
}

interface BuiltinAlternativeSymbol {
  name: string;
  targetName: string;
  tag: number;
  payloadTypes: TypeName[];
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
  private readonly records = new Map<string, RecordSymbol>();
  private readonly variants = new Map<string, VariantSymbol>();
  /** Bare alternative names are the constructor namespace; duplicates stay ambiguous. */
  private readonly alternatives = new Map<string, AlternativeSymbol[]>();
  private readonly callGraph = new Map<string, Set<string>>();
  /** Built-in Option/Result types are monomorphized into compiler-generated variants. */
  private readonly builtinVariants = new Map<TypeName, BuiltinVariantSymbol>();
  private builtinVariantCounter = 0;
  private localCounter = 0;

  constructor(private readonly program: Program) {}

  run(): CheckResult {
    this.registerFunctions();
    this.registerVariantDeclarations();
    this.registerRecords();
    this.validateVariantPayloads();
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
        builtinVariants: [...this.builtinVariants.values()].map((variant) => ({
          typeName: variant.typeName,
          targetName: variant.targetName,
          kind: variant.kind,
          typeArgument: variant.typeArgument,
          alternatives: variant.alternatives.map((alternative) => ({
            name: alternative.name,
            targetName: alternative.targetName,
            tag: alternative.tag,
            payloadTypes: [...alternative.payloadTypes],
          })),
        })),
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

  private registerVariantDeclarations(): void {
    this.program.variants.forEach((variant, index) => {
      if (this.variants.has(variant.name)) {
        this.diagnostics.push(
          error(
            "E_DUPLICATE_VARIANT",
            `variant "${variant.name}" is declared more than once`,
            variant.nameSpan,
          ),
        );
        return;
      }
      variant.symbolId = `variant:${index + 1}`;
      variant.targetName = `V${index + 1}`;
      const alternatives = new Map<string, VariantAlternative>();
      if (variant.alternatives.length === 0) {
        this.diagnostics.push(
          error(
            "E_EMPTY_VARIANT",
            `variant "${variant.name}" must declare at least one alternative`,
            variant.nameSpan,
          ),
        );
      }
      variant.alternatives.forEach((alternative, alternativeIndex) => {
        alternative.symbolId = `variant:${index + 1}:alternative:${alternativeIndex + 1}`;
        alternative.targetName = `a${alternativeIndex + 1}`;
        alternative.tag = alternativeIndex;
        if (alternatives.has(alternative.name)) {
          this.diagnostics.push(
            error(
              "E_DUPLICATE_ALTERNATIVE",
              `alternative "${alternative.name}" is declared more than once in variant "${variant.name}"`,
              alternative.nameSpan,
            ),
          );
          return;
        }
        alternatives.set(alternative.name, alternative);
        const candidates = this.alternatives.get(alternative.name) ?? [];
        candidates.push({ variant, alternative });
        this.alternatives.set(alternative.name, candidates);
      });
      this.variants.set(variant.name, { decl: variant, alternatives });
    });
  }

  private validateVariantPayloads(): void {
    for (const variant of this.variants.values()) {
      for (const alternative of variant.alternatives.values()) {
        alternative.payloadTypes = alternative.payload.map((payload) => this.resolvePayloadType(payload, alternative));
      }
    }
  }

  private resolvePayloadType(payload: TypeRef, alternative: VariantAlternative): TypeName {
    const canonical = this.canonicalTypeRef(payload);
    if (canonical === "i32" || canonical === "bool") return canonical;
    if (
      payload.elementType ||
      payload.typeArgument ||
      isListTypeName(canonical) ||
      isBuiltinOptionResultTypeName(canonical) ||
      canonical === "string"
    ) {
      this.diagnostics.push(
        error(
          "E_VARIANT_PAYLOAD_UNSUPPORTED",
          `payload type "${canonical}" of alternative "${alternative.name}" is not supported in this slice`,
          payload.span,
          "variant payloads are scalar: only i32 and bool",
        ),
      );
      return "i32";
    }
    if (this.variants.has(canonical) || this.records.has(canonical)) {
      this.diagnostics.push(
        error(
          "E_VARIANT_PAYLOAD_UNSUPPORTED",
          `payload type "${canonical}" of alternative "${alternative.name}" is not supported in this slice`,
          payload.span,
          "variant payloads are scalar: only i32 and bool",
        ),
      );
      return "i32";
    }
    this.diagnostics.push(
      error("E_UNKNOWN_TYPE", `unknown payload type "${canonical}"`, payload.span),
    );
    return "i32";
  }

  private canonicalTypeRef(type: TypeRef): TypeName {
    if (type.elementType) return listTypeName(this.canonicalTypeRef(type.elementType));
    if (type.typeArgument) {
      const argument = this.canonicalTypeRef(type.typeArgument);
      return type.name.startsWith("Result<") ? resultTypeName(argument) : optionTypeName(argument);
    }
    return type.name;
  }

  private registerRecords(): void {
    this.program.records.forEach((record, index) => {
      if (this.records.has(record.name)) {
        this.diagnostics.push(
          error(
            "E_DUPLICATE_RECORD",
            `record "${record.name}" is declared more than once`,
            record.nameSpan,
          ),
        );
        return;
      }
      if (this.variants.has(record.name)) {
        this.diagnostics.push(
          error(
            "E_DUPLICATE_TYPE",
            `type "${record.name}" is declared as both a record and a variant`,
            record.nameSpan,
            "record and variant names share one nominal type namespace",
          ),
        );
      }
      record.symbolId = `record:${index + 1}`;
      record.targetName = `R${index + 1}`;
      const fields = new Map<string, RecordField>();
      record.fields.forEach((field, fieldIndex) => {
        field.symbolId = `record:${index + 1}:field:${fieldIndex + 1}`;
        field.targetName = `f${fieldIndex + 1}`;
        field.fieldIndex = fieldIndex;
        if (fields.has(field.name)) {
          this.diagnostics.push(
            error(
              "E_DUPLICATE_FIELD",
              `field "${field.name}" is declared more than once in record "${record.name}"`,
              field.nameSpan,
            ),
          );
        } else {
          fields.set(field.name, field);
        }
      });
      this.records.set(record.name, { decl: record, fields });
    });

    // Field types may name a record declared later, so validate after every
    // record name is registered.
    const edges = new Map<string, string[]>();
    for (const record of this.program.records) {
      const recordEdges: string[] = [];
      for (const field of record.fields) {
        if (isOptionTypeName(field.type.name) || isResultTypeName(field.type.name)) {
          this.diagnostics.push(
            error(
              isOptionTypeName(field.type.name)
                ? "E_OPTION_FIELD_UNSUPPORTED"
                : "E_RESULT_FIELD_UNSUPPORTED",
              `record field "${field.name}" cannot use ${isOptionTypeName(field.type.name) ? "Option" : "Result"} in this slice`,
              field.type.span,
              "Option and Result values are supported only as locals, internal parameters, and internal returns",
            ),
          );
          continue;
        }
        if (field.type.name === "string") {
          this.diagnostics.push(
            error(
              "E_STRING_FIELD_UNSUPPORTED",
              `record field "${field.name}" cannot use string in this slice`,
              field.type.span,
            ),
          );
          continue;
        }
        if (isListTypeName(field.type.name)) {
          this.diagnostics.push(
            error(
              "E_LIST_FIELD_UNSUPPORTED",
              `record field "${field.name}" cannot use a list in this slice`,
              field.type.span,
              "list values are supported only as locals, internal parameters, and internal returns",
            ),
          );
          continue;
        }
        if (this.variants.has(field.type.name)) {
          this.diagnostics.push(
            error(
              "E_VARIANT_FIELD_UNSUPPORTED",
              `record field "${field.name}" cannot use variant "${field.type.name}" in this slice`,
              field.type.span,
              "variant values are supported only as locals, internal parameters, and internal returns",
            ),
          );
          continue;
        }
        if (isPrimitiveTypeName(field.type.name)) continue;
        if (this.records.has(field.type.name)) {
          recordEdges.push(field.type.name);
        } else {
          this.diagnostics.push(
            error(
              "E_UNKNOWN_TYPE",
              `unknown type "${field.type.name}" for field "${field.name}"`,
              field.type.span,
            ),
          );
        }
      }
      edges.set(record.name, recordEdges);
    }

    // Recursive records require indirection/ownership semantics that are not
    // specified yet. Reject every cycle, including self-recursion.
    const state = new Map<string, "visiting" | "done">();
    const stack: string[] = [];
    const visit = (name: string): void => {
      if (state.get(name) === "done") return;
      if (state.get(name) === "visiting") {
        const start = stack.indexOf(name);
        const cycle = [...stack.slice(start), name].join(" -> ");
        const record = this.records.get(name);
        if (record) {
          this.diagnostics.push(
            error(
              "E_RECURSIVE_RECORD",
              `record cycle is not supported: ${cycle}`,
              record.decl.nameSpan,
            ),
          );
        }
        return;
      }
      state.set(name, "visiting");
      stack.push(name);
      for (const next of edges.get(name) ?? []) visit(next);
      stack.pop();
      state.set(name, "done");
    };
    for (const name of edges.keys()) visit(name);
  }

  private checkFunction(fn: FunctionDecl): void {
    this.currentFunctionName = fn.name;
    const scope = new Scope(null);
    const seenParams = new Set<string>();
    const autoEntry = fn.name === "main" || this.program.functions.length === 1;
    for (const param of fn.params) {
      if (seenParams.has(param.name)) {
        this.diagnostics.push(
          error("E_DUPLICATE_PARAMETER", `parameter "${param.name}" is declared more than once`, param.nameSpan),
        );
      }
      seenParams.add(param.name);
      const paramType = this.resolveType(param.type);
      if (autoEntry) {
        const unsupported = this.entryParamDiagnostic(fn.name, param.name, paramType);
        if (unsupported) {
          this.diagnostics.push(
            error(unsupported.code, unsupported.message, param.type.span, unsupported.detail),
          );
        }
      }
      const symbol = this.declareLocal(scope, param.name, paramType, param.nameSpan, "param");
      if (symbol) {
        param.symbolId = symbol.symbolId;
        param.targetName = symbol.targetName;
      }
    }

    const returnType = this.resolveType(fn.returnType);
    const returnKind = this.entryBoundaryKind(returnType);
    if (autoEntry && returnKind) {
      this.diagnostics.push(
        error(
          entryBoundaryCode(returnKind, "RETURN"),
          `entry function "${fn.name}" cannot return ${returnKind} "${returnType}"`,
          fn.returnType.span,
          "entry outcomes are scalar; return i32 or bool and compare data inside the program",
        ),
      );
    }

    this.checkBlock(fn.body, scope, returnType);

    if (!definitelyReturns(fn.body)) {
      this.diagnostics.push(
        error(
          "E_MISSING_RETURN",
          `function "${fn.name}" can reach the end without returning a value`,
          fn.nameSpan,
          `return a value of type ${returnType} on every path`,
        ),
      );
    }
  }

  private entryBoundaryKind(type: TypeName): string | undefined {
    if (type === "string") return "string";
    if (isListTypeName(type)) return "list";
    if (isOptionTypeName(type)) return "option";
    if (isResultTypeName(type)) return "result";
    if (this.variants.has(type)) return "variant";
    if (this.records.has(type)) return "record";
    return undefined;
  }

  /**
   * Entry scalars are i32 and bool. Record parameters are allowed when every
   * leaf field is scalar; other types stay rejected at the boundary.
   */
  private entryParamDiagnostic(
    fnName: string,
    paramName: string,
    paramType: TypeName,
  ): { code: string; message: string; detail: string } | undefined {
    if (paramType === "i32" || paramType === "bool") return undefined;
    if (this.records.has(paramType)) {
      const layout = flattenEntryParams(
        [{ name: paramName, type: paramType }],
        (type) =>
          this.records
            .get(type)
            ?.decl.fields.map((field) => ({ name: field.name, type: field.type.name })),
      )[0];
      if (!layout.unsupportedLeaf) return undefined;
      return {
        code: "E_RECORD_ENTRY_PARAMETER_UNSUPPORTED",
        message: `entry function "${fnName}" cannot take record parameter "${paramName}" with non-scalar field "${layout.unsupportedLeaf.fieldPath}" of type ${layout.unsupportedLeaf.type}`,
        detail:
          "entry record parameters may contain only i32 and bool leaves; string, list, variant, Option, Result, and unknown leaf types are not allowed",
      };
    }
    const kind = this.entryBoundaryKind(paramType)!;
    return {
      code: entryBoundaryCode(kind, "PARAMETER"),
      message: `entry function "${fnName}" cannot take ${kind} parameter "${paramName}"`,
      detail:
        "entry values come from scalar command-line arguments; record parameters may contain only i32 and bool leaves",
    };
  }

  private resolveType(type: import("../contracts/ast").TypeRef): TypeName {
    if (type.typeArgument) {
      const argument = this.resolveType(type.typeArgument);
      const isResult = type.name.startsWith("Result<");
      if (isBuiltinOptionResultTypeName(argument)) {
        this.diagnostics.push(
          error(
            "E_NESTED_OPTION_RESULT",
            `nested ${isResult ? "Result" : "Option"} type argument "${argument}" is not supported in this slice`,
            type.typeArgument.span,
            "Option/Result payloads are i32 or bool only",
          ),
        );
        const fallback = isResult ? resultTypeName("i32") : optionTypeName("i32");
        this.ensureBuiltinVariant(fallback);
        return fallback;
      }
      if (argument !== "i32" && argument !== "bool") {
        this.diagnostics.push(
          error(
            isResult ? "E_RESULT_TYPE_ARGUMENT_UNSUPPORTED" : "E_OPTION_TYPE_ARGUMENT_UNSUPPORTED",
            `${isResult ? "Result" : "Option"} type argument "${argument}" is not supported in this slice`,
            type.typeArgument.span,
            "Option/Result payloads are i32 or bool only",
          ),
        );
        const fallback = isResult ? resultTypeName("i32") : optionTypeName("i32");
        this.ensureBuiltinVariant(fallback);
        return fallback;
      }
      const canonical = isResult ? resultTypeName(argument) : optionTypeName(argument);
      this.ensureBuiltinVariant(canonical);
      return canonical;
    }
    if (isBuiltinOptionResultTypeName(type.name)) {
      // Defensive: a canonical built-in name that was not produced through typeArgument.
      const argument = builtinTypeArgumentName(type.name) ?? "i32";
      if (argument !== "i32" && argument !== "bool") {
        this.diagnostics.push(
          error(
            isResultTypeName(type.name) ? "E_RESULT_TYPE_ARGUMENT_UNSUPPORTED" : "E_OPTION_TYPE_ARGUMENT_UNSUPPORTED",
            `type argument "${argument}" is not supported in this slice`,
            type.span,
            "Option/Result payloads are i32 or bool only",
          ),
        );
        const fallback = isResultTypeName(type.name) ? resultTypeName("i32") : optionTypeName("i32");
        this.ensureBuiltinVariant(fallback);
        return fallback;
      }
      this.ensureBuiltinVariant(type.name);
      return type.name;
    }
    if (type.elementType) {
      const element = this.resolveType(type.elementType);
      if (element !== "i32" && element !== "bool") {
        const message = isOptionTypeName(element) || isResultTypeName(element)
          ? `list element type "${element}" cannot be Option/Result in this slice`
          : this.variants.has(element)
            ? `list element type "${element}" cannot be a variant in this slice`
            : `list element type "${element}" is not supported in this slice`;
        this.diagnostics.push(
          error(
            listElementDiagnosticCode(element, this.variants.has(element)),
            message,
            type.elementType.span,
            "only list<i32> and list<bool> are implemented",
          ),
        );
        return listTypeName("i32");
      }
      return listTypeName(element);
    }
    if (isListTypeName(type.name)) {
      // Defensive: a canonical list name that was not produced through elementType.
      const element = listElementTypeName(type.name) ?? "i32";
      if (element !== "i32" && element !== "bool") {
        this.diagnostics.push(
          error(
            "E_LIST_ELEMENT_UNSUPPORTED",
            `list element type "${element}" is not supported in this slice`,
            type.span,
            "only list<i32> and list<bool> are implemented",
          ),
        );
        return listTypeName("i32");
      }
      return type.name;
    }
    if (isPrimitiveTypeName(type.name) || this.records.has(type.name) || this.variants.has(type.name)) {
      return type.name;
    }
    this.diagnostics.push(
      error(
        "E_UNKNOWN_TYPE",
        `unknown type "${type.name}"`,
        type.span,
        "types are i32, bool, string, list<i32>, list<bool>, Option<i32>, Option<bool>, Result<i32>, Result<bool>, or a declared record or variant name",
      ),
    );
    return "i32";
  }

  private ensureBuiltinVariant(typeName: TypeName): BuiltinVariantSymbol {
    const existing = this.builtinVariants.get(typeName);
    if (existing) return existing;
    const isResult = isResultTypeName(typeName);
    const typeArgument = builtinTypeArgumentName(typeName) ?? "i32";
    this.builtinVariantCounter += 1;
    const alternatives: BuiltinAlternativeSymbol[] = isResult
      ? [
          { name: "ok", targetName: "a1", tag: 0, payloadTypes: [typeArgument] },
          { name: "err", targetName: "a2", tag: 1, payloadTypes: ["string"] },
        ]
      : [
          { name: "some", targetName: "a1", tag: 0, payloadTypes: [typeArgument] },
          { name: "none", targetName: "a2", tag: 1, payloadTypes: [] },
        ];
    const variant: BuiltinVariantSymbol = {
      typeName,
      targetName: `X${this.builtinVariantCounter}`,
      kind: isResult ? "result" : "option",
      typeArgument,
      alternatives,
      byName: new Map(alternatives.map((alternative) => [alternative.name, alternative])),
    };
    this.builtinVariants.set(typeName, variant);
    return variant;
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
        const declaredType = this.resolveType(stmt.type);
        const valueType = this.checkExpr(stmt.value, scope, declaredType);
        if (valueType !== declaredType) {
          this.diagnostics.push(
            error(
              "E_TYPE_MISMATCH",
              `cannot bind ${valueType} to "${stmt.name}" of type ${declaredType}`,
              stmt.value.span,
            ),
          );
        }
        const symbol = this.declareLocal(scope, stmt.name, declaredType, stmt.nameSpan, "local");
        if (symbol) {
          stmt.symbolId = symbol.symbolId;
          stmt.targetName = symbol.targetName;
        }
        return;
      }
      case "IfStmt": {
        const conditionType = this.checkExpr(stmt.condition, scope, "bool");
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
        const valueType = this.checkExpr(stmt.value, scope, returnType);
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

  private checkExpr(expr: Expr, scope: Scope, expected?: TypeName): TypeName {
    switch (expr.kind) {
      case "IntLiteral":
        return "i32";
      case "BoolLiteral":
        return "bool";
      case "StringLiteral":
        return "string";
      case "ListLiteral": {
        if (expr.elements.length === 0) {
          this.diagnostics.push(
            error(
              "E_EMPTY_LIST_UNSUPPORTED",
              "empty list literals are not supported in this slice",
              expr.span,
              "write at least one element; empty lists need an expected element type",
            ),
          );
          expr.resolvedType = listTypeName("i32");
          return expr.resolvedType;
        }
        const expectedElement = expected && isListTypeName(expected) ? listElementTypeName(expected) : undefined;
        const elementTypes = expr.elements.map((element) => this.checkExpr(element, scope, expectedElement));
        const first = elementTypes[0];
        if (!isListElementType(first)) {
          this.diagnostics.push(
            error(
              listElementDiagnosticCode(first, this.variants.has(first)),
              isOptionTypeName(first) || isResultTypeName(first)
                ? `list literal element type ${first} cannot be Option/Result in this slice`
                : this.variants.has(first)
                  ? `list literal element type ${first} cannot be a variant in this slice`
                  : `list literal element type ${first} is not supported in this slice`,
              expr.elements[0].span,
              "only list<i32> and list<bool> are implemented",
            ),
          );
          expr.resolvedType = listTypeName("i32");
          return expr.resolvedType;
        }
        const mismatched = elementTypes.findIndex((elementType) => elementType !== first);
        if (mismatched >= 0) {
          this.diagnostics.push(
            error(
              "E_LIST_ELEMENT_TYPE",
              `list literal mixes ${first} and ${elementTypes[mismatched]} elements`,
              expr.elements[mismatched].span,
              "every element of a list literal must have the same type",
            ),
          );
        }
        expr.resolvedType = listTypeName(first);
        return expr.resolvedType;
      }
      case "IndexExpr": {
        const targetType = this.checkExpr(expr.target, scope);
        const indexType = this.checkExpr(expr.index, scope, "i32");
        if (indexType !== "i32") {
          this.diagnostics.push(
            error(
              "E_LIST_INDEX_TYPE",
              `list index must be i32, found ${indexType}`,
              expr.index.span,
            ),
          );
        }
        if (!isListTypeName(targetType)) {
          this.diagnostics.push(
            error(
              "E_INDEX_ON_NON_LIST",
              `cannot index value of type ${targetType}`,
              expr.target.span,
              "only list<i32> and list<bool> values support [i] in this slice",
            ),
          );
          expr.resolvedType = "i32";
          return expr.resolvedType;
        }
        const elementType = listElementTypeName(targetType) ?? "i32";
        if (!isListElementType(elementType)) {
          expr.resolvedType = "i32";
          return expr.resolvedType;
        }
        expr.resolvedType = elementType;
        return elementType;
      }
      case "VarRef": {
        const symbol = scope.lookup(expr.name);
        if (!symbol) {
          this.diagnostics.push(error("E_UNKNOWN_NAME", `unknown name "${expr.name}"`, expr.span));
          return "i32";
        }
        expr.symbolId = symbol.symbolId;
        expr.targetName = symbol.targetName;
        expr.resolvedType = symbol.type;
        return symbol.type;
      }
      case "RecordLiteral": {
        const record = this.records.get(expr.recordName);
        if (!record) {
          this.diagnostics.push(
            error("E_UNKNOWN_RECORD", `unknown record "${expr.recordName}"`, expr.recordNameSpan),
          );
          for (const field of expr.fields) this.checkExpr(field.value, scope);
          return "i32";
        }
        expr.recordTargetName = record.decl.targetName;
        if (expr.base) {
          const baseType = this.checkExpr(expr.base, scope);
          if (baseType !== expr.recordName) {
            this.diagnostics.push(
              error(
                "E_FIELD_TYPE",
                `record update base has type ${baseType}, expected ${expr.recordName}`,
                expr.base.span,
              ),
            );
          }
        }
        const provided = new Set<string>();
        for (const initializer of expr.fields) {
          if (provided.has(initializer.name)) {
            this.diagnostics.push(
              error(
                "E_DUPLICATE_FIELD_INITIALIZER",
                `field "${initializer.name}" is initialized more than once`,
                initializer.nameSpan,
              ),
            );
          }
          provided.add(initializer.name);
          const field = record.fields.get(initializer.name);
          if (!field) {
            this.diagnostics.push(
              error(
                "E_UNKNOWN_FIELD",
                `record "${expr.recordName}" has no field "${initializer.name}"`,
                initializer.nameSpan,
              ),
            );
            this.checkExpr(initializer.value, scope);
            continue;
          }
          initializer.fieldIndex = field.fieldIndex;
          initializer.fieldTargetName = field.targetName;
          const valueType = this.checkExpr(initializer.value, scope, field.type.name);
          if (valueType !== field.type.name) {
            this.diagnostics.push(
              error(
                "E_FIELD_TYPE",
                `field "${initializer.name}" of record "${expr.recordName}" expects ${field.type.name}, found ${valueType}`,
                initializer.value.span,
              ),
            );
          }
        }
        for (const field of record.decl.fields) {
          if (!expr.base && !provided.has(field.name)) {
            this.diagnostics.push(
              error(
                "E_MISSING_FIELD",
                `record literal for "${expr.recordName}" is missing field "${field.name}"`,
                expr.span,
              ),
            );
          }
        }
        return expr.recordName;
      }
      case "FieldAccess": {
        const targetType = this.checkExpr(expr.target, scope);
        const record = this.records.get(targetType);
        if (!record) {
          if (this.variants.has(targetType)) {
            this.diagnostics.push(
              error(
                "E_FIELD_ACCESS_ON_VARIANT",
                `cannot access field "${expr.field}" on variant "${targetType}"`,
                expr.fieldSpan,
                "select an alternative with match instead of accessing a field",
              ),
            );
          } else if (isPrimitiveTypeName(targetType) || isListTypeName(targetType)) {
            this.diagnostics.push(
              error(
                "E_FIELD_ACCESS_ON_SCALAR",
                `cannot access field "${expr.field}" on value of type ${targetType}`,
                expr.fieldSpan,
              ),
            );
          }
          return "i32";
        }
        const field = record.fields.get(expr.field);
        if (!field) {
          this.diagnostics.push(
            error(
              "E_UNKNOWN_FIELD",
              `record "${targetType}" has no field "${expr.field}"`,
              expr.fieldSpan,
            ),
          );
          return "i32";
        }
        expr.recordType = targetType;
        expr.fieldIndex = field.fieldIndex;
        return field.type.name;
      }
      case "CallExpr": {
        if (isBuiltinConstructorName(expr.callee)) {
          return this.checkBuiltinConstructor(expr, scope, expected);
        }
        if (expr.callee === "length" && !this.signatures.has(expr.callee)) {
          expr.builtin = "length";
          expr.calleeReturnType = "i32";
          if (expr.args.length !== 1) {
            this.diagnostics.push(
              error(
                "E_ARITY",
                `length expects 1 argument, received ${expr.args.length}`,
                expr.span,
              ),
            );
          }
          expr.args.forEach((arg) => {
            const argType = this.checkExpr(arg, scope);
            if (!isListTypeName(argType)) {
              this.diagnostics.push(
                error(
                  "E_LENGTH_ARGUMENT_TYPE",
                  `length expects list<i32> or list<bool>, found ${argType}`,
                  arg.span,
                ),
              );
            }
          });
          return "i32";
        }
        const signature = this.signatures.get(expr.callee);
        const alternativeCandidates = this.alternatives.get(expr.callee) ?? [];
        if ((signature ? 1 : 0) + alternativeCandidates.length > 1) {
          this.diagnostics.push(
            error(
              "E_AMBIGUOUS_CONSTRUCTOR",
              `call "${expr.callee}" is ambiguous; the name resolves to more than one function or variant alternative`,
              expr.calleeSpan,
              "rename the function or one of the alternatives so each call name resolves uniquely",
            ),
          );
          for (const arg of expr.args) this.checkExpr(arg, scope);
          return signature?.returnType ?? alternativeCandidates[0].variant.name;
        }
        if (!signature && alternativeCandidates.length === 1) {
          return this.checkConstructorCall(expr, alternativeCandidates[0], scope);
        }
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
          const param = signature.params[index];
          const argType = this.checkExpr(arg, scope, param?.type);
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
      case "MatchExpr":
        return this.checkMatch(expr, scope, expected);
      case "UnaryExpr": {
        const operandType = this.checkExpr(expr.operand, scope, expr.op === "-" ? "i32" : "bool");
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
        if (expr.op === "&&" || expr.op === "||") {
          const left = this.checkExpr(expr.left, scope, "bool");
          const right = this.checkExpr(expr.right, scope, "bool");
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
        if (expr.op === "==" || expr.op === "!=") {
          const left = this.checkExpr(expr.left, scope);
          // The left operand supplies contextual typing for names such as none().
          const right = this.checkExpr(expr.right, scope, left);
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
        const left = this.checkExpr(expr.left, scope, "i32");
        const right = this.checkExpr(expr.right, scope, "i32");
        switch (expr.op) {
          case "+":
          case "-":
          case "*":
          case "<":
          case "<=":
          case ">":
          case ">=": {
            if (left !== "i32" || right !== "i32") {
              this.diagnostics.push(
                error(
                  "E_OPERATOR_TYPE",
                  `operator "${expr.op}" requires i32 operands, found ${left} and ${right}`,
                  expr.span,
                ),
              );
            }
            return expr.op === "+" || expr.op === "-" || expr.op === "*" ? "i32" : "bool";
          }
        }
      }
    }
  }

  private checkBuiltinConstructor(
    expr: Extract<Expr, { kind: "CallExpr" }>,
    scope: Scope,
    expected?: TypeName,
  ): TypeName {
    const isOption = expr.callee === "some" || expr.callee === "none";
    const fallback = isOption ? optionTypeName("i32") : resultTypeName("i32");
    const expectedMatches =
      expected !== undefined &&
      isBuiltinOptionResultTypeName(expected) &&
      (isOption ? isOptionTypeName(expected) : isResultTypeName(expected));

    if (expected !== undefined && !expectedMatches) {
      this.diagnostics.push(
        error(
          "E_CONSTRUCTOR_EXPECTED_TYPE",
          `${expr.callee}() cannot produce ${expected}`,
          expr.span,
          `expected ${isOption ? "Option<i32> or Option<bool>" : "Result<i32> or Result<bool>"} in this context`,
        ),
      );
    }

    if (expr.callee === "none" || expr.callee === "err") {
      const expectedArity = expr.callee === "none" ? 0 : 1;
      if (expr.args.length !== expectedArity) {
        this.diagnostics.push(
          error(
            "E_ARITY",
            `${expr.callee}() expects ${expectedArity} argument(s), received ${expr.args.length}`,
            expr.span,
          ),
        );
      }
      if (expr.callee === "err") {
        expr.args.forEach((arg) => {
          const argType = this.checkExpr(arg, scope, "string");
          if (argType !== "string") {
            this.diagnostics.push(
              error(
                "E_CONSTRUCTOR_PAYLOAD_TYPE",
                `err payload has type ${argType}, expected string`,
                arg.span,
              ),
            );
          }
        });
      }
      if (!expectedMatches) {
        if (expected === undefined) {
          this.diagnostics.push(
            error(
              "E_MISSING_EXPECTED_TYPE",
              `${expr.callee}() requires an expected ${isOption ? "Option" : "Result"} type`,
              expr.span,
              `annotate the binding, parameter, return, or argument as ${isOption ? "Option<i32>" : "Result<i32>"} (or bool)`,
            ),
          );
        }
        this.annotateBuiltinConstructor(expr, fallback, expr.callee);
        return fallback;
      }
      this.annotateBuiltinConstructor(expr, expected!, expr.callee);
      return expected!;
    }

    // some(value) and ok(value) infer their payload type when no expected type is present.
    const payloadExpected = expectedMatches ? builtinTypeArgumentName(expected!) : undefined;
    let payloadType: TypeName | undefined;
    expr.args.forEach((arg, index) => {
      const argType = this.checkExpr(arg, scope, payloadExpected);
      if (index === 0) payloadType = argType;
      if (payloadExpected !== undefined && argType !== payloadExpected) {
        this.diagnostics.push(
          error(
            "E_CONSTRUCTOR_PAYLOAD_TYPE",
            `${expr.callee} payload has type ${argType}, expected ${payloadExpected}`,
            arg.span,
          ),
        );
      }
    });
    if (expr.args.length !== 1) {
      this.diagnostics.push(
        error(
          "E_ARITY",
          `${expr.callee}() expects 1 argument, received ${expr.args.length}`,
          expr.span,
        ),
      );
    }
    const inferred = payloadType ?? "i32";
    if (isBuiltinOptionResultTypeName(inferred)) {
      this.diagnostics.push(
        error(
          "E_NESTED_OPTION_RESULT",
          `${expr.callee}() cannot carry ${inferred}; Option/Result values cannot be nested in this slice`,
          expr.args[0]?.span ?? expr.span,
        ),
      );
      const fallbackType = isOption ? optionTypeName("i32") : resultTypeName("i32");
      this.annotateBuiltinConstructor(expr, expectedMatches ? expected! : fallbackType, expr.callee);
      return expectedMatches ? expected! : fallbackType;
    }
    if (inferred !== "i32" && inferred !== "bool") {
      this.diagnostics.push(
        error(
          "E_CONSTRUCTOR_PAYLOAD_TYPE",
          `${expr.callee} payload has type ${inferred}, expected i32 or bool`,
          expr.args[0]?.span ?? expr.span,
        ),
      );
      const fallbackType = isOption ? optionTypeName("i32") : resultTypeName("i32");
      this.annotateBuiltinConstructor(expr, expectedMatches ? expected! : fallbackType, expr.callee);
      return expectedMatches ? expected! : fallbackType;
    }
    const resolved = expectedMatches
      ? expected!
      : isOption
        ? optionTypeName(inferred)
        : resultTypeName(inferred);
    this.annotateBuiltinConstructor(expr, resolved, expr.callee);
    return resolved;
  }

  private annotateBuiltinConstructor(
    expr: Extract<Expr, { kind: "CallExpr" }>,
    typeName: TypeName,
    role: string,
  ): void {
    const variant = this.ensureBuiltinVariant(typeName);
    const alternative = variant.byName.get(role);
    if (!alternative) return;
    expr.calleeReturnType = typeName;
    expr.variantConstructor = {
      variantName: typeName,
      alternativeName: alternative.name,
      variantTargetName: variant.targetName,
      alternativeTargetName: alternative.targetName,
      tag: alternative.tag,
      payloadTypes: [...alternative.payloadTypes],
    };
  }

  private checkConstructorCall(
    expr: Extract<Expr, { kind: "CallExpr" }>,
    candidate: AlternativeSymbol,
    scope: Scope,
  ): TypeName {
    const { variant, alternative } = candidate;
    expr.variantConstructor = {
      variantName: variant.name,
      alternativeName: alternative.name,
      variantTargetName: variant.targetName!,
      alternativeTargetName: alternative.targetName!,
      tag: alternative.tag!,
      payloadTypes: alternative.payloadTypes ?? [],
    };
    const payloadTypes = alternative.payloadTypes ?? [];
    if (expr.args.length !== payloadTypes.length) {
      this.diagnostics.push(
        error(
          "E_ARITY",
          `alternative "${alternative.name}" expects ${payloadTypes.length} argument(s), received ${expr.args.length}`,
          expr.span,
        ),
      );
    }
    expr.args.forEach((arg, index) => {
      const expected = payloadTypes[index];
      const argType = this.checkExpr(arg, scope, expected);
      if (expected && argType !== expected) {
        this.diagnostics.push(
          error(
            "E_ARGUMENT_TYPE",
            `argument ${index + 1} of alternative "${alternative.name}" has type ${argType}, expected ${expected}`,
            arg.span,
          ),
        );
      }
    });
    return variant.name;
  }

  private checkMatch(expr: MatchExpr, scope: Scope, expected?: TypeName): TypeName {
    const scrutineeType = this.checkExpr(expr.scrutinee, scope);
    const userVariant = this.variants.get(scrutineeType);
    const builtinVariant =
      !userVariant && isBuiltinOptionResultTypeName(scrutineeType)
        ? this.ensureBuiltinVariant(scrutineeType)
        : undefined;
    if (!userVariant && !builtinVariant) {
      this.diagnostics.push(
        error(
          "E_MATCH_ON_NON_VARIANT",
          `match requires a variant scrutinee, found ${scrutineeType}`,
          expr.scrutinee.span,
        ),
      );
      for (const arm of expr.arms) this.checkExpr(arm.body, new Scope(scope), expected);
      expr.resolvedType = "i32";
      return "i32";
    }
    const alternatives = userVariant
      ? [...userVariant.alternatives.values()].map((alternative) => ({
          name: alternative.name,
          targetName: alternative.targetName!,
          tag: alternative.tag!,
          payloadTypes: alternative.payloadTypes ?? [],
        }))
      : builtinVariant!.alternatives.map((alternative) => ({
          name: alternative.name,
          targetName: alternative.targetName,
          tag: alternative.tag,
          payloadTypes: alternative.payloadTypes,
        }));
    const byName = new Map(alternatives.map((alternative) => [alternative.name, alternative]));
    expr.variantName = scrutineeType;
    let armType: TypeName | undefined;
    let sawWildcard = false;
    const matched = new Set<string>();

    const unify = (bodyType: TypeName, span: import("../contracts/diagnostics").SourceSpan): void => {
      if (armType === undefined) {
        armType = bodyType;
        return;
      }
      if (bodyType !== armType) {
        this.diagnostics.push(
          error(
            "E_MATCH_ARM_TYPE",
            `match arm has type ${bodyType} but another arm has type ${armType}`,
            span,
            "every match arm must produce the same type",
          ),
        );
      }
    };

    expr.arms.forEach((arm, index) => {
      const pattern = arm.pattern;
      if (pattern.kind === "WildcardPattern") {
        sawWildcard = true;
        if (index !== expr.arms.length - 1) {
          this.diagnostics.push(
            error(
              "E_WILDCARD_NOT_FINAL",
              'wildcard arm "_" must be the final match arm',
              pattern.span,
            ),
          );
        }
        unify(this.checkExpr(arm.body, new Scope(scope), expected), arm.body.span);
        return;
      }

      const alternative = byName.get(pattern.alternativeName);
      if (!alternative) {
        this.diagnostics.push(
          error(
            "E_UNKNOWN_ALTERNATIVE",
            `variant "${scrutineeType}" has no alternative "${pattern.alternativeName}"`,
            pattern.alternativeNameSpan,
            `alternatives: ${alternatives.map((candidate) => candidate.name).join(", ")}`,
          ),
        );
        unify(this.checkExpr(arm.body, new Scope(scope), expected), arm.body.span);
        return;
      }
      if (matched.has(alternative.name)) {
        this.diagnostics.push(
          error(
            "E_DUPLICATE_MATCH_ARM",
            `alternative "${alternative.name}" is matched more than once`,
            pattern.alternativeNameSpan,
          ),
        );
      }
      matched.add(alternative.name);
      pattern.tag = alternative.tag;
      pattern.alternativeTargetName = alternative.targetName;

      const payloadTypes = alternative.payloadTypes;
      if (pattern.bindings.length !== payloadTypes.length) {
        this.diagnostics.push(
          error(
            "E_PATTERN_ARITY",
            `alternative "${alternative.name}" has ${payloadTypes.length} payload value(s) but the pattern binds ${pattern.bindings.length}`,
            pattern.span,
          ),
        );
      }
      const armScope = new Scope(scope);
      pattern.bindings.forEach((binding, bindingIndex) => {
        const bindingType = payloadTypes[bindingIndex] ?? "i32";
        binding.resolvedType = bindingType;
        const symbol = this.declareLocal(armScope, binding.name, bindingType, binding.nameSpan, "local");
        if (symbol) {
          binding.symbolId = symbol.symbolId;
          binding.targetName = symbol.targetName;
        }
      });
      unify(this.checkExpr(arm.body, armScope, expected), arm.body.span);
    });

    if (!sawWildcard) {
      const missing = alternatives.map((alternative) => alternative.name).filter((name) => !matched.has(name));
      if (missing.length > 0) {
        this.diagnostics.push(
          error(
            "E_NON_EXHAUSTIVE_MATCH",
            `match on "${scrutineeType}" is not exhaustive; missing ${missing.join(", ")}`,
            expr.span,
            'cover every alternative or add a final "_" arm',
          ),
        );
      }
    }

    expr.resolvedType = armType ?? "i32";
    return expr.resolvedType;
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

function isListElementType(type: TypeName): boolean {
  return type === "i32" || type === "bool";
}

function isBuiltinConstructorName(name: string): boolean {
  return name === "some" || name === "none" || name === "ok" || name === "err";
}

function listElementDiagnosticCode(element: TypeName, isVariant: boolean): string {
  if (isOptionTypeName(element)) return "E_OPTION_IN_LIST";
  if (isResultTypeName(element)) return "E_RESULT_IN_LIST";
  if (isVariant) return "E_VARIANT_IN_LIST";
  return "E_LIST_ELEMENT_UNSUPPORTED";
}

function entryBoundaryCode(kind: string, boundary: "PARAMETER" | "RETURN"): string {
  return `E_${kind.toUpperCase()}_ENTRY_${boundary}_UNSUPPORTED`;
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
