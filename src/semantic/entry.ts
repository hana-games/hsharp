import type { Diagnostic } from "../contracts/diagnostics";
import { error } from "../contracts/diagnostics";
import { flattenEntryParams } from "../contracts/entry";
import type { TypedProgram } from "../contracts/outcome";
import { isBuiltinOptionResultTypeName, isListTypeName, isOptionTypeName } from "../contracts/tokens";

export function chooseEntry(typed: TypedProgram, requested?: string): { entry?: string; diagnostic?: Diagnostic } {
  const variantNames = new Set(typed.ast.variants.map((variant) => variant.name));
  const recordNames = new Set(typed.ast.records.map((record) => record.name));
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
    return checkedEntry(typed, found, variantNames, recordNames) ?? { entry: requested };
  }
  const main = typed.functions.find((fn) => fn.name === "main");
  if (main) return checkedEntry(typed, main, variantNames, recordNames) ?? { entry: "main" };
  if (typed.functions.length === 1) {
    const only = typed.functions[0];
    return checkedEntry(typed, only, variantNames, recordNames) ?? { entry: only.name };
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

function checkedEntry(
  typed: TypedProgram,
  signature: TypedProgram["functions"][number],
  variants: Set<string>,
  records: Set<string>,
): { diagnostic?: Diagnostic } | undefined {
  const recordsByName = new Map(typed.ast.records.map((record) => [record.name, record]));
  const layout = flattenEntryParams(signature.params, (type) =>
    recordsByName.get(type)?.fields.map((field) => ({ name: field.name, type: field.type.name })),
  );
  for (const param of layout) {
    if (param.unsupportedLeaf) {
      if (records.has(param.type)) {
        return {
          diagnostic: error(
            "E_RECORD_ENTRY_PARAMETER_UNSUPPORTED",
            `entry function "${signature.name}" cannot take record parameter "${param.name}" with non-scalar field "${param.unsupportedLeaf.fieldPath}" of type ${param.unsupportedLeaf.type}`,
            undefined,
            "entry record parameters may contain only i32 and bool leaves; string, list, variant, Option, Result, and unknown leaf types are not allowed",
          ),
        };
      }
      const kind = boundaryKind(param.type, variants);
      return {
        diagnostic: error(
          entryBoundaryCode(kind, "PARAMETER"),
          `entry function "${signature.name}" cannot take ${kind} parameter "${param.name}"`,
          undefined,
          "entry values come from scalar command-line arguments",
        ),
      };
    }
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
