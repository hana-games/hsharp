import type { Diagnostic } from "../contracts/diagnostics";
import { error } from "../contracts/diagnostics";
import type { Profile } from "../contracts/profile";
import type { SourceText } from "../contracts/tokens";
import { KEYWORD_ROLES } from "../contracts/tokens";

export interface ConvertResult {
  text: string;
  diagnostics: Diagnostic[];
}

/**
 * Re-prints a token stream, replacing only keyword tokens with the target
 * profile's word for the same role. Whitespace, comments, identifiers, types,
 * numbers, and punctuation are copied verbatim.
 */
export function convert(source: SourceText, _from: Profile, to: Profile): ConvertResult {
  const diagnostics: Diagnostic[] = [];
  const targetWords = new Map<string, string>();
  for (const role of KEYWORD_ROLES) {
    targetWords.set(to.keywords[role], role);
  }

  let output = "";
  for (const token of source.tokens) {
    if (token.kind === "keyword" && token.role) {
      output += to.keywords[token.role];
      continue;
    }
    if (token.kind === "identifier") {
      const role = targetWords.get(token.text);
      if (role !== undefined) {
        diagnostics.push(
          error(
            "E_PROFILE_IDENTIFIER_COLLISION",
            `identifier "${token.text}" collides with the keyword for "${role}" in profile "${to.id}"`,
            token.span,
            `rename the identifier or choose a different word for "${role}"`,
          ),
        );
      }
    }
    output += token.text;
  }

  return { text: output, diagnostics };
}
