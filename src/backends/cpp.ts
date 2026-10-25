import type { FunctionDecl } from "../contracts/ast";
import type { GeneratedProject } from "../contracts/interfaces";
import type { FunctionSignature, TypedProgram } from "../contracts/outcome";
import { INDEX_FAILURE_CODE } from "../contracts/outcome";
import { isListTypeName, isPrimitiveTypeName, type TypeName } from "../contracts/tokens";
import { CORE_VERSION, COMPILER_VERSION } from "../contracts/version";
import { resolveExecutable } from "../harness/toolchain";
import {
  collectRecords,
  collectVariants,
  emitFunctionBody,
  functionBySignature,
  planEntryArguments,
  targetType,
  type Dialect,
  type EntryArgumentPlan,
  type RecordInfo,
  type RecordMap,
  type VariantMap,
} from "./codegen";

let cachedCompiler: string | undefined;

/**
 * The generated project records the compiler it will invoke. Prefer g++ and
 * fall back to clang++; both are probed once per process.
 */
function cppCompiler(): string {
  if (cachedCompiler !== undefined) return cachedCompiler;
  const configured = process.env.CXX;
  if (configured && configured.length > 0) {
    cachedCompiler = configured;
  } else if (resolveExecutable("g++")) {
    cachedCompiler = "g++";
  } else if (resolveExecutable("clang++")) {
    cachedCompiler = "clang++";
  } else {
    cachedCompiler = "g++";
  }
  return cachedCompiler;
}

