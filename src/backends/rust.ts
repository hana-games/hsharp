import type { GeneratedProject } from "../contracts/interfaces";
import type { FunctionSignature, TypedProgram } from "../contracts/outcome";
import { INDEX_FAILURE_CODE } from "../contracts/outcome";
import { CORE_VERSION, COMPILER_VERSION } from "../contracts/version";
import {
  collectRecords,
  collectVariants,
  emitFunctionBody,
  functionBySignature,
  quoteString,
  targetType,
  type Dialect,
  type RecordMap,
  type VariantMap,
} from "./codegen";

export function emitRust(
  program: TypedProgram,
  entryName: string,
  options: { projectName?: string } = {},
): GeneratedProject {
  void options;
  const entry = program.functions.find((fn) => fn.name === entryName);
  if (!entry) throw new Error(`entry function "${entryName}" was not found`);
  const records = collectRecords(program);
  const variants = collectVariants(program);

  const dialect: Dialect = {
    target: "rust",
    intType: "i32",
    stringType: "String",
    intMinLiteral: "i32::MIN",
    declare: (name, type, init) => [`let mut ${name}: ${type} = ${init};`],
    declareRes: (name, init) => [`let ${name}: Res = ${init};`],
    assign: (name, expr) => [`${name} = ${expr};`],
    ifOpen: (cond) => `if ${cond} {`,
    elseIfOpen: (cond) => `} else if ${cond} {`,
    elseOpen: () => `} else {`,
    closeBlock: () => `}`,
    returnStmt: (expr) => `return ${expr};`,
    resFailed: (expr) => `!${expr}.ok`,
    resValue: (expr) => `${expr}.value`,
    resOk: (expr) => `Res::ok(${expr})`,
    resOkRecord: (record, expr) => `Res::ok_record(Payload::${record.targetName}(${expr}))`,
    resRecordValue: (expr, record) =>
      `match ${expr}.payload { Payload::${record.targetName}(value) => value, _ => return Res::fail(2, 0) }`,
    resOkVariant: (variant, expr) => `Res::ok_record(Payload::${variant.targetName}(${expr}))`,
    resVariantValue: (expr, variant) =>
      `match ${expr}.payload { Payload::${variant.targetName}(value) => value, _ => return Res::fail(2, 0) }`,
    resOkString: (expr) => `Res::ok_string(${expr})`,
    resStringValue: (expr) =>
      `match ${expr}.payload { Payload::String(value) => value, _ => return Res::fail(2, 0) }`,
    stringLiteral: (value) => `String::from(${quoteString(value)})`,
    stringValue: (expr) => `${expr}.clone()`,
    emptyString: () => `String::new()`,
    valueEquals: (left, right) => `${left} == ${right}`,
    resFail: (code, node) => `Res::fail(${code}, ${node})`,
    checked: (op, args, node) => `${op}(${[...args, String(node)].join(", ")})`,
    call: (fn, args) => `${fn}(${args.join(", ")})`,
    recordLiteral: (record, values) =>
      record.fields.length === 0
        ? `${record.targetName} {}`
        : `${record.targetName} { ${record.fields
            .map((field, index) => `${field.targetName}: ${values[index]}`)
            .join(", ")} }`,
    fieldAccess: (target, record, index) => `${target}.${record.fields[index].targetName}`,
    fieldEquals: (left, right, record, index) =>
      `${left}.${record.fields[index].targetName} == ${right}.${record.fields[index].targetName}`,
    constructVariant: (variant, alternative, values) => {
      if (variant.builtin?.kind === "result") {
        const isErr = alternative.payload[0] === "string";
        return `${variant.targetName} { tag: ${alternative.tag}, p1: ${isErr ? "0" : values[0] ?? "0"}, s1: ${
          isErr ? values[0] ?? "String::new()" : "String::new()"
        } }`;
      }
      const fields = ["tag", ...Array.from({ length: variant.maxArity }, (_unused, index) => `p${index + 1}`)];
      const assigned = [String(alternative.tag), ...values, ...Array(Math.max(0, variant.maxArity - values.length)).fill("0")];
      return `${variant.targetName} { ${fields.map((field, index) => `${field}: ${assigned[index]}`).join(", ")} }`;
    },
    variantTag: (expr) => `${expr}.tag`,
    variantValue: (expr, variant) => (variant.builtin?.kind === "result" ? `${expr}.clone()` : expr),
    variantPayload: (expr, variant, alternative, index) =>
      variant.builtin?.kind === "result" && alternative.payload[0] === "string"
        ? `${expr}.s1`
        : `${expr}.p${index + 1}`,
    variantEquals: (left, right) => `${left} == ${right}`,
    listType: (element) => `Vec<${element}>`,
    listLiteral: (values) => `vec![${values.join(", ")}]`,
    emptyList: () => `vec![]`,
    listValue: (expr) => `${expr}.clone()`,
    listLength: (expr) => `(${expr}.len() as i32)`,
    listIndex: (list, index, node) => `index(&${list}, ${index}, ${node})`,
    listEquals: (left, right) => `${left} == ${right}`,
    resOkList: (expr) => `Res::ok_list(${expr})`,
    resListValue: (expr) =>
      `match ${expr}.payload { Payload::List(value) => value, _ => return Res::fail(2, 0) }`,
  };

  const recordDeclarations = renderRecords(records, dialect, variants);
  const variantDeclarations = renderVariants(variants, dialect);
  const payloadVariants = [
    "    String(String),",
    "    List(Vec<i32>),",
    ...[...records.values()].map((record) => `    ${record.targetName}(${record.targetName}),`),
    ...[...variants.values()].map((variant) => `    ${variant.targetName}(${variant.targetName}),`),
  ].join("\n");
  const functions = program.functions
    .map((signature) => renderFunction(program, signature, dialect, records, variants))
    .join("\n\n");

  const main = renderMain(entry);
  const source = `// Generated by h# ${COMPILER_VERSION} (core ${CORE_VERSION}). Do not edit.
#![allow(unused_mut, dead_code)]
enum Payload {
    None,
${payloadVariants}
}

struct Res {
    ok: bool,
    value: i32,
    payload: Payload,
    code: i32,
    node: i32,
}

impl Res {
    fn ok(value: i32) -> Res {
        Res { ok: true, value, payload: Payload::None, code: 0, node: 0 }
    }

    fn ok_record(payload: Payload) -> Res {
        Res { ok: true, value: 0, payload, code: 0, node: 0 }
    }

    fn ok_string(value: String) -> Res {
        Res { ok: true, value: 0, payload: Payload::String(value), code: 0, node: 0 }
    }

    fn ok_list(value: Vec<i32>) -> Res {
        Res { ok: true, value: 0, payload: Payload::List(value), code: 0, node: 0 }
    }

    fn fail(code: i32, node: i32) -> Res {
        Res { ok: false, value: 0, payload: Payload::None, code, node }
    }
}

fn add(a: i32, b: i32, node: i32) -> Res {
    let r = (a as i64) + (b as i64);
    if r < -2147483648i64 || r > 2147483647i64 {
        return Res::fail(1, node);
    }
    Res::ok(r as i32)
}

fn sub(a: i32, b: i32, node: i32) -> Res {
    let r = (a as i64) - (b as i64);
    if r < -2147483648i64 || r > 2147483647i64 {
        return Res::fail(1, node);
    }
    Res::ok(r as i32)
}

fn mul(a: i32, b: i32, node: i32) -> Res {
    let r = (a as i64) * (b as i64);
    if r < -2147483648i64 || r > 2147483647i64 {
        return Res::fail(1, node);
    }
    Res::ok(r as i32)
}

fn neg(a: i32, node: i32) -> Res {
    let r = -(a as i64);
    if r < -2147483648i64 || r > 2147483647i64 {
        return Res::fail(1, node);
    }
    Res::ok(r as i32)
}

fn index(list: &Vec<i32>, index: i32, node: i32) -> Res {
    if index < 0 || (index as usize) >= list.len() {
        return Res::fail(${INDEX_FAILURE_CODE}, node);
    }
    Res::ok(list[index as usize])
}

${recordDeclarations}

${variantDeclarations}

${functions}

${main}
`;

  const binaryName = process.platform === "win32" ? "hs_program.exe" : "hs_program";

  return {
    target: "rust",
    files: [
      {
        path: "Cargo.toml",
        content: `[package]
name = "hs_program"
version = "0.1.0"
edition = "2021"
publish = false

[[bin]]
name = "hs_program"
path = "src/main.rs"
`,
      },
      { path: "src/main.rs", content: source },
    ],
    build: ["cargo", "build", "--release", "--offline"],
    run: [`target/release/${binaryName}`],
  };
}

