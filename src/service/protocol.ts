import type { Diagnostic } from "../contracts/diagnostics";
import type { TargetId } from "../contracts/interfaces";

export interface AnalyzeRequest {
  id: number | string;
  command: "analyze";
  /** Full document text. Editors send the current snapshot on every change. */
  text: string;
  /** Absolute or display path used in diagnostics. */
  file?: string;
  /** Optional profile file. Omit for the standard profile. */
  profilePath?: string;
  /** Optional entry function. Inferred when omitted. */
  entry?: string;
  /** Targets to generate in the same request. Omit for diagnostics only. */
  targets?: TargetId[];
}

export interface PingRequest {
  id: number | string;
  command: "ping";
}

export interface ShutdownRequest {
  id: number | string;
  command: "shutdown";
}

export type BridgeRequest = AnalyzeRequest | PingRequest | ShutdownRequest;

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GeneratedTarget {
  target: TargetId;
  files: GeneratedFile[];
}

export interface AnalyzeTimings {
  parseMs: number;
  checkMs: number;
  entryMs: number;
  emitMs: number;
  totalMs: number;
}

export interface AnalyzeResponse {
  id: number | string;
  ok: boolean;
  command: "analyze";
  compilerVersion: string;
  coreVersion: string;
  diagnostics: Diagnostic[];
  functions: string[];
  entry?: string;
  entryError?: string;
  timings: AnalyzeTimings;
  generated?: GeneratedTarget[];
}

export interface PingResponse {
  id: number | string;
  ok: boolean;
  command: "ping";
  compilerVersion: string;
  coreVersion: string;
  node: string;
}

export interface ShutdownResponse {
  id: number | string;
  ok: boolean;
  command: "shutdown";
  compilerVersion: string;
  coreVersion: string;
  node: string;
}

export interface ErrorResponse {
  id: number | string | null;
  ok: false;
  command: string;
  error: string;
}

export type BridgeResponse = AnalyzeResponse | PingResponse | ShutdownResponse | ErrorResponse;