export function emitCpp(
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
    target: "cpp",
    intType: "std::int32_t",
    stringType: "std::string",
    intMinLiteral: "std::numeric_limits<std::int32_t>::min()",
    declare: (name, type, init) => [`${type} ${name} = ${init};`],
    declareRes: (name, init) => [`Res ${name} = ${init};`],
    assign: (name, expr) => [`${name} = ${expr};`],
    ifOpen: (cond) => `if (${cond}) {`,
    elseIfOpen: (cond) => `} else if (${cond}) {`,
    elseOpen: () => `} else {`,
    closeBlock: () => `}`,
    returnStmt: (expr) => `return ${expr};`,
    resFailed: (expr) => `!${expr}.ok`,
    resValue: (expr) => `${expr}.value`,
    resOk: (expr) => `Res::okValue(${expr})`,
    resOkRecord: (record, expr) => `Res::ok${record.targetName}(${expr})`,
    resRecordValue: (expr, record) => `${expr}.payload.${payloadField(record.targetName)}`,
    resOkVariant: (variant, expr) => `Res::ok${variant.targetName}(${expr})`,
    resVariantValue: (expr, variant) => `${expr}.payload.${payloadField(variant.targetName)}`,
    resOkString: (expr) => `Res::okString(${expr})`,
    resStringValue: (expr) => `${expr}.payload.s`,
    stringLiteral: cppStringLiteral,
    stringValue: (expr) => expr,
    emptyString: () => "std::string()",
    valueEquals: (left, right, _type) => `${left} == ${right}`,
    resFail: (code, node) => `Res::fail(${code}, ${node})`,
    checked: (op, args, node) =>
      `hs${op[0].toUpperCase()}${op.slice(1)}(${[...args, String(node)].join(", ")})`,
    call: (fn, args) => `${fn}(${args.join(", ")})`,
    recordLiteral: (record, values) =>
      record.fields.length === 0
        ? `${record.targetName}()`
        : `${record.targetName}(${values.join(", ")})`,
    fieldAccess: (target, record, index) => `${target}.${record.fields[index].targetName}`,
    fieldEquals: (left, right, record, index) =>
      `${left}.${record.fields[index].targetName} == ${right}.${record.fields[index].targetName}`,
    constructVariant: (variant, alternative, values) => {
      if (variant.builtin?.kind === "result") {
        const isErr = alternative.payload[0] === "string";
        return `${variant.targetName}(${alternative.tag}, ${isErr ? "0" : values[0] ?? "0"}, ${
          isErr ? values[0] ?? '""' : '""'
        })`;
      }
      const fields = [
        String(alternative.tag),
        ...values,
        ...Array(Math.max(0, variant.maxArity - values.length)).fill("0"),
      ];
      return `${variant.targetName}(${fields.join(", ")})`;
    },
    variantTag: (expr, _variant) => `${expr}.tag`,
    variantValue: (expr, _variant) => expr,
    variantPayload: (expr, variant, alternative, index) =>
      variant.builtin?.kind === "result" && alternative.payload[0] === "string"
        ? `${expr}.s1`
        : `${expr}.p${index + 1}`,
    variantEquals: (left, right, _variant) => `${left} == ${right}`,
    listType: (element) => `std::vector<${element}>`,
    listLiteral: (values) => `std::vector<std::int32_t>{${values.join(", ")}}`,
    emptyList: () => "std::vector<std::int32_t>()",
    listValue: (expr) => expr,
    listLength: (expr) => `static_cast<std::int32_t>(${expr}.size())`,
    listIndex: (list, index, node) => `hsIndex(${list}, ${index}, ${node})`,
    listEquals: (left, right, _elementType) => `hsListEquals(${left}, ${right})`,
    resOkList: (expr) => `Res::okList(${expr})`,
    resListValue: (expr) => `${expr}.payload.l`,
  };

  const recordDeclarations = renderRecords(records, dialect, variants);
  const variantDeclarations = renderVariants(variants, dialect);
  const payloadDeclaration = renderPayload(records, variants);
  const resDeclaration = renderRes(records, variants);
  const helperFunctions = renderHelpers();
  const functionPrototypes = program.functions
    .map((signature) => renderPrototype(program, signature, dialect, records, variants))
    .join("\n");
  const functions = program.functions
    .map((signature) => renderFunction(program, signature, dialect, records, variants))
    .join("\n\n");
  const entryPlan = planEntryArguments(entry, records, dialect, (index) => `p${index}`);
  const main = renderMain(entry, entryPlan);

  const source = `// Generated by h# ${COMPILER_VERSION} (core ${CORE_VERSION}). Do not edit.
#include <charconv>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <string>
#include <system_error>
#include <vector>

${recordDeclarations}

${variantDeclarations}

${payloadDeclaration}

${resDeclaration}

${helperFunctions}

${functionPrototypes}

${functions}

${main}
`;

  const compiler = cppCompiler();
  const binaryName = process.platform === "win32" ? "bin/hs_program.exe" : "bin/hs_program";

  return {
    target: "cpp",
    files: [
      { path: "main.cpp", content: source },
      // g++ does not create the output directory; an empty tracked file keeps
      // the requested bin/hs_program output path available.
      { path: "bin/.gitkeep", content: "" },
    ],
    build: [compiler, "-std=c++20", "-O2", "-o", "bin/hs_program", "main.cpp"],
    run: [binaryName],
  };
}

function renderRecords(records: RecordMap, dialect: Dialect, variants: VariantMap): string {
  return orderRecords(records)
    .map((record) => {
      const lines = [`struct ${record.targetName} {`];
      for (const field of record.fields) {
        const type = targetType(
          field.type,
          records,
          dialect.intType,
          dialect.stringType,
          dialect.listType,
          variants,
        );
        lines.push(`    ${type} ${field.targetName} = ${defaultInit(field.type, records, dialect, variants)};`);
      }
      lines.push("");
      lines.push(`    ${record.targetName}() = default;`);
      if (record.fields.length > 0) {
        const parameters = record.fields.map((field, index) => {
          const type = targetType(
            field.type,
            records,
            dialect.intType,
            dialect.stringType,
            dialect.listType,
            variants,
          );
          return `${type} a${index + 1}`;
        });
        const initializers = record.fields.map(
          (field, index) => `${field.targetName}(a${index + 1})`,
        );
        lines.push(`    ${record.targetName}(${parameters.join(", ")}) : ${initializers.join(", ")} {}`);
      }
      lines.push("");
      lines.push(`    bool operator==(const ${record.targetName}& other) const {`);
      lines.push(
        `        return ${
          record.fields.length === 0
            ? "true"
            : record.fields
                .map((field) => `${field.targetName} == other.${field.targetName}`)
                .join(" && ")
        };`,
      );
      lines.push("    }");
      lines.push("};");
      return lines.join("\n");
    })
    .join("\n\n");
}

