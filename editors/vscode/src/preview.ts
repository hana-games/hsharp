import * as vscode from "vscode";
import { TARGET_IDS, type TargetId } from "../../../src/contracts/interfaces";
import type { AnalyzeResponse } from "../../../src/service/protocol";
import type { AnalysisController } from "./analysis";

const TARGET_LABELS: Record<TargetId, string> = {
  csharp: "C#",
  rust: "Rust",
  go: "Go",
  java: "Java",
  cpp: "C++",
  javascript: "JavaScript",
};

export class PreviewPanel implements vscode.Disposable {
  private static current: PreviewPanel | undefined;

  static show(controller: AnalysisController): void {
    if (PreviewPanel.current) {
      PreviewPanel.current.panel.reveal(undefined, true);
      PreviewPanel.current.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "hsharp.preview",
      "h# Generated Code",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    PreviewPanel.current = new PreviewPanel(panel, controller);
  }

  private readonly disposables: vscode.Disposable[] = [];
  private document: vscode.TextDocument | undefined;
  private last: AnalyzeResponse | undefined;
  private target: TargetId;
  private disposed = false;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly controller: AnalysisController,
  ) {
    const configured = vscode.workspace.getConfiguration("hsharp").get<string>("previewTarget", "csharp");
    this.target = isTarget(configured) ? configured : "csharp";
    panel.webview.html = this.html(panel.webview);

    this.disposables.push(
      panel.webview.onDidReceiveMessage((message) => this.onMessage(message)),
      panel.onDidDispose(() => this.onPanelDisposed()),
      controller.onDidAnalyze.event((event) => {
        if (!this.document || event.document.uri.toString() !== this.document.uri.toString()) return;
        this.last = event.response;
        this.post();
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.follow(editor?.document)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("hsharp.previewTarget")) {
          const value = vscode.workspace.getConfiguration("hsharp").get<string>("previewTarget", "csharp");
          if (isTarget(value)) this.target = value;
        }
        if (event.affectsConfiguration("hsharp")) this.post();
      }),
    );

    this.follow(vscode.window.activeTextEditor?.document);
  }

  private follow(document: vscode.TextDocument | undefined): void {
    if (!document) {
      const hsharpVisible = vscode.window.visibleTextEditors.some(
        (editor) => editor.document.languageId === "hsharp",
      );
      if (hsharpVisible) return;
      this.document = undefined;
      this.last = undefined;
      this.post();
      return;
    }

    if (document.languageId !== "hsharp") {
      this.document = undefined;
      this.last = undefined;
      this.post();
      return;
    }

    if (this.document?.uri.toString() !== document.uri.toString()) {
      this.document = document;
      this.last = this.controller.getLast(document);
    }
    if (this.last) this.post();
    else this.controller.analyzeNow(document);
  }

  private refresh(): void {
    if (this.document) this.controller.analyzeNow(this.document);
    else this.post();
  }

  private onMessage(message: unknown): void {
    if (message === null || typeof message !== "object") return;
    const record = message as Record<string, unknown>;

    if (record.type === "ready") {
      this.post();
      return;
    }

    if (record.type === "target" && typeof record.target === "string" && isTarget(record.target)) {
      this.target = record.target;
      void vscode.workspace
        .getConfiguration("hsharp")
        .update("previewTarget", this.target, vscode.ConfigurationTarget.Global);
      this.post();
    }
  }

  private post(): void {
    const targets = TARGET_IDS.map((id) => ({ id, label: TARGET_LABELS[id] }));

    if (!this.document) {
      void this.panel.webview.postMessage({
        type: "update",
        targets,
        selected: this.target,
        status: "Open an h# (.hs) file to preview generated code.",
        diagnostics: "",
        code: "",
      });
      return;
    }

    const response = this.last;
    if (!response) {
      void this.panel.webview.postMessage({
        type: "update",
        targets,
        selected: this.target,
        status: `Waiting for analysis — ${this.document.fileName}`,
        diagnostics: "",
        code: "",
      });
      return;
    }

    const errors = response.diagnostics.filter((item) => item.severity !== "warning").length;
    const timing = (response.timings?.totalMs ?? 0).toFixed(2);
    const targetLabel = TARGET_LABELS[this.target];
    const entry = response.entry ?? "no entry";
    const statusParts = [
      targetLabel,
      entry,
      `${timing} ms`,
      `${response.functions.length} function${response.functions.length === 1 ? "" : "s"}`,
    ];
    if (errors > 0) statusParts.push(`${errors} error${errors === 1 ? "" : "s"}`);
    if (response.entryError) statusParts.push(response.entryError);

    const generated = response.generated?.find((target) => target.target === this.target);
    let code = "";
    if (generated) {
      code = generated.files
        .map((file) => `// ── ${file.path} ─────────────────────────────────────────\n${file.content}`)
        .join("\n");
    } else if (response.diagnostics.length === 0) {
      code = "No generated code for this target. Select an entry function and resolve errors.";
    }

    const diagnostics = response.diagnostics
      .map((item) => {
        const location = item.span
          ? `${item.span.start.line}:${item.span.start.column} `
          : "";
        const hint = item.hint ? `\n  hint: ${item.hint}` : "";
        return `${location}${item.severity} ${item.code}: ${item.message}${hint}`;
      })
      .join("\n");

    void this.panel.webview.postMessage({
      type: "update",
      targets,
      selected: this.target,
      status: statusParts.join(" · "),
      diagnostics,
      code,
    });
  }

  private onPanelDisposed(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const disposable of this.disposables) disposable.dispose();
    PreviewPanel.current = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const disposable of this.disposables) disposable.dispose();
    PreviewPanel.current = undefined;
    this.panel.dispose();
  }

  private html(webview: vscode.Webview): string {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const initialTarget = JSON.stringify(this.target);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>h# Generated Code</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    padding: 0;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  header {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    position: sticky;
    top: 0;
    z-index: 2;
  }
  select {
    color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
    padding: 3px 6px;
    font: inherit;
  }
  #status {
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #diagnostics {
    white-space: pre-wrap;
    padding: 8px 10px;
    color: var(--vscode-errorForeground);
    border-bottom: 1px solid var(--vscode-panel-border);
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
  }
  #code {
    margin: 0;
    padding: 10px;
    overflow: auto;
    white-space: pre;
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    line-height: 1.45;
    tab-size: 4;
  }
  #empty {
    padding: 18px;
    color: var(--vscode-descriptionForeground);
  }
</style>
</head>
<body>
<header>
  <label for="target">Target</label>
  <select id="target"></select>
  <span id="status">Loading…</span>
</header>
<div id="diagnostics"></div>
<pre id="code"></pre>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const targetSelect = document.getElementById('target');
  const status = document.getElementById('status');
  const diagnostics = document.getElementById('diagnostics');
  const code = document.getElementById('code');
  const initialTarget = ${initialTarget};

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'update') return;

    targetSelect.innerHTML = '';
    for (const target of message.targets) {
      const option = document.createElement('option');
      option.value = target.id;
      option.textContent = target.label;
      targetSelect.appendChild(option);
    }
    targetSelect.value = message.selected;
    status.textContent = message.status;
    diagnostics.textContent = message.diagnostics;
    diagnostics.style.display = message.diagnostics ? 'block' : 'none';
    code.textContent = message.code;
  });

  targetSelect.addEventListener('change', () => {
    vscode.postMessage({ type: 'target', target: targetSelect.value });
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

function isTarget(value: string): value is TargetId {
  return (TARGET_IDS as readonly string[]).includes(value);
}