function renderRecords(records: RecordMap, dialect: Dialect, variants: VariantMap): string {
  return [...records.values()]
    .map((record) => {
      const lines = [`#[derive(Clone, Copy, PartialEq, Eq)]`, `struct ${record.targetName} {`];
      for (const field of record.fields) {
        lines.push(`    ${field.targetName}: ${targetType(field.type, records, dialect.intType, dialect.stringType, dialect.listType, variants)},`);
      }
      lines.push("}");
      return lines.join("\n");
    })
    .join("\n\n");
}

function renderVariants(variants: VariantMap, dialect: Dialect): string {
  return [...variants.values()]
    .map((variant) => {
      if (variant.builtin?.kind === "result") {
        return [
          `#[derive(Clone, PartialEq, Eq)]`,
          `struct ${variant.targetName} {`,
          `    tag: ${dialect.intType},`,
          `    p1: ${dialect.intType},`,
          `    s1: ${dialect.stringType},`,
          `}`,
        ].join("\n");
      }
      const lines = [`#[derive(Clone, Copy, PartialEq, Eq)]`, `struct ${variant.targetName} {`, `    tag: ${dialect.intType},`];
      for (let index = 0; index < variant.maxArity; index++) {
        lines.push(`    p${index + 1}: ${dialect.intType},`);
      }
      lines.push("}");
      return lines.join("\n");
    })
    .join("\n\n");
}

