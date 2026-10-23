import type { Diagnostic } from "../contracts/diagnostics";
import { error } from "../contracts/diagnostics";
import type { TypedProgram } from "../contracts/outcome";
import { isBuiltinOptionResultTypeName, isListTypeName, isOptionTypeName } from "../contracts/tokens";

export function chooseEntry(typed: TypedProgram, requested?: string): { entry?: string; diagnostic?: Diagnostic } {
  const variantNames = new Set(typed.ast.variants.map((variant) => variant.name));
  if (requested) {
    const found = typed.functions.find((fn) => fn.name === requested);
    if (!found) {
      return {
        diagnostic: error(
          "E_ENTRY_NOT_FOUND",
          `entry function "${requested}" was not found`,
          undefined,
          `available functions: ${typed.functions.map((fn) => fn.name).join(", ") || "<none>"}`,
        ),
      };
    }
    return scalarEntry(found, variantNames) ?? { entry: requested };
  }
  const main = typed.functions.find((fn) => fn.name === "main");
  if (main) return scalarEntry(main, variantNames) ?? { entry: "main" };
  if (typed.functions.length === 1) {
    const only = typed.functions[0];
    return scalarEntry(only, variantNames) ?? { entry: only.name };
  }
  return {
    diagnostic: error(
      "E_ENTRY_AMBIGUOUS",
      "no entry function was selected",
      undefined,
      'pass --entry <name>, or declare a function named "main"',
    ),
  };
}

function scalarEntry(
  signature: TypedProgram["functions"][number],
  variants: Set<string>,
): { diagnostic?: Diagnostic } | undefined {
  const nonScalarParam = signature.params.find((param) => param.type !== "i32" && param.type !== "bool");
  if (nonScalarParam) {
    const kind = boundaryKind(nonScalarParam.type, variants);
    return {
      diagnostic: error(
        entryBoundaryCode(kind, "PARAMETER"),
        `entry function "${signature.name}" cannot take ${kind} parameter "${nonScalarParam.name}"`,
        undefined,
        "entry values come from scalar command-line arguments",
      ),
    };
  }
  if (signature.returnType !== "i32" && signature.returnType !== "bool") {
    const kind = boundaryKind(signature.returnType, variants);
    return {
      diagnostic: error(
        entryBoundaryCode(kind, "RETURN"),
        `entry function "${signature.name}" cannot return ${kind} "${signature.returnType}"`,
        undefined,
        "entry outcomes are scalar",
      ),
    };
  }
  return undefined;
}

function boundaryKind(type: string, variants: Set<string>): string {
  if (type === "string") return "string";
  if (isListTypeName(type)) return "list";
  if (isOptionTypeName(type)) return "option";
  if (isBuiltinOptionResultTypeName(type)) return "result";
  if (variants.has(type)) return "variant";
  return "record";
}

function entryBoundaryCode(kind: string, boundary: "PARAMETER" | "RETURN"): string {
  return `E_${kind.toUpperCase()}_ENTRY_${boundary}_UNSUPPORTED`;
}