function renderVariants(variants: VariantMap, dialect: Dialect): string {
  return [...variants.values()]
    .map((variant) => {
      const isResult = variant.builtin?.kind === "result";
      const fields = isResult
        ? [
            { name: "tag", type: dialect.intType },
            { name: "p1", type: dialect.intType },
            { name: "s1", type: dialect.stringType },
          ]
        : [
            { name: "tag", type: dialect.intType },
            ...Array.from({ length: variant.maxArity }, (_unused, index) => ({
              name: `p${index + 1}`,
              type: dialect.intType,
            })),
          ];
      const lines = [`struct ${variant.targetName} {`];
      for (const field of fields) {
        const initializer = field.type === dialect.stringType ? "" : " = 0";
        lines.push(`    ${field.type} ${field.name}${initializer};`);
      }
      lines.push("");
      lines.push(`    ${variant.targetName}() = default;`);
      const parameters = fields.map((field, index) => `${field.type} a${index + 1}`);
      const initializers = fields.map((field, index) => `${field.name}(a${index + 1})`);
      lines.push(`    ${variant.targetName}(${parameters.join(", ")}) : ${initializers.join(", ")} {}`);
      lines.push("");
      lines.push(`    bool operator==(const ${variant.targetName}& other) const {`);
      lines.push(
        `        return ${fields.map((field) => `${field.name} == other.${field.name}`).join(" && ")};`,
      );
      lines.push("    }");
      lines.push("};");
      return lines.join("\n");
    })
    .join("\n\n");
}

function renderPayload(records: RecordMap, variants: VariantMap): string {
  const lines = [
    "struct Payload {",
    "    std::string s;",
    "    std::vector<std::int32_t> l;",
  ];
  for (const record of orderRecords(records)) {
    lines.push(`    ${record.targetName} ${payloadField(record.targetName)};`);
  }
  for (const variant of variants.values()) {
    lines.push(`    ${variant.targetName} ${payloadField(variant.targetName)};`);
  }
  lines.push("};");
  return lines.join("\n");
}

function renderRes(records: RecordMap, variants: VariantMap): string {
  const lines = [
    "struct Res {",
    "    bool ok = false;",
    "    std::int32_t value = 0;",
    "    std::int32_t code = 0;",
    "    std::int32_t node = 0;",
    "    Payload payload;",
    "",
    "    static Res okValue(std::int32_t value) {",
    "        Res result;",
    "        result.ok = true;",
    "        result.value = value;",
    "        return result;",
    "    }",
    "",
    "    static Res fail(std::int32_t code, std::int32_t node) {",
    "        Res result;",
    "        result.code = code;",
    "        result.node = node;",
    "        return result;",
    "    }",
    "",
    "    static Res okString(const std::string& value) {",
    "        Res result;",
    "        result.ok = true;",
    "        result.payload.s = value;",
    "        return result;",
    "    }",
    "",
    "    static Res okList(const std::vector<std::int32_t>& value) {",
    "        Res result;",
    "        result.ok = true;",
    "        result.payload.l = value;",
    "        return result;",
    "    }",
  ];
  for (const record of orderRecords(records)) {
    lines.push("");
    lines.push(`    static Res ok${record.targetName}(const ${record.targetName}& value) {`);
    lines.push("        Res result;");
    lines.push("        result.ok = true;");
    lines.push(`        result.payload.${payloadField(record.targetName)} = value;`);
    lines.push("        return result;");
    lines.push("    }");
  }
  for (const variant of variants.values()) {
    lines.push("");
    lines.push(`    static Res ok${variant.targetName}(const ${variant.targetName}& value) {`);
    lines.push("        Res result;");
    lines.push("        result.ok = true;");
    lines.push(`        result.payload.${payloadField(variant.targetName)} = value;`);
    lines.push("        return result;");
    lines.push("    }");
  }
  lines.push("};");
  return lines.join("\n");
}

