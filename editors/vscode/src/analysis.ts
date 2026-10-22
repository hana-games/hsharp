import * as vscode from "vscode";
import { TARGET_IDS } from "../../../src/contracts/interfaces";
import type { Diagnostic } from "../../../src/contracts/diagnostics";
import { HSharpAnalyzer } from "../../../src/service/analyzer";
import type { AnalyzeResponse } from "../../../src/service/protocol";
import type { ProfileProvider } from "./profile";

export interface AnalyzeEvent {
  document: vscode.TextDocument;
  response: AnalyzeResponse;
}

/**
 * One analysis per edit: diagnostics, status, and all four generated targets
 * are produced together. The bundled compiler runs in the extension host, so
 * this avoids a subprocess round-trip.
 */
export class AnalysisController implements vscode.Disposable {
  readonly onDidAnalyze = new vscode.EventEmitter<AnalyzeEvent>();

  private readonly analyzer = new HSharpAnalyzer();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("hsharp");
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly last = new Map<string, AnalyzeResponse>();
  private readonly disposables: vscode.Disposable[] = [];
  private nextId = 1;

  constructor(private readonly profiles: ProfileProvider) {
    this.status.command = "hsharp.showPreview";
    this.status.name = "h#";

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (isHSharp(document)) this.analyzeNow(document);
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (isHSharp(event.document)) this.schedule(event.document);
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (isHSharp(document)) this.analyzeNow(document);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        const key = document.uri.toString();
        const timer = this.timers.get(key);
        if (timer) clearTimeout(timer);
        this.timers.delete(key);
        this.diagnostics.delete(document.uri);
        this.last.delete(key);
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.onActiveEditor(editor)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("hsharp")) return;
        this.profiles.invalidate();
        const config = this.config();
        if (!config.get<boolean>("diagnostics", true)) {
          this.diagnostics.clear();
        }
        for (const document of vscode.workspace.textDocuments) {
          if (isHSharp(document)) this.analyzeNow(document);
        }
        this.onActiveEditor(vscode.window.activeTextEditor);
      }),
    );

    for (const document of vscode.workspace.textDocuments) {
      if (isHSharp(document)) this.analyzeNow(document);
    }
    this.onActiveEditor(vscode.window.activeTextEditor);
  }

  analyzeNow(document: vscode.TextDocument): AnalyzeResponse | undefined {
    if (!isHSharp(document)) return undefined;
    const key = document.uri.toString();
    const pending = this.timers.get(key);
    if (pending) {
      clearTimeout(pending);
      this.timers.delete(key);
    }

    const config = this.config();
    const profilePath = this.profiles.resolvePath(config.get<string>("profilePath", ""));
    const entry = config.get<string>("entry", "").trim();

    let response: AnalyzeResponse;
    try {
      response = this.analyzer.analyze({
        id: this.nextId++,
        command: "analyze",
        text: document.getText(),
        file: document.fileName,
        profilePath,
        entry: entry.length > 0 ? entry : undefined,
        targets: [...TARGET_IDS],
      });
    } catch (cause) {
      response = {
        id: this.nextId++,
        ok: false,
        command: "analyze",
        compilerVersion: "0.1.0",
        coreVersion: "0.1",
        diagnostics: [
          {
            code: "E_INTERNAL",
            severity: "error",
            message: `h# analysis failed: ${(cause as Error).message}`,
          },
        ],
        functions: [],
        timings: { parseMs: 0, checkMs: 0, entryMs: 0, emitMs: 0, totalMs: 0 },
      };
    }

    this.last.set(key, response);
    this.applyDiagnostics(document, response);
    if (vscode.window.activeTextEditor?.document.uri.toString() === key) {
      this.updateStatus(response);
    }
    this.onDidAnalyze.fire({ document, response });
    return response;
  }

  getLast(document: vscode.TextDocument): AnalyzeResponse | undefined {
    return this.last.get(document.uri.toString());
  }

  private schedule(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const pending = this.timers.get(key);
    if (pending) clearTimeout(pending);

    const configured = this.config().get<number>("debounceMs", 120);
    const delay = Math.max(30, Math.min(2000, Number.isFinite(configured) ? configured : 120));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        if (!document.isClosed) this.analyzeNow(document);
      }, delay),
    );
  }

  private applyDiagnostics(document: vscode.TextDocument, response: AnalyzeResponse): void {
    if (!this.config().get<boolean>("diagnostics", true)) {
      this.diagnostics.delete(document.uri);
      return;
    }

    const textLength = document.getText().length;
    const items = response.diagnostics.map((diagnostic) => {
      const range = diagnosticRange(document, diagnostic, textLength);
      const message = diagnostic.hint
        ? `${diagnostic.message}\n\n${diagnostic.hint}`
        : diagnostic.message;
      const item = new vscode.Diagnostic(
        range,
        message,
        diagnostic.severity === "warning"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Error,
      );
      item.code = diagnostic.code;
      item.source = "h#";
      return item;
    });

    this.diagnostics.set(document.uri, items);
  }

  private updateStatus(response: AnalyzeResponse): void {
    const errors = response.diagnostics.filter((diagnostic) => diagnostic.severity !== "warning").length;
    if (errors > 0) {
      this.status.text = `$(error) h# ${errors} error${errors === 1 ? "" : "s"}`;
      this.status.tooltip = "h# diagnostics — click to open generated-code preview";
    } else {
      this.status.text = `$(check) h# ${(response.timings?.totalMs ?? 0).toFixed(2)} ms`;
      this.status.tooltip =
        `h# analysis + four-target generation\n` +
        `parse ${response.timings?.parseMs ?? 0} ms · check ${response.timings?.checkMs ?? 0} ms · ` +
        `emit ${response.timings?.emitMs ?? 0} ms`;
    }
    this.status.show();
  }

  private onActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      const hsharpVisible = vscode.window.visibleTextEditors.some(
        (visible) => visible.document.languageId === "hsharp",
      );
      if (!hsharpVisible) this.status.hide();
      return;
    }
    if (editor.document.languageId !== "hsharp") {
      this.status.hide();
      return;
    }

    const cached = this.last.get(editor.document.uri.toString());
    if (cached) this.updateStatus(cached);
    else this.analyzeNow(editor.document);
  }

  private config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("hsharp");
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.onDidAnalyze.dispose();
    this.diagnostics.dispose();
    this.status.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}

function isHSharp(document: vscode.TextDocument): boolean {
  return document.languageId === "hsharp";
}

function diagnosticRange(
  document: vscode.TextDocument,
  diagnostic: Diagnostic,
  textLength: number,
): vscode.Range {
  const startOffset = Math.max(0, Math.min(diagnostic.span?.start.offset ?? 0, textLength));
  const rawEnd = diagnostic.span?.end.offset ?? startOffset;
  let endOffset = Math.max(startOffset, Math.min(rawEnd, textLength));
  if (endOffset === startOffset && startOffset < textLength) endOffset = startOffset + 1;
  return new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset));
}
