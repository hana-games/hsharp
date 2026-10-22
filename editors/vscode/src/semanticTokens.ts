import * as vscode from "vscode";
import { lex } from "../../../src/frontend/lexer";
import type { ProfileProvider } from "./profile";

export const hsharpSemanticLegend = new vscode.SemanticTokensLegend(["keyword", "type"], []);

export class HSharpSemanticTokensProvider
  implements vscode.DocumentSemanticTokensProvider, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly subscription: vscode.Disposable;

  readonly onDidChangeSemanticTokens = this.changed.event;

  constructor(private readonly profiles: ProfileProvider) {
    this.subscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("hsharp.profilePath")) this.changed.fire();
    });
  }

  provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): vscode.SemanticTokens {
    try {
      const profilePath = vscode.workspace.getConfiguration("hsharp").get<string>("profilePath", "");
      const profile = this.profiles.get(profilePath);
      const lexed = lex(document.getText(), profile, document.fileName);
      const builder = new vscode.SemanticTokensBuilder(hsharpSemanticLegend);

      for (const item of lexed.tokens) {
        if (token.isCancellationRequested) break;
        if (item.kind !== "keyword" && item.kind !== "type") continue;
        builder.push(
          new vscode.Range(
            item.span.start.line - 1,
            item.span.start.column - 1,
            item.span.end.line - 1,
            item.span.end.column - 1,
          ),
          item.kind === "keyword" ? "keyword" : "type",
        );
      }

      return builder.build();
    } catch {
      return new vscode.SemanticTokens(new Uint32Array(0));
    }
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }
}
