export type TargetId = "csharp" | "rust" | "go" | "java" | "cpp" | "javascript";

export type ProfileId = "standard" | "my-syntax" | "terse" | "casual";

export interface ProfileKeywords {
  fn: string;
  let: string;
  if: string;
  else: string;
  return: string;
  true: string;
  false: string;
}

export interface ProfileSource {
  id: string;
  label: string;
  code: string;
  keywords: ProfileKeywords;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface TargetOutput {
  target: TargetId;
  label: string;
  files: GeneratedFile[];
}

export interface Outcome {
  status: "ok" | "error";
  type?: "i32" | "bool";
  value?: number | boolean;
  code?: string;
  node?: number;
}

export interface DemoData {
  sources: Record<string, ProfileSource>;
  targets: Record<TargetId, TargetOutput>;
  outcome: Outcome;
  ast: unknown;
}

export interface ExampleProfile {
  id: string;
  label: string;
  code: string;
  diagnostics: number;
}

export interface Example {
  id: string;
  program: string;
  source: string;
  profiles: Record<string, ExampleProfile>;
  entry?: string;
  args: (number | boolean)[];
  expected: Outcome;
  notes: string;
  feature: string;
}

export interface ConformanceTargetRow {
  target: TargetId;
  profile: string;
  status: string;
  outcome?: Outcome;
  detail?: string;
}

export interface ConformanceCase {
  id: string;
  notes: string;
  reference: {
    status: string;
    expected: Outcome;
    outcome?: Outcome;
  };
  profiles: { id: string; structure: boolean; roundTrip: boolean }[];
  targets: Record<TargetId, string>;
}

export interface ConformanceData {
  generatedAt: string;
  summary: {
    cases: number;
    targets: number;
    passed: number;
    failed: number;
    blocked: number;
  };
  mode: string;
  toolchains: {
    target: TargetId;
    name: string;
    version: string;
    available: boolean;
  }[];
  cases: ConformanceCase[];
  negative: { id: string; status: string; expectedDiagnostic: string }[];
}

export interface DemoMeta {
  compilerVersion: string;
  coreVersion: string;
  generatedAt: string;
  stats: {
    cases: number;
    negatives: number;
    profiles: number;
    targets: number;
    executions: number;
  };
}

export interface SiteData {
  meta: DemoMeta;
  demo: DemoData;
  examples: Example[];
  conformance: ConformanceData;
}
