import type { TypeName } from "./tokens";

/** One scalar leaf of an entry parameter, in depth-first declaration order. */
export interface EntryLeaf {
  type: TypeName;
  /** Field indices from the parameter root; empty for a scalar parameter. */
  path: number[];
}

/** A checked entry parameter flattened to its scalar leaves. */
export interface EntryParamLayout {
  name: string;
  type: TypeName;
  leaves: EntryLeaf[];
  /** Set when the parameter reaches a non-scalar leaf type. */
  unsupportedLeaf?: {
    /** Dotted field path from the parameter root, or the parameter name itself. */
    fieldPath: string;
    type: TypeName;
  };
}

export interface EntryLeafSource {
  name: string;
  type: TypeName;
}

/**
 * Flattens entry parameters depth-first in declaration field order. A parameter
 * is scalar when its type is i32 or bool; record parameters recursively expand
 * into their fields. Every other type (string, list, variant, Option, Result,
 * or an unknown name) is reported as an unsupported leaf.
 */
export function flattenEntryParams(
  params: readonly EntryLeafSource[],
  fieldsOf: (type: TypeName) => readonly EntryLeafSource[] | undefined,
): EntryParamLayout[] {
  return params.map((param) => {
    const leaves: EntryLeaf[] = [];
    const visiting = new Set<TypeName>();
    const visit = (
      type: TypeName,
      path: number[],
      names: string[],
    ): { fieldPath: string; type: TypeName } | undefined => {
      if (type === "i32" || type === "bool") {
        leaves.push({ type, path: [...path] });
        return undefined;
      }
      const fields = fieldsOf(type);
      if (!fields || visiting.has(type)) {
        return { fieldPath: names.join("."), type };
      }
      visiting.add(type);
      for (let index = 0; index < fields.length; index++) {
        const field = fields[index];
        const unsupported = visit(field.type, [...path, index], [...names, field.name]);
        if (unsupported) {
          visiting.delete(type);
          return unsupported;
        }
      }
      visiting.delete(type);
      return undefined;
    };
    const unsupported = visit(param.type, [], []);
    if (unsupported) {
      return {
        name: param.name,
        type: param.type,
        leaves,
        unsupportedLeaf: {
          fieldPath: unsupported.fieldPath || param.name,
          type: unsupported.type,
        },
      };
    }
    return { name: param.name, type: param.type, leaves };
  });
}

export function entryArity(layout: readonly EntryParamLayout[]): number {
  return layout.reduce((total, param) => total + param.leaves.length, 0);
}
