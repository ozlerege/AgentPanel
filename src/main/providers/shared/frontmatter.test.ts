import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("splits fields and body", () => {
    const result = parseFrontmatter(
      "---\nname: a\ndescription: b\n---\n\nBody text\n",
    );
    expect(result.fields).toEqual({ name: "a", description: "b" });
    expect(result.body).toBe("\nBody text\n");
    expect(result.diagnostics).toEqual([]);
  });

  it("returns the whole source as body when there is no frontmatter", () => {
    const result = parseFrontmatter("Just text\n");
    expect(result.fields).toEqual({});
    expect(result.body).toBe("Just text\n");
    expect(result.diagnostics).toEqual([]);
  });

  it("flags unterminated frontmatter", () => {
    const result = parseFrontmatter("---\nname: a\n");
    expect(result.diagnostics).toEqual([
      { severity: "error", message: "Unterminated YAML frontmatter" },
    ]);
  });

  it("flags invalid YAML as an error", () => {
    const result = parseFrontmatter(
      "---\nname: [unclosed\ndescription: b\n---\nBody\n",
    );
    expect(result.fields).toEqual({});
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain(
      "Invalid frontmatter YAML",
    );
  });

  it("flags non-mapping frontmatter with a warning", () => {
    const result = parseFrontmatter("---\n- just\n- a list\n---\nBody\n");
    expect(result.fields).toEqual({});
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        message: "Frontmatter is not a key-value mapping",
      },
    ]);
  });
});