function renderHelpers(): string {
  return `static Res hsAdd(std::int32_t a, std::int32_t b, std::int32_t node) {
    const std::int64_t r = static_cast<std::int64_t>(a) + static_cast<std::int64_t>(b);
    if (r < std::numeric_limits<std::int32_t>::min() || r > std::numeric_limits<std::int32_t>::max()) {
        return Res::fail(1, node);
    }
    return Res::okValue(static_cast<std::int32_t>(r));
}

static Res hsSub(std::int32_t a, std::int32_t b, std::int32_t node) {
    const std::int64_t r = static_cast<std::int64_t>(a) - static_cast<std::int64_t>(b);
    if (r < std::numeric_limits<std::int32_t>::min() || r > std::numeric_limits<std::int32_t>::max()) {
        return Res::fail(1, node);
    }
    return Res::okValue(static_cast<std::int32_t>(r));
}

static Res hsMul(std::int32_t a, std::int32_t b, std::int32_t node) {
    const std::int64_t r = static_cast<std::int64_t>(a) * static_cast<std::int64_t>(b);
    if (r < std::numeric_limits<std::int32_t>::min() || r > std::numeric_limits<std::int32_t>::max()) {
        return Res::fail(1, node);
    }
    return Res::okValue(static_cast<std::int32_t>(r));
}

static Res hsNeg(std::int32_t a, std::int32_t node) {
    const std::int64_t r = -static_cast<std::int64_t>(a);
    if (r < std::numeric_limits<std::int32_t>::min() || r > std::numeric_limits<std::int32_t>::max()) {
        return Res::fail(1, node);
    }
    return Res::okValue(static_cast<std::int32_t>(r));
}

static Res hsIndex(const std::vector<std::int32_t>& list, std::int32_t index, std::int32_t node) {
    if (index < 0 || index >= static_cast<std::int32_t>(list.size())) {
        return Res::fail(${INDEX_FAILURE_CODE}, node);
    }
    return Res::okValue(list[static_cast<std::size_t>(index)]);
}

static bool hsListEquals(const std::vector<std::int32_t>& left, const std::vector<std::int32_t>& right) {
    return left == right;
}

static void hsBadArgs() {
    std::cout << "{\\"status\\":\\"badargs\\"}\\n";
}

static bool hsParseI32(const char* text, std::int32_t& out) {
    const char* begin = text;
    const char* end = text + std::strlen(text);
    if (begin != end && *begin == '+') begin++;
    if (begin == end) return false;
    const auto parsed = std::from_chars(begin, end, out);
    return parsed.ec == std::errc() && parsed.ptr == end;
}

static bool hsParseBool(const char* text, std::int32_t& out) {
    if (std::strcmp(text, "true") == 0) {
        out = 1;
        return true;
    }
    if (std::strcmp(text, "false") == 0) {
        out = 0;
        return true;
    }
    return false;
}
`;
}

function renderPrototype(
  program: TypedProgram,
  signature: FunctionSignature,
  dialect: Dialect,
  records: RecordMap,
  variants: VariantMap,
): string {
  const fn = functionBySignature(program, signature);
  return `static Res ${signature.targetName}(${renderParameters(fn, dialect, records, variants)});`;
}

function renderParameters(
  fn: FunctionDecl,
  dialect: Dialect,
  records: RecordMap,
  variants: VariantMap,
): string {
  return fn.params
    .map(
      (param) =>
        `${targetType(
          param.type.name,
          records,
          dialect.intType,
          dialect.stringType,
          dialect.listType,
          variants,
        )} ${param.targetName}`,
    )
    .join(", ");
}

function renderFunction(
  program: TypedProgram,
  signature: FunctionSignature,
  dialect: Dialect,
  records: RecordMap,
  variants: VariantMap,
): string {
  const fn = functionBySignature(program, signature);
  const parameters = renderParameters(fn, dialect, records, variants);
  const body = emitFunctionBody(fn, dialect, records, variants);
  return `static Res ${signature.targetName}(${parameters}) {\n${indent(body, 4)}\n}`;
}

