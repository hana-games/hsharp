import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const site = resolve(here, "..");

const { analyze } = require(resolve(root, "dist", "pipeline.js"));
const { STANDARD_PROFILE, loadProfileFile } = require(resolve(root, "dist", "frontend", "profile.js"));
const { convert } = require(resolve(root, "dist", "frontend", "convert.js"));
const { emit } = require(resolve(root, "dist", "backends", "index.js"));
const { normalizeAst } = require(resolve(root, "dist", "contracts", "ast.js"));
const { COMPILER_VERSION, CORE_VERSION } = require(resolve(root, "dist", "contracts", "version.js"));

const targets = ["csharp", "rust", "go", "java", "cpp", "javascript"];
const profileIds = ["standard", "my-syntax", "terse", "casual"];

function loadProfile(id) {
  if (id === "standard") return STANDARD_PROFILE;
  const loaded = loadProfileFile(resolve(root, "profiles", `${id}.json`));
  if (!loaded.loaded) throw new Error(`profile ${id} failed to load`);
  return loaded.loaded.profile;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const demoPath = resolve(root, "examples", "calculate.hs");
const demoSources = {};
const demoTokens = {};
for (const id of profileIds) {
  const profile = loadProfile(id);
  const source = readFileSync(demoPath, "utf8");
  const standard = analyze(source, "calculate.hs", STANDARD_PROFILE);
  if (!standard.program || !standard.tokens || !standard.typed) throw new Error("demo did not compile");
  const converted = convert(standard.tokens, STANDARD_PROFILE, profile);
  if (converted.diagnostics.length > 0) throw new Error(`demo conversion to ${id} failed`);
  const checked = analyze(converted.text, "calculate.hs", profile);
  if (!checked.typed) throw new Error(`demo under ${id} failed to check`);
  demoSources[id] = {
    id,
    label: profileIdLabel(id),
    code: converted.text,
    keywords: profile.keywords,
  };
  if (id === "standard") demoTokens.standard = standard;
}

if (!demoTokens.standard) throw new Error("standard demo unavailable");

const generatedTargets = {};
for (const target of targets) {
  const project = emit(demoTokens.standard.typed, target, "calculate");
  generatedTargets[target] = {
    target,
    label: targetLabel(target),
    files: project.files.map((file) => ({ path: file.path, content: file.content })),
  };
}

const demoOutcome = {
  status: "ok",
  type: "i32",
  value: 32,
};

const ast = normalizeAst(demoTokens.standard.program);

const casesManifestPath = resolve(root, "tests", "conformance", "cases.json");
const casesManifest = readJson(casesManifestPath);
const casesDir = dirname(casesManifestPath);
const profilesForCases = ["standard", "my-syntax"];
const programs = new Map();

const examples = casesManifest.cases.map((testCase) => {
  const programPath = resolve(casesDir, testCase.program);
  let entry = programs.get(programPath);
  if (!entry) {
    const source = readFileSync(programPath, "utf8");
    const standard = analyze(source, testCase.program, STANDARD_PROFILE);
    if (!standard.typed || !standard.program || !standard.tokens) {
      throw new Error(`example ${testCase.id} did not compile`);
    }
    const variants = {};
    for (const id of profilesForCases) {
      const profile = loadProfile(id);
      const converted = convert(standard.tokens, STANDARD_PROFILE, profile);
      const checked = analyze(converted.text, testCase.program, profile);
      if (!checked.typed || converted.diagnostics.length > 0) {
        throw new Error(`example ${testCase.id} failed under ${id}`);
      }
      variants[id] = {
        id,
        label: profileIdLabel(id),
        code: converted.text,
        diagnostics: checked.diagnostics.length,
      };
    }
    entry = {
      program: testCase.program,
      source,
      profiles: variants,
    };
    programs.set(programPath, entry);
  }

  return {
    id: testCase.id,
    program: entry.program,
    source: entry.source,
    profiles: entry.profiles,
    entry: testCase.entry ?? inferEntry(entry.source),
    args: testCase.args ?? [],
    expected: testCase.expected,
    notes: testCase.notes ?? "",
    feature: featureOf(testCase.id),
  };
});

const conformance = readJson(resolve(root, "reports", "conformance.json"));
const compactConformance = {
  generatedAt: conformance.generatedAt,
  summary: conformance.summary,
  mode: conformance.mode,
  toolchains: conformance.toolchains.map((tool) => ({
    target: tool.target,
    name: tool.name,
    version: tool.version,
    available: tool.available,
  })),
  cases: conformance.cases.map((testCase) => ({
    id: testCase.id,
    notes: testCase.notes ?? "",
    reference: {
      status: testCase.reference.status,
      expected: testCase.reference.expected,
      outcome: testCase.reference.outcome,
    },
    profiles: testCase.profiles.map((profile) => ({
      id: profile.id,
      structure: profile.structure,
      roundTrip: profile.roundTrip,
    })),
    targets: Object.fromEntries(
      targets.map((target) => {
        const rows = testCase.targets.filter((row) => row.target === target);
        const status =
          rows.length === 0
            ? "missing"
            : rows.every((row) => row.status === "passed")
              ? "passed"
              : rows.some((row) => row.status === "failed")
                ? "failed"
                : "blocked";
        return [target, status];
      }),
    ),
  })),
  negative: conformance.negative.map((item) => ({
    id: item.id,
    status: item.status,
    expectedDiagnostic: item.expectedDiagnostic,
  })),
};

const data = {
  meta: {
    compilerVersion: COMPILER_VERSION,
    coreVersion: CORE_VERSION,
    generatedAt: new Date().toISOString(),
    stats: {
      cases: casesManifest.cases.length,
      negatives: casesManifest.negative.length,
      profiles: profileIds.length,
      targets: targets.length,
      executions: conformance.summary.targets,
    },
  },
  demo: {
    sources: demoSources,
    targets: generatedTargets,
    outcome: demoOutcome,
    ast,
  },
  examples,
  conformance: compactConformance,
};

const outPath = resolve(site, "src", "data", "generated.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(
  `site data: ${examples.length} examples, ${targets.length} targets, ${data.meta.stats.executions} conformance executions`,
);

function targetLabel(target) {
  return { csharp: "C#", rust: "Rust", go: "Go", java: "Java", cpp: "C++", javascript: "JavaScript" }[target];
}

function profileIdLabel(id) {
  return { standard: "Standard", "my-syntax": "my-syntax", terse: "terse", casual: "casual" }[id];
}

function inferEntry(source) {
  if (/\bfn\s+main\b/.test(source)) return "main";
  return undefined;
}

function featureOf(id) {
  if (id.startsWith("demo")) return "Showcase";
  if (id.includes("overflow") || id.includes("boundary") || id.includes("negate") || id.includes("multiply")) {
    return "Checked arithmetic";
  }
  if (id.includes("short-circuit")) return "Short-circuit";
  if (id.includes("comparison") || id.includes("bool") || id.includes("if-else")) return "Control flow";
  if (id.includes("function") || id.includes("call")) return "Functions";
  if (id.includes("target") || id.includes("reserved")) return "Portable names";
  if (id.includes("comment")) return "Profiles";
  if (id.includes("precedence") || id.includes("parentheses") || id.includes("associativity") || id.includes("subtraction")) {
    return "Expressions";
  }
  return "Core";
}
