import { emitCsharp } from "./csharp";
import { emitGo } from "./go";
import { emitJava } from "./java";
import { emitRust } from "./rust";
import type { GeneratedProject, TargetId } from "../contracts/interfaces";
import type { TypedProgram } from "../contracts/outcome";

export function emit(program: TypedProgram, target: TargetId, entry: string): GeneratedProject {
  switch (target) {
    case "csharp":
      return emitCsharp(program, entry);
    case "rust":
      return emitRust(program, entry);
    case "go":
      return emitGo(program, entry);
    case "java":
      return emitJava(program, entry);
  }
}
