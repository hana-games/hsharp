import { statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import * as vscode from "vscode";
import type { Profile } from "../../../src/contracts/profile";
import { loadProfileFile, STANDARD_PROFILE } from "../../../src/frontend/profile";

export class ProfileProvider {
  private cachedPath = "";
  private cachedWrite = -1;
  private cachedSize = -1;
  private cachedProfile: Profile = STANDARD_PROFILE;

  resolvePath(configured: string): string | undefined {
    const value = (configured ?? "").trim();
    if (!value) return undefined;
    if (isAbsolute(value)) return value;
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return folder ? join(folder, value) : value;
  }

  get(configured: string): Profile {
    const path = this.resolvePath(configured);
    if (!path) return STANDARD_PROFILE;

    try {
      const stat = statSync(path);
      if (path === this.cachedPath && stat.mtimeMs === this.cachedWrite && stat.size === this.cachedSize) {
        return this.cachedProfile;
      }

      const loaded = loadProfileFile(path);
      this.cachedPath = path;
      this.cachedWrite = stat.mtimeMs;
      this.cachedSize = stat.size;
      this.cachedProfile = loaded.loaded?.profile ?? STANDARD_PROFILE;
      return this.cachedProfile;
    } catch {
      return STANDARD_PROFILE;
    }
  }

  invalidate(): void {
    this.cachedPath = "";
    this.cachedWrite = -1;
    this.cachedSize = -1;
    this.cachedProfile = STANDARD_PROFILE;
  }
}
