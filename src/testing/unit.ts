import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { normalizeAst } from "../contracts/ast";
import { evaluate } from "../reference/interpreter";
import { analyze } from "../pipeline";
import { loadProfileFile, STANDARD_PROFILE } from "../frontend/profile";
import { exportSyntax, importSyntax } from "../syntax/transfer";
import { generateCase, reduceSource } from "./property";

let failures = 0;
let count = 0;

function test(name: string, body: () => void): void {
  count++;
  try {
    body();
    console.log(`ok   ${name}`);
  } catch (cause) {
    failures++;
    console.error(`FAIL ${name}`);
    console.error((cause as Error).stack ?? (cause as Error).message);
  }
}

function tempDir(): string {
  const root = resolve("local");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "unit-"));
}

function resultOf(source: string, entry = "main", args: (number | boolean)[] = []) {
  const loaded = analyze(source, "<unit>", STANDARD_PROFILE);
  assert.ok(loaded.typed, `expected a valid program: ${loaded.diagnostics.map((d) => d.message).join("; ")}`);
  return evaluate(loaded.typed!, entry, { values: args });
}

const profiles = ["standard", "my-syntax", "terse", "casual"].map((id) => {
  const loaded = loadProfileFile(resolve("profiles", `${id}.json`));
  assert.ok(loaded.loaded, `profile ${id} should be valid`);
  return loaded.loaded!.profile;
});

test("standard profile matches canonical keywords", () => {
  assert.deepEqual(profiles[0].keywords, STANDARD_PROFILE.keywords);
});

test("profile conversion preserves normalized AST for every profile", () => {
  const source = readFileSync(resolve("examples", "calculate.hs"), "utf8");
  const canonical = analyze(source, "<canonical>", STANDARD_PROFILE);
  assert.ok(canonical.program && canonical.tokens);
  for (const profile of profiles) {
    const { convert } = require("../frontend/convert") as typeof import("../frontend/convert");
    const converted = convert(canonical.tokens!, STANDARD_PROFILE, profile);
    assert.deepEqual(converted.diagnostics, [], `conversion to ${profile.id}`);
    const parsed = analyze(converted.text, `<${profile.id}>`, profile);
    assert.ok(parsed.program, `parse under ${profile.id}: ${parsed.diagnostics.map((d) => d.message).join("; ")}`);
    assert.deepEqual(
      normalizeAst(parsed.program!),
      normalizeAst(canonical.program!),
      `normalized AST under ${profile.id}`,
    );
  }
});

test("token conversion changes keywords only", () => {
  const source = `// return let if else fn true false
fn return_value(x: i32) -> i32 {
    // returns and returning are identifiers, not keywords
    let result: i32 = x + 1;
    return result;
}
`;
  const canonical = analyze(source, "<canonical>", STANDARD_PROFILE);
  assert.ok(canonical.tokens);
  const mySyntax = profiles.find((profile) => profile.id === "my-syntax")!;
  const { convert } = require("../frontend/convert") as typeof import("../frontend/convert");
  const converted = convert(canonical.tokens!, STANDARD_PROFILE, mySyntax);
  assert.deepEqual(converted.diagnostics, []);
  assert.match(converted.text, /^\/\/ return let if else fn true false/m);
  assert.match(converted.text, /function return_value/);
  assert.match(converted.text, /value result/);
  assert.match(converted.text, /give result;/);
  assert.match(converted.text, /\/\/ returns and returning are identifiers/);
});