function renderFunction(
  program: TypedProgram,
  signature: FunctionSignature,
  dialect: Dialect,
  records: RecordMap,
  variants: VariantMap,
): string {
  const fn = functionBySignature(program, signature);
  const parameters = fn.params
    .map((param) => `${param.targetName}: ${targetType(param.type.name, records, dialect.intType, dialect.stringType, dialect.listType, variants)}`)
    .join(", ");
  const body = emitFunctionBody(fn, dialect, records, variants);
  return `fn ${signature.targetName}(${parameters}) -> Res {\n${indent(body, 4)}\n}`;
}

function renderMain(entry: FunctionSignature): string {
  const params = entry.params;
  const lines: string[] = [];
  lines.push("fn bad_args() -> ! {");
  lines.push('    println!("{{\\"status\\":\\"badargs\\"}}");');
  lines.push("    std::process::exit(2);");
  lines.push("}");
  lines.push("");
  lines.push("fn main() {");
  lines.push("    let args: Vec<String> = std::env::args().skip(1).collect();");
  lines.push(`    if args.len() != ${params.length} {`);
  lines.push("        bad_args();");
  lines.push("    }");
  params.forEach((param, index) => {
    const name = `p${index}`;
    if (param.type === "i32") {
      lines.push(`    let ${name}: i32 = match args[${index}].parse::<i32>() {`);
      lines.push("        Ok(value) => value,");
      lines.push("        Err(_) => bad_args(),");
      lines.push("    };");
    } else {
      lines.push(`    let ${name}: i32 = match args[${index}].as_str() {`);
      lines.push('        "true" => 1,');
      lines.push('        "false" => 0,');
      lines.push("        _ => bad_args(),");
      lines.push("    };");
    }
  });
  lines.push(
    `    let result = ${entry.targetName}(${params.map((_, i) => `p${i}`).join(", ")});`,
  );
  lines.push("    if result.ok {");
  if (entry.returnType === "bool") {
    lines.push(
      '        println!("{{\\"status\\":\\"ok\\",\\"type\\":\\"bool\\",\\"value\\":{}}}", if result.value != 0 { "true" } else { "false" });',
    );
  } else {
    lines.push(
      '        println!("{{\\"status\\":\\"ok\\",\\"type\\":\\"i32\\",\\"value\\":{}}}", result.value);',
    );
  }
  lines.push("    } else {");
  lines.push(`        let code = if result.code == ${INDEX_FAILURE_CODE} { "E_INDEX" } else { "E_OVERFLOW" };`);
  lines.push(
    '        println!("{{\\"status\\":\\"error\\",\\"code\\":\\"{}\\",\\"node\\":{}}}", code, result.node);',
  );
  lines.push("        std::process::exit(1);");
  lines.push("    }");
  lines.push("}");
  return lines.join("\n");
}

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? prefix + line : line))
    .join("\n");
}
