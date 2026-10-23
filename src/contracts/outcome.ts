import type { Program } from "./ast";
import type { TypeName } from "./tokens";

export interface FunctionSignature {
  symbolId: string;
  targetName: string;
  name: string;
  params: { name: string; type: TypeName }[];
  returnType: TypeName;
}

/** The checker annotates the source AST in place; this view exposes the checked facts. */
export interface TypedProgram {
  ast: Program;
  functions: FunctionSignature[];
  entryCandidates: FunctionSignature[];
}

export type ScalarValue = number | boolean | string;

export interface RecordValue {
  kind: "record";
  recordName: string;
  /** Values in declaration field order. */
  fields: HsValue[];
}

export interface ListValue {
  kind: "list";
  elementType: TypeName;
  /** Values in source order. */
  elements: HsValue[];
}

export interface VariantValue {
  kind: "variant";
  variantName: string;
  alternativeName: string;
  /** Declaration-order index of the alternative. */
  tag: number;
  /** Positional payload values in declaration order. */
  payload: HsValue[];
}

export interface HsValue {
  type: TypeName;
  value: ScalarValue | RecordValue | ListValue | VariantValue;
}

export function isRecordValue(value: HsValue["value"]): value is RecordValue {
  return typeof value === "object" && value !== null && value.kind === "record";
}

export function isListValue(value: HsValue["value"]): value is ListValue {
  return typeof value === "object" && value !== null && value.kind === "list";
}

export function isVariantValue(value: HsValue["value"]): value is VariantValue {
  return typeof value === "object" && value !== null && value.kind === "variant";
}

export const INDEX_CODE = "E_INDEX";
/** Numeric failure code used by generated targets for E_INDEX. */
export const INDEX_FAILURE_CODE = 4;

/** Entry functions remain scalar: record values never cross the process boundary. */
export type Outcome =
  | { status: "ok"; type: TypeName; value: ScalarValue }
  | { status: "error"; code: string; node?: number };

export interface RuntimeArguments {
  values: (number | boolean)[];
}

export const OVERFLOW_CODE = "E_OVERFLOW";

export function outcomeToJson(outcome: Outcome): string {
  return JSON.stringify(outcome);
}
