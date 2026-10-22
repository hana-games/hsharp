import type { KeywordRole } from "./tokens";

export interface Profile {
  id: string;
  version: string;
  core: string;
  family: string;
  keywords: Record<KeywordRole, string>;
  /** Absolute or repository-relative path the profile was loaded from. */
  path?: string;
}

export interface LoadedProfile {
  profile: Profile;
  /** Raw bytes/text used to compute the fingerprint. */
  text: string;
  fingerprint: string;
}
