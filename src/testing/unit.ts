import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { normalizeAst, walkExpr, walkStatements } from "../contracts/ast";
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
    "fn int(class: i32) -> i32 { let func: i32 = class + 1; return func; }\n",
    "<unit>",
    STANDARD_PROFILE,
  );
  assert.ok(loaded.typed);
  for (const target of ["csharp", "rust", "go", "java", "cpp", "javascript"] as const) {
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

test("nested records evaluate and compare structurally", () => {
  const result = resultOf(`record Point {
    x: i32,
    y: i32,
}
record Segment {
    a: Point,
    b: Point,
}
fn main() -> bool {
    let p: Point = Point { x: 1, y: 2 };
    let q: Point = Point { x: 3, y: 4 };
    let s: Segment = Segment { a: p, b: q };
    return s.a == p && s.b.y == 4 && s.a.x + s.b.y == 5;
}
`);
  assert.deepEqual(result, { status: "ok", type: "bool", value: true });
});

test("record update creates a new value without mutating the base", () => {
  const result = resultOf(`record Point {
    x: i32,
    y: i32,
}
fn main() -> bool {
    let p: Point = Point { x: 1, y: 2 };
    let q: Point = Point { ...p, x: 3 };
    let same: Point = Point { ...p };
    return p.x == 1 && q.x == 3 && q.y == 2 && same == p && q != p;
}
`);
  assert.deepEqual(result, { status: "ok", type: "bool", value: true });
});

test("record update rejects a base of the wrong type", () => {
  const loaded = analyze(
    `record Point { x: i32 }
record Other { x: i32 }
fn main() -> i32 {
    let p: Point = Point { x: 1 };
    let o: Other = Other { x: 2 };
    let bad: Point = Point { ...o, x: 3 };
    return 1;
}
`,
    "<update>",
    STANDARD_PROFILE,
  );
  assert.ok(loaded.diagnostics.some((diagnostic) => diagnostic.code === "E_FIELD_TYPE"));
});

test("recursive record types are rejected", () => {
  const loaded = analyze(
    `record Loop {
    next: Loop,
}
fn main() -> i32 { return 1; }
`,
    "<nested>",
    STANDARD_PROFILE,
  );
  assert.ok(loaded.diagnostics.some((diagnostic) => diagnostic.code === "E_RECURSIVE_RECORD"));
});

test("strings support literals, escapes, equality, and internal returns", () => {
  const result = resultOf(`fn choose(flag: bool) -> string {
    if flag {
        return "yes";
    }
    return "no";
}
fn main() -> bool {
    let a: string = "héllo\\nworld";
    let b: string = a;
    return a == b && a != "other" && choose(true) == "yes" && choose(false) == "no";
}
`);
  assert.deepEqual(result, { status: "ok", type: "bool", value: true });
});

test("string entry parameters and string entry returns are rejected", () => {
  const param = analyze(
    "fn main(value: string) -> i32 { return 1; }\n",
    "<strings>",
    STANDARD_PROFILE,
  );
  assert.ok(param.diagnostics.some((d) => d.code === "E_STRING_ENTRY_PARAMETER_UNSUPPORTED"));

  const returned = analyze(
    'fn main() -> string { return "ok"; }\n',
    "<strings>",
    STANDARD_PROFILE,
  );
  assert.ok(returned.diagnostics.some((d) => d.code === "E_STRING_ENTRY_RETURN_UNSUPPORTED"));
});

test("string record fields and invalid escapes are rejected in this slice", () => {
  const field = analyze(
    'record Bad { name: string }\nfn main() -> i32 { return 1; }\n',
    "<strings>",
    STANDARD_PROFILE,
  );
  assert.ok(field.diagnostics.some((d) => d.code === "E_STRING_FIELD_UNSUPPORTED"));

  const escape = analyze(
    'fn main() -> bool { return "\\q" == "q"; }\n',
    "<strings>",
    STANDARD_PROFILE,
  );
  assert.ok(escape.diagnostics.some((d) => d.code === "E_STRING_ESCAPE"));
});

test("internal functions can return records while entry outcomes stay scalar", () => {
  const returned = resultOf(
    "record Point { x: i32 }\nfn make() -> Point { return Point { x: 1 }; }\nfn main() -> bool { let p: Point = make(); return p.x == 1; }\n",
  );
  assert.deepEqual(returned, { status: "ok", type: "bool", value: true });

  const entryReturn = analyze(
    "record Point { x: i32 }\nfn main() -> Point { return Point { x: 1 }; }\n",
    "<unit>",
    STANDARD_PROFILE,
  );
  assert.ok(entryReturn.diagnostics.some((d) => d.code === "E_RECORD_ENTRY_RETURN_UNSUPPORTED"));

  const entryParam = analyze(
    "record Point { x: i32 }\nfn main(p: Point) -> i32 { return p.x; }\n",
    "<unit>",
    STANDARD_PROFILE,
  );
  assert.ok(entryParam.typed, entryParam.diagnostics.map((d) => d.message).join("; "));
  assert.deepEqual(evaluate(entryParam.typed!, "main", { values: [4] }), {
    status: "ok",
    type: "i32",
    value: 4,
  });
});

test("entry record parameters flatten depth-first in declaration order", () => {
  const source = `record Point {
    x: i32,
    y: i32,
}
record Line {
    a: Point,
    b: Point,
}
fn main(p: Point, line: Line, flag: bool) -> bool {
    return p.x == 1 && p.y == 2
        && line.a.x == 3 && line.a.y == 4
        && line.b.x == 5 && line.b.y == 6
        && flag;
}
`;
  const loaded = analyze(source, "<entry-records>", STANDARD_PROFILE);
  assert.ok(loaded.typed, loaded.diagnostics.map((d) => d.message).join("; "));
  assert.deepEqual(evaluate(loaded.typed!, "main", { values: [1, 2, 3, 4, 5, 6, true] }), {
    status: "ok",
    type: "bool",
    value: true,
  });
  assert.deepEqual(evaluate(loaded.typed!, "main", { values: [1, 2, 3, 4, 5, 6, false] }), {
    status: "ok",
    type: "bool",
    value: false,
  });
  // A wrong flattened count is rejected before any record is built.
  assert.throws(
    () => evaluate(loaded.typed!, "main", { values: [1, 2, 3] }),
    /expects 7 argument\(s\), received 3/,
  );
  // Leaf types are validated against the flattened signature.
  assert.throws(
    () => evaluate(loaded.typed!, "main", { values: [1, 2, 3, 4, 5, 6, 1] }),
    /argument 7 of "main" has type i32, expected bool/,
  );
});

test("entry record code generation parses flattened arguments and builds records", () => {
  const source = readFileSync(resolve("examples", "entry-records.hs"), "utf8");
  const loaded = analyze(source, "<entry-records>", STANDARD_PROFILE);
  assert.ok(loaded.typed, loaded.diagnostics.map((d) => d.message).join("; "));
  const { emit } = require("../backends") as typeof import("../backends");
  for (const target of ["csharp", "rust", "go", "java"] as const) {
    const project = emit(loaded.typed!, target, "main");
    const text = project.files.map((file) => file.content).join("\n");
    assert.match(text, /!=\s*7/, `${target} should check the flattened arity`);
    assert.match(text, /R1/, `${target} should generate the Point record type`);
    assert.match(text, /R2/, `${target} should generate the Line record type`);
    assert.match(text, /f1\(/, `${target} should call the entry function`);
    for (const sourceName of ["Point", "Line"]) {
      assert.ok(
        !new RegExp(`\\b${sourceName}\\b`).test(text),
        `${target} must not emit source name ${sourceName}`,
      );
    }
  }
});

test("unsupported leaf types in entry record parameters stay rejected", () => {
  const stringLeaf = analyze(
    "record Bad { name: string }\nfn main(bad: Bad) -> bool { return true; }\n",
    "<entry-records>",
    STANDARD_PROFILE,
  );
  assert.ok(stringLeaf.diagnostics.some((d) => d.code === "E_STRING_FIELD_UNSUPPORTED"));
  assert.ok(
    stringLeaf.diagnostics.some((d) => d.code === "E_RECORD_ENTRY_PARAMETER_UNSUPPORTED"),
    stringLeaf.diagnostics.map((d) => d.code).join(", "),
  );

  const nestedLeaf = analyze(
    "record Inner { xs: list<i32> }\nrecord Outer { inner: Inner }\nfn main(outer: Outer) -> bool { return true; }\n",
    "<entry-records>",
    STANDARD_PROFILE,
  );
  assert.ok(nestedLeaf.diagnostics.some((d) => d.code === "E_LIST_FIELD_UNSUPPORTED"));
  assert.ok(
    nestedLeaf.diagnostics.some((d) => d.code === "E_RECORD_ENTRY_PARAMETER_UNSUPPORTED"),
    nestedLeaf.diagnostics.map((d) => d.code).join(", "),
  );
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
  assert.ok(update.typed, update.diagnostics.map((d) => d.message).join("; "));
});

test("record target names and field names avoid source keyword collisions", () => {
  const source = `record Class {
    class: i32,
    struct: i32,
    type: bool,
}

fn main() -> bool {
    let func: Class = Class { type: true, class: 3, struct: 4 };
    let other: Class = Class { struct: 4, class: 3, type: true };
    return func == other && func.class + func.struct == 7 && func.type;
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

test("lists support literals, indexing, length, internal calls, and equality", () => {
  const source = `fn pick(xs: list<i32>, i: i32) -> i32 {
    return xs[i];
}
fn flags() -> list<bool> {
    return [true, false, true];
}
fn main() -> bool {
    let xs: list<i32> = [10, 20, 30];
    let copy: list<i32> = xs;
    let bs: list<bool> = flags();
    return length(xs) == 3 && xs[0] == 10 && xs[2] == 30 && pick(xs, 1) == 20
        && xs == copy && bs[0] && !bs[1] && length(bs) == 3;
}
`;
  assert.deepEqual(resultOf(source), { status: "ok", type: "bool", value: true });
});

test("out-of-range list indexing fails with E_INDEX at the indexing node", () => {
  const source = `fn main(i: i32) -> i32 {
    let xs: list<i32> = [1, 2, 3];
    return xs[i];
}
`;
  const loaded = analyze(source, "<list>", STANDARD_PROFILE);
  assert.ok(loaded.typed, loaded.diagnostics.map((d) => d.message).join("; "));
  let indexNode: number | undefined;
  walkStatements(loaded.program!.functions[0].body, (stmt) => {
    if (stmt.kind !== "ReturnStmt") return;
    walkExpr(stmt.value, (expr) => {
      if (expr.kind === "IndexExpr" && indexNode === undefined) indexNode = expr.id;
    });
  });
  assert.equal(typeof indexNode, "number");

  for (const argument of [-1, 3, 99]) {
    const outcome = evaluate(loaded.typed!, "main", { values: [argument] });
    assert.deepEqual(outcome, { status: "error", code: "E_INDEX", node: indexNode });
  }
  assert.deepEqual(evaluate(loaded.typed!, "main", { values: [1] }), {
    status: "ok",
    type: "i32",
    value: 2,
  });
});

test("empty and unsupported list literals are rejected with clear diagnostics", () => {
  const empty = analyze("fn main() -> bool { let xs: list<i32> = []; return true; }\n", "<list>", STANDARD_PROFILE);
  assert.ok(empty.diagnostics.some((d) => d.code === "E_EMPTY_LIST_UNSUPPORTED"));

  const mixed = analyze(
    "fn main() -> bool { let xs: list<i32> = [1, true]; return true; }\n",
    "<list>",
    STANDARD_PROFILE,
  );
  assert.ok(mixed.diagnostics.some((d) => d.code === "E_LIST_ELEMENT_TYPE"));

  const stringList = analyze(
    'fn main() -> bool { let xs: list<string> = ["a"]; return true; }\n',
    "<list>",
    STANDARD_PROFILE,
  );
  assert.ok(stringList.diagnostics.some((d) => d.code === "E_LIST_ELEMENT_UNSUPPORTED"));

  const recordList = analyze(
    "record Point { x: i32 }\nfn main() -> bool { let xs: list<Point> = [Point { x: 1 }]; return true; }\n",
    "<list>",
    STANDARD_PROFILE,
  );
  assert.ok(recordList.diagnostics.some((d) => d.code === "E_LIST_ELEMENT_UNSUPPORTED"));
});

test("list entry values and list record fields are rejected in this slice", () => {
  const entryParam = analyze(
    "fn main(xs: list<i32>) -> i32 { return length(xs); }\n",
    "<list>",
    STANDARD_PROFILE,
  );
  assert.ok(entryParam.diagnostics.some((d) => d.code === "E_LIST_ENTRY_PARAMETER_UNSUPPORTED"));

  const entryReturn = analyze(
    "fn main() -> list<i32> { return [1]; }\n",
    "<list>",
    STANDARD_PROFILE,
  );
  assert.ok(entryReturn.diagnostics.some((d) => d.code === "E_LIST_ENTRY_RETURN_UNSUPPORTED"));

  const recordField = analyze(
    "record Bad { xs: list<i32> }\nfn main() -> i32 { return 1; }\n",
    "<list>",
    STANDARD_PROFILE,
  );
  assert.ok(recordField.diagnostics.some((d) => d.code === "E_LIST_FIELD_UNSUPPORTED"));

  const indexType = analyze(
    "fn main() -> i32 { let xs: list<i32> = [1]; return xs[true]; }\n",
    "<list>",
    STANDARD_PROFILE,
  );
  assert.ok(indexType.diagnostics.some((d) => d.code === "E_LIST_INDEX_TYPE"));
});

test("list code generation uses target list types and hides source identifiers", () => {
  const source = readFileSync(resolve("examples", "list.hs"), "utf8");
  const loaded = analyze(source, "<list>", STANDARD_PROFILE);
  assert.ok(loaded.typed, loaded.diagnostics.map((d) => d.message).join("; "));
  const { emit } = require("../backends") as typeof import("../backends");
  const expectations: Record<string, RegExp> = {
    csharp: /List<int>/,
    go: /\[\]int32/,
    java: /int\[\]/,
    rust: /Vec<i32>/,
  };
  for (const target of ["csharp", "rust", "go", "java"] as const) {
    const project = emit(loaded.typed!, target, "main");
    const text = project.files.map((file) => file.content).join("\n");
    assert.match(text, expectations[target], `${target} should use its list representation`);
    assert.match(text, /E_INDEX/, `${target} should print E_INDEX for failure code 4`);
    assert.match(text, /Index|index/, `${target} should generate a bounds-checked index helper`);
    for (const sourceName of ["xs", "copy", "bs", "pick", "flags"]) {
      assert.ok(!new RegExp(`\\b${sourceName}\\b`).test(text), `${target} must not emit source name ${sourceName}`);
    }
  }
});

test("variants construct, pass, return, match, and compare structurally", () => {
  const source = readFileSync(resolve("examples", "variants.hs"), "utf8");
  assert.deepEqual(resultOf(source), { status: "ok", type: "bool", value: true });

  const equality = resultOf(`variant Box {
    value(i32),
    empty,
}
fn wrap(x: i32) -> Box {
    return value(x);
}
fn main() -> bool {
    let a: Box = wrap(7);
    let b: Box = value(8);
    let c: Box = wrap(7);
    let none: Box = empty();
    return a == c && a != b && none != a && none == empty();
}
`);
  assert.deepEqual(equality, { status: "ok", type: "bool", value: true });
});

test("match evaluates only the selected arm", () => {
  const source = `variant Choice {
    yes(i32),
    no,
}
fn main() -> bool {
    let choice: Choice = yes(5);
    let first: i32 = match choice {
        yes(value) => value,
        no => 2147483647 + 1,
    };
    let second: i32 = match choice {
        yes(value) => value,
        no => 2147483647 + 1,
    };
    return first == second && first == 5 && choice == yes(5);
}
`;
  assert.deepEqual(resultOf(source), { status: "ok", type: "bool", value: true });
});

test("non-exhaustive and malformed matches are rejected", () => {
  const nonExhaustive = analyze(
    `variant Shape { circle(i32), rectangle(i32, i32), empty }
fn main() -> i32 {
    let shape: Shape = circle(2);
    return match shape { circle(r) => r, rectangle(w, h) => w * h };
}
`,
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(
    nonExhaustive.diagnostics.some((diagnostic) => diagnostic.code === "E_NON_EXHAUSTIVE_MATCH"),
    nonExhaustive.diagnostics.map((diagnostic) => diagnostic.code).join(", "),
  );

  const wildcardNotFinal = analyze(
    `variant Shape { circle(i32), empty }
fn main() -> i32 {
    let shape: Shape = empty();
    return match shape { _ => 1, circle(r) => r };
}
`,
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(wildcardNotFinal.diagnostics.some((diagnostic) => diagnostic.code === "E_WILDCARD_NOT_FINAL"));

  const unknown = analyze(
    `variant Shape { circle(i32) }
fn main() -> i32 {
    let shape: Shape = circle(2);
    return match shape { square(r) => r };
}
`,
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(unknown.diagnostics.some((diagnostic) => diagnostic.code === "E_UNKNOWN_ALTERNATIVE"));

  const duplicate = analyze(
    `variant Shape { circle(i32), empty }
fn main() -> i32 {
    let shape: Shape = empty();
    return match shape { circle(r) => r, circle(r) => r + 1, empty() => 0 };
}
`,
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(duplicate.diagnostics.some((diagnostic) => diagnostic.code === "E_DUPLICATE_MATCH_ARM"));

  const arity = analyze(
    `variant Shape { circle(i32), empty }
fn main() -> i32 {
    let shape: Shape = empty();
    return match shape { circle(r, q) => r, empty() => 0 };
}
`,
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(arity.diagnostics.some((diagnostic) => diagnostic.code === "E_PATTERN_ARITY"));

  const armType = analyze(
    `variant Shape { circle(i32), empty }
fn main() -> i32 {
    let shape: Shape = empty();
    return match shape { circle(r) => true, empty() => 0 };
}
`,
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(armType.diagnostics.some((diagnostic) => diagnostic.code === "E_MATCH_ARM_TYPE"));

  const nonVariant = analyze(
    "fn main() -> i32 { return match 1 { _ => 2 }; }\n",
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(nonVariant.diagnostics.some((diagnostic) => diagnostic.code === "E_MATCH_ON_NON_VARIANT"));
});

test("ambiguous constructors and constructor diagnostics are reported", () => {
  const ambiguous = analyze(
    `variant Shape { make(i32) }
fn make(x: i32) -> i32 { return x; }
fn main() -> i32 { let shape: Shape = make(1); return 1; }
`,
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(ambiguous.diagnostics.some((diagnostic) => diagnostic.code === "E_AMBIGUOUS_CONSTRUCTOR"));

  const arity = analyze(
    `variant Shape { circle(i32) }
fn main() -> i32 { let shape: Shape = circle(1, 2); return 1; }
`,
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(arity.diagnostics.some((diagnostic) => diagnostic.code === "E_ARITY"));

  const argumentType = analyze(
    `variant Shape { circle(i32) }
fn main() -> i32 { let shape: Shape = circle(true); return 1; }
`,
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(argumentType.diagnostics.some((diagnostic) => diagnostic.code === "E_ARGUMENT_TYPE"));
});

test("variant payloads, record fields, lists, and entry boundaries are rejected clearly", () => {
  const payload = analyze(
    "variant Bad { wrap(string) }\nfn main() -> i32 { return 1; }\n",
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(payload.diagnostics.some((diagnostic) => diagnostic.code === "E_VARIANT_PAYLOAD_UNSUPPORTED"));

  const recordField = analyze(
    "variant Shape { empty }\nrecord Wrapper { shape: Shape }\nfn main() -> i32 { return 1; }\n",
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(recordField.diagnostics.some((diagnostic) => diagnostic.code === "E_VARIANT_FIELD_UNSUPPORTED"));

  const listElement = analyze(
    "variant Shape { empty }\nfn main() -> bool { let shapes: list<Shape> = [empty()]; return true; }\n",
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(listElement.diagnostics.some((diagnostic) => diagnostic.code === "E_VARIANT_IN_LIST"));

  const entryParam = analyze(
    "variant Shape { empty }\nfn main(shape: Shape) -> i32 { return 1; }\n",
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(entryParam.diagnostics.some((diagnostic) => diagnostic.code === "E_VARIANT_ENTRY_PARAMETER_UNSUPPORTED"));

  const entryReturn = analyze(
    "variant Shape { empty }\nfn main() -> Shape { return empty(); }\n",
    "<variants>",
    STANDARD_PROFILE,
  );
  assert.ok(entryReturn.diagnostics.some((diagnostic) => diagnostic.code === "E_VARIANT_ENTRY_RETURN_UNSUPPORTED"));
});

test("variant code generation uses tagged target types and hides source names", () => {
  const source = readFileSync(resolve("examples", "variants.hs"), "utf8");
  const loaded = analyze(source, "<variants>", STANDARD_PROFILE);
  assert.ok(loaded.typed, loaded.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  const { emit } = require("../backends") as typeof import("../backends");
  for (const target of ["csharp", "rust", "go", "java"] as const) {
    const project = emit(loaded.typed!, target, "main");
    const text = project.files.map((file) => file.content).join("\n");
    assert.match(text, /V1/, `${target} should generate a variant type`);
    assert.match(text, /\.tag ==/, `${target} should lower match arms by tag`);
    for (const sourceName of ["Shape", "circle", "rectangle", "empty"]) {
      assert.ok(
        !new RegExp(`\\b${sourceName}\\b`).test(text),
        `${target} must not emit source variant name ${sourceName}`,
      );
    }
  }
});

test("contextual match and variant words remain usable identifiers", () => {
  const source = `fn match(x: i32) -> i32 { return x; }
fn main() -> i32 {
    let variant: i32 = 3;
    let matchValue: i32 = match(2);
    let total: i32 = matchValue + variant;
    return total;
}
`;
  const loaded = analyze(source, "<contextual>", STANDARD_PROFILE);
  assert.ok(loaded.typed, loaded.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  assert.deepEqual(evaluate(loaded.typed!, "main", { values: [] }), {
    status: "ok",
    type: "i32",
    value: 5,
  });
});

test("variant programs preserve the normalized AST across profiles", () => {
  const source = readFileSync(resolve("examples", "variants.hs"), "utf8");
  const canonical = analyze(source, "<canonical>", STANDARD_PROFILE);
  assert.ok(canonical.program);
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

test("Option and Result construct, match, pass, return, and compare structurally", () => {
  const source = readFileSync(resolve("examples", "option-result.hs"), "utf8");
  assert.deepEqual(resultOf(source), { status: "ok", type: "bool", value: true });

  const equality = resultOf(`fn main() -> bool {
    let a: Option<bool> = some(true);
    let b: Option<bool> = some(true);
    let c: Option<bool> = none();
    let d: Result<bool> = ok(true);
    let e: Result<bool> = ok(true);
    let f: Result<bool> = err("no");
    let g: Result<bool> = err("no");
    return a == b && a != c && c == none() && d == e && d != f && f == g;
}
`);
  assert.deepEqual(equality, { status: "ok", type: "bool", value: true });
});

test("Option and Result matches run only the selected arm", () => {
  const result = resultOf(`fn main() -> bool {
    let present: Option<i32> = some(5);
    let absent: Option<i32> = none();
    let good: Result<i32> = ok(7);
    let bad: Result<i32> = err("no");
    let picked: i32 = match present {
        some(x) => x,
        none() => 2147483647 + 1,
    };
    let fallback: i32 = match absent {
        some(x) => x,
        none() => 9,
    };
    let kept: bool = match good {
        ok(x) => x == 7,
        err(message) => 2147483647 + 1 == 0,
    };
    let rejected: bool = match bad {
        ok(x) => x == 0,
        err(message) => message == "no",
    };
    return picked == 5 && fallback == 9 && kept && rejected;
}
`);
  assert.deepEqual(result, { status: "ok", type: "bool", value: true });
});

test("Option and Result matches must be exhaustive and wildcard-last", () => {
  const nonExhaustiveOption = analyze(
    `fn main() -> bool {
    let value: Option<i32> = some(1);
    return match value { some(x) => x == 1 };
}
`,
    "<option>",
    STANDARD_PROFILE,
  );
  assert.ok(
    nonExhaustiveOption.diagnostics.some((d) => d.code === "E_NON_EXHAUSTIVE_MATCH"),
    nonExhaustiveOption.diagnostics.map((d) => d.code).join(", "),
  );

  const nonExhaustiveResult = analyze(
    `fn main() -> bool {
    let value: Result<i32> = ok(1);
    return match value { ok(x) => x == 1 };
}
`,
    "<result>",
    STANDARD_PROFILE,
  );
  assert.ok(nonExhaustiveResult.diagnostics.some((d) => d.code === "E_NON_EXHAUSTIVE_MATCH"));

  const wildcardNotFinal = analyze(
    `fn main() -> bool {
    let value: Option<i32> = none();
    return match value { _ => true, some(x) => x == 1, none() => false };
}
`,
    "<option>",
    STANDARD_PROFILE,
  );
  assert.ok(wildcardNotFinal.diagnostics.some((d) => d.code === "E_WILDCARD_NOT_FINAL"));
});

test("none and err require a matching expected type in context", () => {
  const missingNone = analyze(
    "fn main() -> bool { return none() == none(); }\n",
    "<option>",
    STANDARD_PROFILE,
  );
  assert.ok(missingNone.diagnostics.some((d) => d.code === "E_MISSING_EXPECTED_TYPE"));

  const missingErr = analyze(
    'fn main() -> bool { return err("x") == err("x"); }\n',
    "<result>",
    STANDARD_PROFILE,
  );
  assert.ok(missingErr.diagnostics.some((d) => d.code === "E_MISSING_EXPECTED_TYPE"));

  const wrongNone = analyze(
    "fn main() -> bool { let value: i32 = none(); return value == 0; }\n",
    "<option>",
    STANDARD_PROFILE,
  );
  assert.ok(wrongNone.diagnostics.some((d) => d.code === "E_CONSTRUCTOR_EXPECTED_TYPE"));

  const wrongErr = analyze(
    'fn main() -> bool { let value: Option<i32> = err("x"); return value == none(); }\n',
    "<result>",
    STANDARD_PROFILE,
  );
  assert.ok(wrongErr.diagnostics.some((d) => d.code === "E_CONSTRUCTOR_EXPECTED_TYPE"));
});

test("Option and Result constructor payload types are checked", () => {
  const somePayload = analyze(
    "fn main() -> bool { let value: Option<i32> = some(true); return value == none(); }\n",
    "<option>",
    STANDARD_PROFILE,
  );
  assert.ok(somePayload.diagnostics.some((d) => d.code === "E_CONSTRUCTOR_PAYLOAD_TYPE"));

  const errPayload = analyze(
    'fn main() -> bool { let value: Result<i32> = err(1); return value == ok(1); }\n',
    "<result>",
    STANDARD_PROFILE,
  );
  assert.ok(errPayload.diagnostics.some((d) => d.code === "E_CONSTRUCTOR_PAYLOAD_TYPE"));

  const nested = analyze(
    "fn main() -> bool { let value: Option<i32> = some(none()); return value == none(); }\n",
    "<option>",
    STANDARD_PROFILE,
  );
  assert.ok(nested.diagnostics.some((d) => d.code === "E_NESTED_OPTION_RESULT"));
});

test("Option and Result entry values and containers are rejected in this slice", () => {
  const entryParam = analyze(
    "fn main(value: Option<i32>) -> i32 { return 1; }\n",
    "<option>",
    STANDARD_PROFILE,
  );
  assert.ok(entryParam.diagnostics.some((d) => d.code === "E_OPTION_ENTRY_PARAMETER_UNSUPPORTED"));

  const entryReturn = analyze(
    "fn main() -> Result<bool> { return ok(true); }\n",
    "<result>",
    STANDARD_PROFILE,
  );
  assert.ok(entryReturn.diagnostics.some((d) => d.code === "E_RESULT_ENTRY_RETURN_UNSUPPORTED"));

  const recordField = analyze(
    "record Bad { value: Option<i32> }\nfn main() -> i32 { return 1; }\n",
    "<option>",
    STANDARD_PROFILE,
  );
  assert.ok(recordField.diagnostics.some((d) => d.code === "E_OPTION_FIELD_UNSUPPORTED"));

  const resultField = analyze(
    "record Bad { value: Result<bool> }\nfn main() -> i32 { return 1; }\n",
    "<result>",
    STANDARD_PROFILE,
  );
  assert.ok(resultField.diagnostics.some((d) => d.code === "E_RESULT_FIELD_UNSUPPORTED"));

  const optionList = analyze(
    "fn main() -> bool { let values: list<Option<i32>> = [some(1)]; return true; }\n",
    "<option>",
    STANDARD_PROFILE,
  );
  assert.ok(optionList.diagnostics.some((d) => d.code === "E_OPTION_IN_LIST"));

  const resultList = analyze(
    'fn main() -> bool { let values: list<Result<i32>> = [ok(1)]; return true; }\n',
    "<result>",
    STANDARD_PROFILE,
  );
  assert.ok(resultList.diagnostics.some((d) => d.code === "E_RESULT_IN_LIST"));
});

test("Option and Result code generation hides source constructor names", () => {
  const source = readFileSync(resolve("examples", "option-result.hs"), "utf8");
  const loaded = analyze(source, "<option-result>", STANDARD_PROFILE);
  assert.ok(loaded.typed, loaded.diagnostics.map((d) => d.message).join("; "));
  assert.ok(loaded.typed!.builtinVariants.length >= 2);
  const { emit } = require("../backends") as typeof import("../backends");
  for (const target of ["csharp", "rust", "go", "java"] as const) {
    const project = emit(loaded.typed!, target, "main");
    const text = project.files.map((file) => file.content).join("\n");
    assert.match(text, /X1/, `${target} should generate a built-in tagged type`);
    for (const sourceName of ["some", "none", "Option", "Result"]) {
      assert.ok(
        !new RegExp(`\\b${sourceName}\\b`).test(text),
        `${target} must not emit source name ${sourceName}`,
      );
    }
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
