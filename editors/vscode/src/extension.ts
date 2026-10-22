import * as vscode from "vscode";
import { AnalysisController } from "./analysis";
import { ProfileProvider } from "./profile";
import { PreviewPanel } from "./preview";
import { HSharpSemanticTokensProvider, hsharpSemanticLegend } from "./semanticTokens";

export function activate(context: vscode.ExtensionContext): void {
  const profiles = new ProfileProvider();
  const controller = new AnalysisController(profiles);
  const tokens = new HSharpSemanticTokensProvider(profiles);

  context.subscriptions.push(
    controller,
    tokens,
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "hsharp" },
      tokens,
      hsharpSemanticLegend,
    ),
    vscode.commands.registerCommand("hsharp.showPreview", () => PreviewPanel.show(controller)),
  );
}

export function deactivate(): void {
  // Disposables registered in the extension context clean up automatically.
}
