import type { GeneratedProject } from "../contracts/interfaces";
import type { FunctionSignature, TypedProgram } from "../contracts/outcome";
import { INDEX_FAILURE_CODE } from "../contracts/outcome";
import { isPrimitiveTypeName } from "../contracts/tokens";
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

export function emitJava(
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
    target: "java",
    intType: "int",
    stringType: "String",
    intMinLiteral: "Integer.MIN_VALUE",
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
    resOk: (expr) => `Res.ok(${expr})`,
    resOkRecord: (_record, expr) => `Res.okRecord(${expr})`,
    resRecordValue: (expr, record) => `((${record.targetName}) ${expr}.payload)`,
    resOkVariant: (_variant, expr) => `Res.okRecord(${expr})`,
    resVariantValue: (expr, variant) => `((${variant.targetName}) ${expr}.payload)`,
    resOkString: (expr) => `Res.okRecord(${expr})`,
    resStringValue: (expr) => `((String) ${expr}.payload)`,
    stringLiteral: quoteString,
    stringValue: (expr) => expr,
    emptyString: () => `""`,
    valueEquals: (left, right, type) =>
      type === "string" ? `${left}.equals(${right})` : `${left} == ${right}`,
    resFail: (code, node) => `Res.fail(${code}, ${node})`,
    checked: (op, args, node) => `${op}(${[...args, String(node)].join(", ")})`,
    call: (fn, args) => `${fn}(${args.join(", ")})`,
    recordLiteral: (record, values) => `new ${record.targetName}(${values.join(", ")})`,
    fieldAccess: (target, record, index) => `${target}.${record.fields[index].targetName}()`,
    fieldEquals: (left, right, record, index) => {
      const field = record.fields[index];
      const leftField = `${left}.${field.targetName}()`;
      const rightField = `${right}.${field.targetName}()`;
      return isPrimitiveTypeName(field.type) && field.type !== "string"
        ? `${leftField} == ${rightField}`
        : `${leftField}.equals(${rightField})`;
    },
    constructVariant: (variant, alternative, values) => {
      if (variant.builtin?.kind === "result") {
        const isErr = alternative.payload[0] === "string";
        return `new ${variant.targetName}(${alternative.tag}, ${isErr ? "0" : values[0] ?? "0"}, ${
          isErr ? values[0] ?? '""' : '""'
        })`;
      }
      return `new ${variant.targetName}(${[
        String(alternative.tag),
        ...values,
        ...Array(Math.max(0, variant.maxArity - values.length)).fill("0"),
      ].join(", ")})`;
    },
    variantTag: (expr) => `${expr}.tag`,
    variantValue: (expr) => expr,
    variantPayload: (expr, variant, alternative, index) =>
      variant.builtin?.kind === "result" && alternative.payload[0] === "string"
        ? `${expr}.s1`
        : `${expr}.p${index + 1}`,
    variantEquals: (left, right, variant) => {
      if (variant.builtin?.kind === "result") {
        const okTag = variant.alternatives.find((alternative) => alternative.name === "ok")?.tag ?? 0;
        return `(${left}.tag == ${right}.tag && (${left}.tag == ${okTag} ? ${left}.p1 == ${right}.p1 : ${left}.s1.equals(${right}.s1)))`;
      }
      return variant.maxArity === 0
        ? `${left}.tag == ${right}.tag`
        : `(${left}.tag == ${right}.tag && ${Array.from(
            { length: variant.maxArity },
            (_unused, index) => `${left}.p${index + 1} == ${right}.p${index + 1}`,
          ).join(" && ")})`;
    },
    listType: (element) => `${element}[]`,
    listLiteral: (values) => `new int[] { ${values.join(", ")} }`,
    emptyList: () => `new int[] {}`,
    listValue: (expr) => expr,
    listLength: (expr) => `${expr}.length`,
    listIndex: (list, index, node) => `index(${list}, ${index}, ${node})`,
    listEquals: (left, right) => `listEquals(${left}, ${right})`,
    resOkList: (expr) => `Res.okRecord(${expr})`,
    resListValue: (expr) => `((int[]) ${expr}.payload)`,
  };

  const recordDeclarations = renderRecords(records, dialect, variants);
  const variantDeclarations = renderVariants(variants, dialect);
  const functions = program.functions
    .map((signature) => renderFunction(program, signature, dialect, records, variants))
    .join("\n\n");

  const main = renderMain(entry);
  const source = `// Generated by h# ${COMPILER_VERSION} (core ${CORE_VERSION}). Do not edit.
public final class HsProgram {
    private static final class Res {
        final boolean ok;
        final int value;
        final Object payload;
        final int code;
        final int node;

        private Res(boolean ok, int value, Object payload, int code, int node) {
            this.ok = ok;
            this.value = value;
            this.payload = payload;
            this.code = code;
            this.node = node;
        }

        static Res ok(int value) {
            return new Res(true, value, null, 0, 0);
        }

        static Res okRecord(Object payload) {
            return new Res(true, 0, payload, 0, 0);
        }

        static Res fail(int code, int node) {
            return new Res(false, 0, null, code, node);
        }
    }

${recordDeclarations}

${variantDeclarations}

    private static Res add(int a, int b, int node) {
        long r = (long) a + (long) b;
        if (r < -2147483648L || r > 2147483647L) return Res.fail(1, node);
        return Res.ok((int) r);
    }

    private static Res sub(int a, int b, int node) {
        long r = (long) a - (long) b;
        if (r < -2147483648L || r > 2147483647L) return Res.fail(1, node);
        return Res.ok((int) r);
    }

    private static Res mul(int a, int b, int node) {
        long r = (long) a * (long) b;
        if (r < -2147483648L || r > 2147483647L) return Res.fail(1, node);
        return Res.ok((int) r);
    }

    private static Res neg(int a, int node) {
        long r = -(long) a;
        if (r < -2147483648L || r > 2147483647L) return Res.fail(1, node);
        return Res.ok((int) r);
    }

    private static Res index(int[] list, int index, int node) {
        if (index < 0 || index >= list.length) return Res.fail(${INDEX_FAILURE_CODE}, node);
        return Res.ok(list[index]);
    }

    private static boolean listEquals(int[] left, int[] right) {
        if (left.length != right.length) return false;
        for (int i = 0; i < left.length; i++) {
            if (left[i] != right[i]) return false;
        }
        return true;
    }

${functions}

${main}
}
`;

  return {
    target: "java",
    files: [{ path: "HsProgram.java", content: source }],
    build: ["javac", "-encoding", "UTF-8", "-d", "bin", "HsProgram.java"],
    run: ["java", "-cp", "bin", "HsProgram"],
  };
}

