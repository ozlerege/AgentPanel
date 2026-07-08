import { parseDocument } from "yaml";
import type { Diagnostic } from "../../../shared/resource";

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;

export interface FrontmatterResult {
  fields: Record<string, unknown>;
  body: string;
  diagnostics: Diagnostic[];
}

/**
 * Split optional YAML frontmatter from a Markdown document. Content problems
 * become diagnostics, never exceptions.
 */
export function parseFrontmatter(source: string): FrontmatterResult {
  const match = FRONTMATTER.exec(source);
  if (!match) {
    return {
      fields: {},
      body: source,
      diagnostics: source.startsWith("---\n")
        ? [{ severity: "error", message: "Unterminated YAML frontmatter" }]
        : [],
    };
  }
  const body = source.slice(match[0].length);
  const doc = parseDocument(match[1]);
  if (doc.errors.length > 0) {
    return {
      fields: {},
      body,
      diagnostics: [
        {
          severity: "error",
          message: `Invalid frontmatter YAML: ${doc.errors[0].message}`,
        },
      ],
    };
  }
  const value: unknown = doc.toJS();
  if (value === null || value === undefined) {
    return { fields: {}, body, diagnostics: [] };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      fields: {},
      body,
      diagnostics: [
        {
          severity: "warning",
          message: "Frontmatter is not a key-value mapping",
        },
      ],
    };
  }
  return { fields: value as Record<string, unknown>, body, diagnostics: [] };
}
