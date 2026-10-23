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

export interface HsValue {
  type: TypeName;
  value: ScalarValue | RecordValue;
}

export function isRecordValue(value: HsValue["value"]): value is RecordValue {
  return typeof value === "object" && value !== null && value.kind === "record";
}

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
