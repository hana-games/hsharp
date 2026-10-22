import { useState, type CSSProperties } from "react";
import type { DemoData, TargetId } from "../data/types";
import { targets as targetMeta } from "../lib/site";
import { CodeBlock } from "./CodeBlock";

interface Props {
  demo: DemoData;
}

const notes: Record<TargetId, { title: string; body: string; details: string[] }> = {
  csharp: {
    title: "C# — explicit result records",
    body: "Widens to long, checks the i32 range, then narrows. The generated project is a normal .csproj.",
    details: ["int value + long checks", "readonly struct Res", "HsProgram.Main"],
  },
  rust: {
    title: "Rust — Result-shaped propagation",
    body: "The same semantic result record becomes a small Res struct with ok/fail constructors and checked helpers.",
    details: ["i32 value + i64 checks", "Res { ok, value, code, node }", "cargo build --release --offline"],
  },
  go: {
    title: "Go — structs and explicit failure",
    body: "int32 values with int64 intermediates. Failures return a Res value; no panic is used for overflow.",
    details: ["int32 value + int64 checks", "Res struct + ok/fail helpers", "go build"],
  },
  java: {
    title: "Java — nested result class",
    body: "int values with long intermediates and a nested Res class. No reflection, no runtime dependency.",
    details: ["int value + long checks", "nested static Res", "javac + java"],
  },
};

export function TargetPrism({ demo }: Props) {
  const [targetId, setTargetId] = useState<TargetId>("csharp");
  const [filePath, setFilePath] = useState("Program.cs");

  const target = demo.targets[targetId];
  const meta = targetMeta.find((item) => item.id === targetId) ?? targetMeta[0];
  const activeFile =
    target.files.find((file) => file.path === filePath) ??
    target.files.find((file) => !file.path.endsWith(".csproj") && !file.path.endsWith(".toml") && !file.path.endsWith(".mod")) ??
    target.files[0];
  const note = notes[targetId];

  function selectTarget(id: TargetId) {
    setTargetId(id);
    const next = demo.targets[id];
    const preferred = next.files.find(
      (file) => !file.path.endsWith(".csproj") && !file.path.endsWith(".toml") && !file.path.endsWith(".mod"),
    );
    setFilePath(preferred?.path ?? next.files[0]?.path ?? "");
  }

  return (
    <div className="lab">
      <div className="lab-head">
        <div className="lab-title">Target prism</div>
        <div className="tabs">
          {targetMeta.map((target) => (
            <button
              key={target.id}
              type="button"
              className={`tab ${target.id === targetId ? "active" : ""}`}
              data-target={target.id}
              style={{ "--target": target.color } as CSSProperties}
              onClick={() => selectTarget(target.id)}
            >
              {target.label}
            </button>
          ))}
        </div>
      </div>

      <div className="lab-body">
        <div className="prism">
          <div className="prism-side">
            <div className="prism-note" style={{ "--target": meta.color } as CSSProperties}>
              <h4>{note.title}</h4>
              <p>{note.body}</p>
            </div>

            <div className="prism-note">
              <h4>Generated names</h4>
              <p>
                Source names never reach the target. Functions and locals become <code>f1</code>, <code>v2</code>,
                so <code>int</code> or <code>class</code> in h# cannot collide with a host keyword.
              </p>
            </div>

            <div className="prism-note">
              <h4>Checked arithmetic</h4>
              <p>
                Every <code>+</code>, <code>-</code>, <code>*</code> and unary <code>-</code> widens to 64-bit,
                checks the i32 range, and returns <code>E_OVERFLOW</code> with the failing node.
              </p>
            </div>

            <div className="row">
              {note.details.map((detail) => (
                <span className="chip chip-dark" key={detail}>
                  {detail}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="tabs" style={{ marginBottom: "0.4rem" }}>
              {target.files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={`tab ${file.path === activeFile?.path ? "active" : ""}`}
                  onClick={() => setFilePath(file.path)}
                >
                  {file.path}
                </button>
              ))}
            </div>
            {activeFile && (
              <CodeBlock
                key={`${targetId}-${activeFile.path}`}
                code={activeFile.content}
                language={targetId}
                title={activeFile.path}
                meta={`${meta.label} · generated`}
                maxHeight="540px"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
