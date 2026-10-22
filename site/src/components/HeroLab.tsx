import { useState, type CSSProperties } from "react";
import type { DemoData, TargetId } from "../data/types";
import { targets } from "../lib/site";
import { CodeBlock } from "./CodeBlock";

interface Props {
  demo: DemoData;
  initialProfile?: string;
  initialTarget?: TargetId;
}

const mainFile: Record<TargetId, string> = {
  csharp: "Program.cs",
  rust: "src/main.rs",
  go: "main.go",
  java: "HsProgram.java",
};

export function HeroLab({ demo, initialProfile = "my-syntax", initialTarget = "csharp" }: Props) {
  const [profileId, setProfileId] = useState(initialProfile);
  const [targetId, setTargetId] = useState<TargetId>(initialTarget);

  const source = demo.sources[profileId] ?? demo.sources.standard;
  const target = demo.targets[targetId];
  const file = target.files.find((item) => item.path === mainFile[targetId]) ?? target.files[0];
  if (!file) return null;
  const outcome = JSON.stringify(demo.outcome);

  return (
    <div className="hero-lab">
      <div className="hero-lab-toolbar">
        <div className="tabs" aria-label="Syntax profile">
          {Object.values(demo.sources).map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={`tab ${profile.id === profileId ? "active" : ""}`}
              onClick={() => setProfileId(profile.id)}
            >
              {profile.label}
            </button>
          ))}
        </div>
        <span className="index">source</span>
      </div>
      <div className="swap" key={`source-${profileId}`}>
        <CodeBlock
          code={source.code}
          language="hsharp"
          keywords={source.keywords}
          title="calculate.hs"
          meta={source.label}
          maxHeight="245px"
        />
      </div>

      <div className="hero-lab-toolbar" style={{ marginTop: "0.7rem", borderRadius: "10px 10px 0 0" }}>
        <div className="hero-lab-targets" aria-label="Generated target">
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              className={`tab ${target.id === targetId ? "active" : ""}`}
              data-target={target.id}
              style={{ "--target": target.color } as CSSProperties}
              onClick={() => setTargetId(target.id)}
            >
              {target.label}
            </button>
          ))}
        </div>
        <span className="index">generated</span>
      </div>
      <div className="swap" key={`target-${targetId}`}>
        <CodeBlock
          code={file.content}
          language={targetId}
          title={file.path}
          meta={target.label}
          maxHeight="245px"
        />
      </div>

      <div className="hero-outcome">
        <span>
          calculate(10, true) <span aria-hidden="true">→</span> <strong>{outcome}</strong>
        </span>
        <span>{target.files.length} file{target.files.length === 1 ? "" : "s"} · same typed AST</span>
      </div>
    </div>
  );
}
