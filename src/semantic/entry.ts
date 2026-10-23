import type { Diagnostic } from "../contracts/diagnostics";
import { error } from "../contracts/diagnostics";
import type { TypedProgram } from "../contracts/outcome";

export function chooseEntry(typed: TypedProgram, requested?: string): { entry?: string; diagnostic?: Diagnostic } {
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
    return scalarEntry(found) ?? { entry: requested };
  }
  const main = typed.functions.find((fn) => fn.name === "main");
  if (main) return scalarEntry(main) ?? { entry: "main" };
  if (typed.functions.length === 1) {
    const only = typed.functions[0];
    return scalarEntry(only) ?? { entry: only.name };
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

function scalarEntry(signature: TypedProgram["functions"][number]): { diagnostic?: Diagnostic } | undefined {
  const nonScalarParam = signature.params.find((param) => param.type !== "i32" && param.type !== "bool");
  if (nonScalarParam) {
    return {
      diagnostic: error(
        nonScalarParam.type === "string" ? "E_STRING_ENTRY_PARAMETER_UNSUPPORTED" : "E_RECORD_ENTRY_PARAMETER_UNSUPPORTED",
        `entry function "${signature.name}" cannot take ${nonScalarParam.type === "string" ? "string" : "record"} parameter "${nonScalarParam.name}"`,
        undefined,
        "entry values come from scalar command-line arguments",
      ),
    };
  }
  if (signature.returnType !== "i32" && signature.returnType !== "bool") {
    return {
      diagnostic: error(
        signature.returnType === "string" ? "E_STRING_ENTRY_RETURN_UNSUPPORTED" : "E_RECORD_ENTRY_RETURN_UNSUPPORTED",
        `entry function "${signature.name}" cannot return ${signature.returnType === "string" ? "string" : "record"} "${signature.returnType}"`,
        undefined,
        "entry outcomes are scalar",
      ),
    };
  }
  return undefined;
}