test("profile validation rejects bad profiles with specific codes", () => {
  const expectations: [string, string][] = [
    ["bad-duplicate.json", "E_PROFILE_DUPLICATE_KEYWORD"],
    ["bad-option.json", "E_PROFILE_UNKNOWN_OPTION"],
    ["bad-reassigned.json", "E_PROFILE_RESERVED_KEYWORD"],
    ["bad-missing.json", "E_PROFILE_MISSING_ROLE"],
    ["bad-core.json", "E_PROFILE_CORE_VERSION"],
    ["bad-form.json", "E_PROFILE_KEYWORD_FORM"],
    ["bad-type-collision.json", "E_PROFILE_RESERVED_KEYWORD"],
  ];
  for (const [file, code] of expectations) {
    const loaded = loadProfileFile(resolve("tests", "negative", "profiles", file));
    assert.equal(loaded.loaded, undefined, `${file} must be rejected`);
    assert.ok(
      loaded.diagnostics.some((diagnostic) => diagnostic.code === code),
      `${file} should report ${code}, got ${loaded.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }
});

test("arithmetic precedence evaluates to 14", () => {
  assert.deepEqual(resultOf("fn main() -> i32 {\n    return 2 + 3 * 4;\n}\n"), {
    status: "ok",
    type: "i32",
    value: 14,
  });
});

test("checked arithmetic and boundaries", () => {
  assert.deepEqual(resultOf("fn main() -> i32 { return 2147483647; }"), {
    status: "ok",
    type: "i32",
    value: 2147483647,
  });
  const addOverflow = resultOf("fn main(x: i32) -> i32 { return x + 1; }", "main", [2147483647]);
  assert.equal(addOverflow.status, "error");
  assert.equal(addOverflow.status === "error" ? addOverflow.code : "", "E_OVERFLOW");
  const negOverflow = resultOf("fn main(x: i32) -> i32 { return -x; }", "main", [-2147483648]);
  assert.equal(negOverflow.status, "error");
  assert.equal(negOverflow.status === "error" ? negOverflow.code : "", "E_OVERFLOW");
  assert.deepEqual(resultOf("fn main() -> i32 { return -2147483648; }"), {
    status: "ok",
    type: "i32",
    value: -2147483648,
  });
});

test("short-circuit avoids evaluating a failing right operand", () => {
  assert.deepEqual(
    resultOf("fn main(x: i32) -> bool { return false && ((x + 1) > 0); }", "main", [2147483647]),
    { status: "ok", type: "bool", value: false },
  );
  assert.deepEqual(
    resultOf("fn main(x: i32) -> bool { return true || ((x + 1) > 0); }", "main", [2147483647]),
    { status: "ok", type: "bool", value: true },
  );
});

test("export and reimport preserve comments and apply edits", () => {
  const dir = tempDir();
  const canonical = join(dir, "canonical.hs");
  const personal = join(dir, "personal.hs");
  copyFileSync(resolve("examples", "calculate.hs"), canonical);

  const exported = exportSyntax({
    sourceFile: canonical,
    profileFile: resolve("profiles", "my-syntax.json"),
    outputFile: personal,
  });
  assert.equal(exported.diagnostics.length, 0);
  assert.ok(exported.manifest);
  const personalText = readFileSync(personal, "utf8");
  assert.match(personalText, /function calculate/);
  assert.match(personalText, /value base: i32/);
  assert.match(personalText, /when bonus/);
  assert.match(personalText, /\/\/ The word "return" inside this comment/);

  const untouched = importSyntax({ personalFile: personal, dryRun: true });
  assert.equal(untouched.diagnostics.length, 0);
  assert.equal(untouched.nextText, readFileSync(canonical, "utf8"));

  writeFileSync(personal, personalText.replace("give base + 2;", "give base + 9;"), "utf8");
  const imported = importSyntax({ personalFile: personal });
  assert.equal(imported.diagnostics.length, 0);
  assert.match(readFileSync(canonical, "utf8"), /return base \+ 9;/);
  assert.match(readFileSync(canonical, "utf8"), /\/\/ The word "return" inside this comment/);
});

test("reimport rejects a stale canonical base", () => {
  const dir = tempDir();
  const canonical = join(dir, "canonical.hs");
  const personal = join(dir, "personal.hs");
  copyFileSync(resolve("examples", "calculate.hs"), canonical);
  const exported = exportSyntax({
    sourceFile: canonical,
    profileFile: resolve("profiles", "my-syntax.json"),
    outputFile: personal,
  });
  assert.equal(exported.diagnostics.length, 0);

  writeFileSync(canonical, `${readFileSync(canonical, "utf8")}\n// concurrent edit\n`, "utf8");
  const imported = importSyntax({ personalFile: personal });
  assert.ok(imported.diagnostics.some((diagnostic) => diagnostic.code === "E_IMPORT_STALE_BASE"));
});

test("reimport rejects a changed profile", () => {
  const dir = tempDir();
  const canonical = join(dir, "canonical.hs");
  const personal = join(dir, "personal.hs");
  const profile = join(dir, "profile.json");
  copyFileSync(resolve("examples", "calculate.hs"), canonical);
  copyFileSync(resolve("profiles", "my-syntax.json"), profile);
  const exported = exportSyntax({ sourceFile: canonical, profileFile: profile, outputFile: personal });
  assert.equal(exported.diagnostics.length, 0);

  writeFileSync(profile, `${readFileSync(profile, "utf8")}\n`, "utf8");
  const imported = importSyntax({ personalFile: personal });
  assert.ok(imported.diagnostics.some((diagnostic) => diagnostic.code === "E_IMPORT_PROFILE_CHANGED"));
});

test("a successful import refreshes the manifest for the next cycle", () => {
  const dir = tempDir();
  const canonical = join(dir, "canonical.hs");
  const personal = join(dir, "personal.hs");
  copyFileSync(resolve("examples", "calculate.hs"), canonical);
  const exported = exportSyntax({
    sourceFile: canonical,
    profileFile: resolve("profiles", "my-syntax.json"),
    outputFile: personal,
  });
  assert.equal(exported.diagnostics.length, 0);

  writeFileSync(personal, readFileSync(personal, "utf8").replace("give base + 2;", "give base + 4;"), "utf8");
  const first = importSyntax({ personalFile: personal });
  assert.equal(first.diagnostics.length, 0);
  assert.equal(first.applied, true);

  const second = importSyntax({ personalFile: personal, dryRun: true });
  assert.deepEqual(second.diagnostics, []);
  assert.equal(second.nextText, readFileSync(canonical, "utf8"));

  writeFileSync(personal, readFileSync(personal, "utf8").replace("give base + 4;", "give base + 5;"), "utf8");
  const third = importSyntax({ personalFile: personal });
  assert.deepEqual(third.diagnostics, []);
  assert.match(readFileSync(canonical, "utf8"), /return base \+ 5;/);
});

test("a malformed manifest produces a diagnostic instead of throwing", () => {
  const dir = tempDir();
  const personal = join(dir, "personal.hs");
  writeFileSync(personal, "fn main() -> i32 { return 1; }\n", "utf8");
  writeFileSync(`${personal}.manifest.json`, JSON.stringify({ schema: "hs-export/1" }), "utf8");
  const imported = importSyntax({ personalFile: personal });
  assert.ok(imported.diagnostics.some((diagnostic) => diagnostic.code === "E_IMPORT_MANIFEST"));
});

test("export refuses to overwrite the canonical source", () => {
  const dir = tempDir();
  const canonical = join(dir, "canonical.hs");
  copyFileSync(resolve("examples", "calculate.hs"), canonical);
  const before = readFileSync(canonical, "utf8");
  const exported = exportSyntax({
    sourceFile: canonical,
    profileFile: resolve("profiles", "my-syntax.json"),
    outputFile: canonical,
  });
  assert.ok(exported.diagnostics.some((diagnostic) => diagnostic.code === "E_EXPORT_PATH"));
  assert.equal(readFileSync(canonical, "utf8"), before);
});

test("interpreter rejects non-i32 harness arguments", () => {
  const loaded = analyze("fn main(x: i32) -> i32 { return x; }", "<unit>", STANDARD_PROFILE);
  assert.ok(loaded.typed);
  for (const value of [2147483648, -2147483649, 1.5, Number.NaN]) {
    assert.throws(
      () => evaluate(loaded.typed!, "main", { values: [value] }),
      /Boolean or an integer in the i32 range/,
    );
  }
});

test("BOM-prefixed source is accepted", () => {
  const loaded = analyze("\uFEFFfn main() -> i32 { return 1; }\n", "<bom>", STANDARD_PROFILE);
  assert.ok(loaded.typed, loaded.diagnostics.map((d) => d.message).join("; "));
});

test("leading zeros and grouped comparisons follow the core rules", () => {
  assert.deepEqual(resultOf("fn main() -> i32 { return -02147483648; }"), {
    status: "ok",
    type: "i32",
    value: -2147483648,
  });
  assert.deepEqual(resultOf("fn main() -> bool { return (1 < 2) == (3 < 4); }"), {
    status: "ok",
    type: "bool",
    value: true,
  });
  const chained = analyze("fn main() -> bool { return 1 < 2 == 3; }", "<unit>", STANDARD_PROFILE);
  assert.ok(chained.diagnostics.some((diagnostic) => diagnostic.code === "E_CHAINED_COMPARISON"));
});

test("export rejects an identifier that collides with a profile keyword", () => {
  const dir = tempDir();
  const canonical = join(dir, "collision.hs");
  const personal = join(dir, "collision.personal.hs");
  writeFileSync(canonical, "fn function(x: i32) -> i32 { return x; }\n", "utf8");
  const exported = exportSyntax({
    sourceFile: canonical,
    profileFile: resolve("profiles", "my-syntax.json"),
    outputFile: personal,
  });
  assert.ok(exported.diagnostics.some((diagnostic) => diagnostic.code === "E_PROFILE_IDENTIFIER_COLLISION"));
});

test("profile alias is reserved even when it is a canonical word", () => {
  const mySyntax = profiles.find((profile) => profile.id === "my-syntax")!;
  const loaded = analyze(
    "function bad(x: i32) -> i32 { value y: i32 = x; give return; }\n",
    "<personal>",
    mySyntax,
  );
  assert.ok(!loaded.typed);
  assert.ok(loaded.diagnostics.some((diagnostic) => diagnostic.code === "E_RESERVED_WORD"));
});

test("generated target names are deterministic and avoid source names", () => {
  const { emit } = require("../backends") as typeof import("../backends");
  const loaded = analyze(
    "fn int(class: i32) -> i32 { let string: i32 = class + 1; return string; }\n",
    "<unit>",
    STANDARD_PROFILE,
  );
  assert.ok(loaded.typed);
  for (const target of ["csharp", "rust", "go", "java"] as const) {
    const project = emit(loaded.typed!, target, "int");
    const text = project.files.map((file) => file.content).join("\n");
    assert.match(text, /f1/, `${target} should use a generated function name`);
    assert.match(text, /v1/, `${target} should use a generated local name`);
  }
});

test("records evaluate through literals, field access, equality, and internal calls", () => {
  const source = `record Point {
    x: i32,
    y: i32,
}

fn add(a: Point, b: Point) -> i32 {
    return a.x + b.x + a.y + b.y;
}

fn main() -> bool {
    let first: Point = Point { x: 1, y: 2 };
    let second: Point = Point { y: 4, x: 3 };
    let mirrored: Point = Point { y: 2, x: 1 };
    return first == mirrored && first != second && add(first, second) == 10;
}
`;
  assert.deepEqual(resultOf(source), { status: "ok", type: "bool", value: true });
});

test("record fields are compared field-wise and field order is not observable", () => {
  const source = `record Pair {
    left: bool,
    right: i32,
}

fn main() -> bool {
    let a: Pair = Pair { right: 7, left: true };
    let b: Pair = Pair { left: true, right: 7 };
    let c: Pair = Pair { left: false, right: 7 };
    return a == b && a != c && a.left && a.right == 7;
}
`;
  assert.deepEqual(resultOf(source), { status: "ok", type: "bool", value: true });
});

test("record-returning functions and record entry parameters are rejected", () => {
  const returned = analyze(
    "record Point { x: i32 }\nfn make() -> Point { return Point { x: 1 }; }\nfn main() -> i32 { return 0; }\n",
    "<unit>",
    STANDARD_PROFILE,
  );
  assert.ok(returned.diagnostics.some((d) => d.code === "E_RECORD_RETURN_UNSUPPORTED"));

  const entry = analyze(
    "record Point { x: i32 }\nfn main(p: Point) -> i32 { return p.x; }\n",
    "<unit>",
    STANDARD_PROFILE,
  );
  assert.ok(entry.diagnostics.some((d) => d.code === "E_RECORD_ENTRY_PARAMETER_UNSUPPORTED"));
});

test("record diagnostics cover unknown records, fields, and missing fields", () => {
  const unknownRecord = analyze(
    "fn main() -> i32 { return Nope { x: 1 }.x; }",
    "<unit>",
    STANDARD_PROFILE,
  );
  assert.ok(unknownRecord.diagnostics.some((d) => d.code === "E_UNKNOWN_RECORD"));

  const unknownField = analyze(
    "record Point { x: i32 }\nfn main() -> i32 { let p: Point = Point { x: 1 }; return p.y; }",
    "<unit>",
    STANDARD_PROFILE,
  );
  assert.ok(unknownField.diagnostics.some((d) => d.code === "E_UNKNOWN_FIELD"));

  const missing = analyze(
    "record Point { x: i32, y: i32 }\nfn main() -> i32 { return Point { x: 1 }.x; }",
    "<unit>",
    STANDARD_PROFILE,
  );
  assert.ok(missing.diagnostics.some((d) => d.code === "E_MISSING_FIELD"));

  const update = analyze(
    "record Point { x: i32, y: i32 }\nfn main() -> i32 { let p: Point = Point { x: 1, y: 2 }; let q: Point = Point { ...p, x: 3 }; return q.x; }\n",
    "<unit>",
    STANDARD_PROFILE,
  );
  assert.ok(update.diagnostics.some((d) => d.code === "E_RECORD_UPDATE_UNSUPPORTED"));
});

test("record target names and field names avoid source keyword collisions", () => {
  const source = `record Class {
    class: i32,
    struct: i32,
    type: bool,
}

fn main() -> bool {
    let string: Class = Class { type: true, class: 3, struct: 4 };
    let other: Class = Class { struct: 4, class: 3, type: true };
    return string == other && string.class + string.struct == 7 && string.type;
}
`;
  const loaded = analyze(source, "<unit>", STANDARD_PROFILE);
  assert.ok(loaded.typed, loaded.diagnostics.map((d) => d.message).join("; "));
  assert.deepEqual(evaluate(loaded.typed!, "main", { values: [] }), {
    status: "ok",
    type: "bool",
    value: true,
  });
  const { emit } = require("../backends") as typeof import("../backends");
  for (const target of ["csharp", "rust", "go", "java"] as const) {
    const project = emit(loaded.typed!, target, "main");
    const text = project.files.map((file) => file.content).join("\n");
    assert.match(text, /R1/, `${target} should use a generated record name`);
    assert.match(text, /f1/, `${target} should use generated field names`);
    assert.ok(!/\bClass\b/.test(text), `${target} must not emit the source record name`);
  }
});

test("seeded property generator is deterministic and valid", () => {
  for (let seed = 1; seed <= 8; seed++) {
    const first = generateCase(seed, 2);
    const second = generateCase(seed, 2);
    assert.equal(first.source, second.source, `seed ${seed} should be deterministic`);
    const loaded = analyze(first.source, `<property:${seed}>`, STANDARD_PROFILE);
    assert.ok(
      loaded.typed,
      `seed ${seed} should generate a valid program: ${loaded.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
    );
    assert.ok(loaded.typed!.functions.some((fn) => fn.name === "main"), `seed ${seed} should declare main`);
  }
});

test("property reducer deletes lines while the failure remains reproducible", () => {
  const source = `fn main() -> i32 {
    let a: i32 = 1;
    let b: i32 = 2;
    return a + b;
}
`;
  const reduced = reduceSource(source, (candidate) => candidate.includes("let b"), 12);
  assert.ok(reduced.source.length < source.length);
  assert.ok(reduced.source.includes("let b"));
});

test("personal-profile diagnostics preserve source line and column", () => {
  const mySyntax = profiles.find((profile) => profile.id === "my-syntax")!;
  const loaded = analyze(
    `function main() -> i32 {
    give absent;
}
`,
    "<personal>",
    mySyntax,
  );
  const diagnostic = loaded.diagnostics.find((item) => item.code === "E_UNKNOWN_NAME");
  assert.ok(diagnostic?.span, "expected a located unknown-name diagnostic");
  assert.equal(diagnostic.span.start.line, 2);
  assert.equal(diagnostic.span.start.column, 10);
});

console.log(`\n${count - failures}/${count} unit tests passed`);
if (failures > 0) process.exitCode = 1;
