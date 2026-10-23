import type { Diagnostic } from "../contracts/diagnostics";
import { error } from "../contracts/diagnostics";
import type { TypedProgram } from "../contracts/outcome";
import { isListTypeName } from "../contracts/tokens";

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
    const list = isListTypeName(nonScalarParam.type);
    const variant = variants.has(nonScalarParam.type);
    const kind = nonScalarParam.type === "string" ? "string" : list ? "list" : variant ? "variant" : "record";
    return {
      diagnostic: error(
        nonScalarParam.type === "string"
          ? "E_STRING_ENTRY_PARAMETER_UNSUPPORTED"
          : list
            ? "E_LIST_ENTRY_PARAMETER_UNSUPPORTED"
            : variant
              ? "E_VARIANT_ENTRY_PARAMETER_UNSUPPORTED"
              : "E_RECORD_ENTRY_PARAMETER_UNSUPPORTED",
        `entry function "${signature.name}" cannot take ${kind} parameter "${nonScalarParam.name}"`,
        undefined,
        "entry values come from scalar command-line arguments",
      ),
    };
  }
  if (signature.returnType !== "i32" && signature.returnType !== "bool") {
    const list = isListTypeName(signature.returnType);
    const variant = variants.has(signature.returnType);
    const kind = signature.returnType === "string" ? "string" : list ? "list" : variant ? "variant" : "record";
    return {
      diagnostic: error(
        signature.returnType === "string"
          ? "E_STRING_ENTRY_RETURN_UNSUPPORTED"
          : list
            ? "E_LIST_ENTRY_RETURN_UNSUPPORTED"
            : variant
              ? "E_VARIANT_ENTRY_RETURN_UNSUPPORTED"
              : "E_RECORD_ENTRY_RETURN_UNSUPPORTED",
        `entry function "${signature.name}" cannot return ${kind} "${signature.returnType}"`,
        undefined,
        "entry outcomes are scalar",
      ),
    };
  }
  return undefined;
}