function renderRecords(records: RecordMap, dialect: Dialect, variants: VariantMap): string {
  return [...records.values()]
    .map((record) => {
      const components = record.fields
        .map((field) => `${targetType(field.type, records, dialect.intType, dialect.stringType, dialect.listType, variants)} ${field.targetName}`)
        .join(", ");
      return `    private record ${record.targetName}(${components}) {}`;
    })
    .join("\n\n");
}

function renderVariants(variants: VariantMap, dialect: Dialect): string {
  return [...variants.values()]
    .map((variant) => {
      if (variant.builtin?.kind === "result") {
        const fields = ["tag", "p1", "s1"];
        const types = [dialect.intType, dialect.intType, dialect.stringType];
        const lines = [
          `    private static final class ${variant.targetName} {`,
          ...fields.map((field, index) => `        final ${types[index]} ${field};`),
          "",
          `        ${variant.targetName}(${fields.map((field, index) => `${types[index]} ${field}`).join(", ")}) {`,
          ...fields.map((field) => `            this.${field} = ${field};`),
          "        }",
          "    }",
        ];
        return lines.join("\n");
      }
      const fields = ["tag", ...Array.from({ length: variant.maxArity }, (_unused, index) => `p${index + 1}`)];
      const lines = [
        `    private static final class ${variant.targetName} {`,
        ...fields.map((field) => `        final ${dialect.intType} ${field};`),
        "",
        `        ${variant.targetName}(${fields.map((field) => `${dialect.intType} ${field}`).join(", ")}) {`,
        ...fields.map((field) => `            this.${field} = ${field};`),
        "        }",
        "    }",
      ];
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
    .map((param) => `${targetType(param.type.name, records, dialect.intType, dialect.stringType, dialect.listType, variants)} ${param.targetName}`)
    .join(", ");
  const body = emitFunctionBody(fn, dialect, records, variants);
  return `    private static Res ${signature.targetName}(${parameters}) {\n${indent(body, 8)}\n    }`;
}

function renderMain(entry: FunctionSignature): string {
  const params = entry.params;
  const lines: string[] = [];
  lines.push("    private static void badArgs() {");
  lines.push('        System.out.println("{\\"status\\":\\"badargs\\"}");');
  lines.push("        System.exit(2);");
  lines.push("    }");
  lines.push("");
  lines.push("    public static void main(String[] args) {");
  lines.push(`        if (args.length != ${params.length}) {`);
  lines.push("            badArgs();");
  lines.push("            return;");
  lines.push("        }");
  params.forEach((param, index) => {
    const name = `p${index}`;
    if (param.type === "i32") {
      lines.push(`        int ${name};`);
      lines.push("        try {");
      lines.push(`            ${name} = Integer.parseInt(args[${index}]);`);
      lines.push("        } catch (NumberFormatException error) {");
      lines.push("            badArgs();");
      lines.push("            return;");
      lines.push("        }");
    } else {
      lines.push(`        int ${name};`);
      lines.push(`        if (args[${index}].equals("true")) ${name} = 1;`);
      lines.push(`        else if (args[${index}].equals("false")) ${name} = 0;`);
      lines.push("        else {");
      lines.push("            badArgs();");
      lines.push("            return;");
      lines.push("        }");
    }
  });
  lines.push(
    `        Res result = ${entry.targetName}(${params.map((_, i) => `p${i}`).join(", ")});`,
  );
  lines.push("        if (result.ok) {");
  if (entry.returnType === "bool") {
    lines.push(
      '            System.out.println("{\\"status\\":\\"ok\\",\\"type\\":\\"bool\\",\\"value\\":" + (result.value != 0 ? "true" : "false") + "}");',
    );
  } else {
    lines.push(
      '            System.out.println("{\\"status\\":\\"ok\\",\\"type\\":\\"i32\\",\\"value\\":" + result.value + "}");',
    );
  }
  lines.push("            System.exit(0);");
  lines.push("        } else {");
  lines.push(
    '            String errorCode = result.code == ' + INDEX_FAILURE_CODE + ' ? "E_INDEX" : "E_OVERFLOW";',
  );
  lines.push(
    '            System.out.println("{\\"status\\":\\"error\\",\\"code\\":\\"" + errorCode + "\\",\\"node\\":" + result.node + "}");',
  );
  lines.push("            System.exit(1);");
  lines.push("        }");
  lines.push("    }");
  return lines.join("\n");
}

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? prefix + line : line))
    .join("\n");
}
