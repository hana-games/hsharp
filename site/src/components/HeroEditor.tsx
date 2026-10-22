import { useEffect, useMemo, useState } from "react";
import type { DemoData, TargetId } from "../data/types";
import { targets } from "../lib/site";
import { tokenize } from "../lib/highlight";
import { useT } from "../i18n/runtime";

interface Props {
  demo: DemoData;
}

const mainFile: Record<TargetId, string> = {
  csharp: "Program.cs",
  rust: "src/main.rs",
  go: "main.go",
  java: "HsProgram.java",
};

const roleOrder = ["fn", "let", "if", "else", "return", "true", "false"] as const;
const canonical: Record<string, string> = {
  fn: "fn",
  let: "let",
  if: "if",
  else: "else",
  return: "return",
  true: "true",
  false: "false",
};

function EditorLines({
  code,
  language,
  keywords,
  maxLines,
}: {
  code: string;
  language: string;
  keywords: string[] | Record<string, string>;
  maxLines: number;
}) {
  const lines = code.replace(/\n$/, "").split("\n").slice(0, maxLines);
  return (
    <div className="editor-code" role="presentation">
      {lines.map((line, index) => (
        <div className="editor-line" key={`${index}-${line}`}>
          <span className="editor-line-number">{index + 1}</span>
          <span className="editor-line-code">
            {tokenize(line, language, keywords).map((token, tokenIndex) =>
              token.type === "plain" ? (
                token.text
              ) : (
                <span key={tokenIndex} className={`tok-${token.type}`}>
                  {token.text}
                </span>
              ),
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

export function HeroEditor({ demo }: Props) {
  const t = useT();
  const profileIds = Object.keys(demo.sources);
  const [profileIndex, setProfileIndex] = useState(1);
  const [targetIndex, setTargetIndex] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setProfileIndex((current) => (current + 1) % profileIds.length);
      setTargetIndex((current) => (current + 1) % targets.length);
    }, 3800);
    return () => window.clearInterval(timer);
  }, [playing, profileIds.length]);

  const profile = demo.sources[profileIds[profileIndex]] ?? demo.sources.standard;
  const targetId = targets[targetIndex].id;
  const target = demo.targets[targetId];
  const file = target.files.find((item) => item.path === mainFile[targetId]) ?? target.files[0];

  const mapping = useMemo(
    () =>
      roleOrder
        .map((role) => ({ role, word: profile.keywords[role] }))
        .filter(({ role, word }) => word !== canonical[role]),
    [profile],
  );

  if (!file) return null;

  function chooseProfile(index: number) {
    setProfileIndex(index);
    setPlaying(false);
  }

  function chooseTarget(index: number) {
    setTargetIndex(index);
    setPlaying(false);
  }

  return (
    <div className="fake-editor" aria-label="Live generated code preview">
      <div className="fake-editor-titlebar">
        <div className="fake-editor-file">
          <span className="fake-editor-mark">h#</span>
          <span>calculate.hs</span>
          <span className="fake-editor-branch">main</span>
        </div>
        <div className="fake-editor-live">
          <span className="live-dot" />
          {playing ? t("live") : t("paused")}
        </div>
        <button
          type="button"
          className="fake-editor-play"
          onClick={() => setPlaying((current) => !current)}
          aria-label={playing ? t("Pause automatic demo") : t("Resume automatic demo")}
        >
          {playing ? t("Pause") : t("Auto")}
        </button>
      </div>

      <div className="fake-editor-controls">
        <div className="fake-editor-profile-tabs" role="tablist" aria-label="Syntax profile">
          {Object.values(demo.sources).map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={index === profileIndex}
              className={`editor-pill ${index === profileIndex ? "active" : ""}`}
              onClick={() => chooseProfile(index)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="fake-editor-target-tabs" role="tablist" aria-label="Generated target">
          {targets.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={index === targetIndex}
              className={`editor-target ${index === targetIndex ? "active" : ""}`}
              data-target={item.id}
              onClick={() => chooseTarget(index)}
            >
              <img src={item.logo} alt="" width="14" height="14" />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fake-editor-body">
        <div className="editor-pane">
          <div className="editor-pane-head">
            <span>{t("your syntax")}</span>
            <span className="editor-pane-meta">{profile.label}</span>
          </div>
          <div key={`source-${profile.id}`} className="editor-swap">
            <EditorLines
              code={profile.code}
              language="hsharp"
              keywords={profile.keywords}
              maxLines={12}
            />
          </div>
        </div>

        <div className="editor-divider" aria-hidden="true">
          <span>→</span>
        </div>

        <div className="editor-pane">
          <div className="editor-pane-head">
            <span className="editor-pane-target">
              <img src={targets[targetIndex].logo} alt="" width="13" height="13" />
              {t("generated")}
            </span>
            <span className="editor-pane-meta">{file.path}</span>
          </div>
          <div key={`target-${targetId}-${profile.id}`} className="editor-swap">
            <EditorLines
              code={file.content}
              language={targetId}
              keywords={[]}
              maxLines={12}
            />
          </div>
        </div>
      </div>

      <div className="fake-editor-mapping">
        <span className="mapping-label">{t("syntax map")}</span>
        {mapping.length === 0 ? (
          <span className="mapping-chip">{t("canonical keywords")}</span>
        ) : (
          mapping.map(({ role, word }) => (
            <span className="mapping-chip" key={role}>
              <span>{role}</span>
              <b>→</b>
              <strong>{word}</strong>
            </span>
          ))
        )}
      </div>

      <div className="fake-editor-statusbar">
        <span className="status-ok">● {t("AST matched")}</span>
        <span>calculate(10, true) → 32</span>
        <span>{t("same core · four outputs")}</span>
      </div>
    </div>
  );
}
