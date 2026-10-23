import type { Diagnostic } from "../contracts/diagnostics";
import { error } from "../contracts/diagnostics";
import type { TypedProgram } from "../contracts/outcome";
import { isPrimitiveTypeName } from "../contracts/tokens";

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
  const recordParam = signature.params.find((param) => !isPrimitiveTypeName(param.type));
  if (!recordParam) return undefined;
  return {
    diagnostic: error(
      "E_RECORD_ENTRY_PARAMETER_UNSUPPORTED",
      `entry function "${signature.name}" cannot take record parameter "${recordParam.name}"`,
      undefined,
      "entry values come from scalar command-line arguments",
    ),
  };
}