function renderMain(entry: FunctionSignature, plan: EntryArgumentPlan): string {
  const leaves = plan.leaves;
  const lines: string[] = [];
  lines.push("int main(int argc, char** argv) {");
  lines.push(`    if (argc - 1 != ${leaves.length}) {`);
  lines.push("        hsBadArgs();");
  lines.push("        return 2;");
  lines.push("    }");
  leaves.forEach((leaf, index) => {
    const name = `p${index}`;
    lines.push(`    std::int32_t ${name};`);
    const parser = leaf.type === "i32" ? "hsParseI32" : "hsParseBool";
    lines.push(`    if (!${parser}(argv[${index + 1}], ${name})) {`);
    lines.push("        hsBadArgs();");
    lines.push("        return 2;");
    lines.push("    }");
  });
  lines.push(`    const Res result = ${entry.targetName}(${plan.args.join(", ")});`);
  lines.push("    if (result.ok) {");
  if (entry.returnType === "bool") {
    lines.push(
      '        std::cout << "{\\"status\\":\\"ok\\",\\"type\\":\\"bool\\",\\"value\\":" << (result.value != 0 ? "true" : "false") << "}\\n";',
    );
  } else {
    lines.push(
      '        std::cout << "{\\"status\\":\\"ok\\",\\"type\\":\\"i32\\",\\"value\\":" << result.value << "}\\n";',
    );
  }
  lines.push("        return 0;");
  lines.push("    }");
  lines.push(
    `    const char* errorCode = result.code == ${INDEX_FAILURE_CODE} ? "E_INDEX" : "E_OVERFLOW";`,
  );
  lines.push(
    '    std::cout << "{\\"status\\":\\"error\\",\\"code\\":\\"" << errorCode << "\\",\\"node\\":" << result.node << "}\\n";',
  );
  lines.push("    return 1;");
  lines.push("}");
  return lines.join("\n");
}

/** Records are emitted in dependency order because C++ fields are by value. */
function orderRecords(records: RecordMap): RecordInfo[] {
  const ordered: RecordInfo[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (record: RecordInfo): void => {
    if (done.has(record.name) || visiting.has(record.name)) return;
    visiting.add(record.name);
    for (const field of record.fields) {
      const nested = records.get(field.type);
      if (nested) visit(nested);
    }
    visiting.delete(record.name);
    done.add(record.name);
    ordered.push(record);
  };
  for (const record of records.values()) visit(record);
  return ordered;
}

function defaultInit(
  type: TypeName,
  records: RecordMap,
  dialect: Dialect,
  variants: VariantMap,
): string {
  if (type === "string") return dialect.emptyString();
  if (isListTypeName(type)) return dialect.emptyList();
  if (isPrimitiveTypeName(type)) return "0";
  const record = records.get(type);
  if (record) return `${record.targetName}()`;
  const variant = variants.get(type);
  if (variant) return `${variant.targetName}()`;
  return "0";
}

function payloadField(targetName: string): string {
  return `${targetName.slice(0, 1).toLowerCase()}${targetName.slice(1)}`;
}

/**
 * Emits an ASCII-only C++ string literal. The value is encoded as UTF-8 bytes
 * and every non-printable or non-ASCII byte becomes a three-digit octal escape,
 * so the generated source does not depend on the compiler's source charset.
 */
function cppStringLiteral(value: string): string {
  let result = '"';
  for (const byte of Buffer.from(value, "utf8")) {
    if (byte === 0x5c) {
      result += "\\\\";
    } else if (byte === 0x22) {
      result += '\\"';
    } else if (byte === 0x0a) {
      result += "\\n";
    } else if (byte === 0x0d) {
      result += "\\r";
    } else if (byte === 0x09) {
      result += "\\t";
    } else if (byte >= 0x20 && byte <= 0x7e) {
      result += String.fromCharCode(byte);
    } else {
      result += `\\${byte.toString(8).padStart(3, "0")}`;
    }
  }
  return `${result}"`;
}

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? prefix + line : line))
    .join("\n");
}
