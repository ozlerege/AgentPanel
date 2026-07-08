# Milestone 2: Read-only Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make discovery real — the Codex and Claude adapters scan user-level and registered-project resources (agents, skills, commands, MCP servers, instructions), and the renderer lists, searches, filters, and inspects them with validation diagnostics, all read-only.

**Architecture:** Per-kind scanner modules under `src/main/providers/{shared,codex,claude}/` implement `discover`/`parse` behind the existing `ProviderAdapter` contract; a new `ResourceService` composes the registry and projects store and serves two new Zod-validated IPC channels (`resources:list`, `resources:read`). Scan-on-demand: no cache, no SQLite index; the renderer filters client-side. `read(id)` re-runs discovery and only parses resources discovery actually finds, so forged ids can never escape approved roots. Deviation from the spec's file sketch, per its own DRY principle: skills and instructions parsing is identical for both providers, so it lives once in `shared/skills.ts` and `shared/instructions.ts` (called by both adapters with a scope template) instead of per-provider wrapper files.

**Tech Stack:** Existing deps only — `toml-eslint-parser` (`parseTOML` + `getStaticTOMLValue`, verified working), `jsonc-parser` (`parse` with error collection), `yaml` (`parseDocument`), Zod 4, Vitest 4, React 19, Tailwind 4, shadcn-style components. Package manager: **bun**.

**Spec:** `docs/superpowers/specs/2026-07-08-milestone-2-read-only-discovery-design.md`

## Global Constraints

- Never use `any` in TypeScript (user rule). Use precise types or `unknown` + narrowing.
- Package manager is **bun** (`bun add`, `bun run`, `bunx`). Never npm/yarn/pnpm.
- Verification commands are `bun run typecheck` and `bun run test`. Do NOT run `bun run dev`. Do NOT run `bun run build` except in Task 12 (final launch verification), where it is explicitly authorized.
- Renderer never receives Node/fs access; no generic `readFile`/`writeFile` across the IPC bridge (spec §10.2).
- Adapter categories are data returned by `capabilities()` — the renderer must not hard-code category lists (spec §8.2).
- Content problems (malformed files, missing fields) become per-resource `Diagnostic`s, never exceptions; one broken resource must never fail a whole listing (design §5).
- Enabled state is `'unsupported'` for every M2 kind; row status derives from diagnostics.
- Discovery must be deterministic: all directory listings are sorted.
- Commit after every task with the trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Verified library facts (do not re-litigate): `getStaticTOMLValue` from `toml-eslint-parser` converts a parsed TOML AST to plain values; `jsonc-parser`'s `parse(text, errors, { allowTrailingComma: true })` collects `ParseError`s instead of throwing; `readdirSync(dir, { withFileTypes: true, recursive: true })` works on Node 24+ and `Dirent.parentPath` is available.

---

### Task 1: Shared discovery helpers — safe scanning and frontmatter

**Files:**

- Create: `src/main/providers/shared/scan.ts`
- Create: `src/main/providers/shared/scan.test.ts`
- Create: `src/main/providers/shared/frontmatter.ts`
- Create: `src/main/providers/shared/frontmatter.test.ts`

**Interfaces:**

- Consumes: `Diagnostic` from `src/shared/resource.ts`.
- Produces: from `scan.ts`: `listFiles(dir: string, extension: string): string[]`, `listFilesRecursive(dir: string, extension: string): string[]`, `listSubdirectories(dir: string): string[]`, `readTextFile(path: string): string | null`, `fileExists(path: string): boolean`, `fileModifiedAt(path: string): string`. From `frontmatter.ts`: `FrontmatterResult { fields: Record<string, unknown>; body: string; diagnostics: Diagnostic[] }`, `parseFrontmatter(source: string): FrontmatterResult`. Consumed by every scanner task (3–6).

- [ ] **Step 1: Write the failing tests `src/main/providers/shared/scan.test.ts`**

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fileExists,
  fileModifiedAt,
  listFiles,
  listFilesRecursive,
  listSubdirectories,
  readTextFile,
} from "./scan";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-control-scan-"));
  mkdirSync(join(root, "sub", "nested"), { recursive: true });
  writeFileSync(join(root, "a.md"), "A");
  writeFileSync(join(root, "b.txt"), "B");
  writeFileSync(join(root, "sub", "c.md"), "C");
  writeFileSync(join(root, "sub", "nested", "d.md"), "D");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("listFiles", () => {
  it("lists matching files directly in the directory, sorted", () => {
    expect(listFiles(root, ".md")).toEqual([join(root, "a.md")]);
  });

  it("returns [] for a missing directory", () => {
    expect(listFiles(join(root, "nope"), ".md")).toEqual([]);
  });
});

describe("listFilesRecursive", () => {
  it("lists matching files at any depth, sorted", () => {
    expect(listFilesRecursive(root, ".md")).toEqual([
      join(root, "a.md"),
      join(root, "sub", "c.md"),
      join(root, "sub", "nested", "d.md"),
    ]);
  });

  it("returns [] for a missing directory", () => {
    expect(listFilesRecursive(join(root, "nope"), ".md")).toEqual([]);
  });
});

describe("listSubdirectories", () => {
  it("lists direct subdirectories only", () => {
    expect(listSubdirectories(root)).toEqual([join(root, "sub")]);
  });

  it("returns [] for a missing directory", () => {
    expect(listSubdirectories(join(root, "nope"))).toEqual([]);
  });
});

describe("readTextFile", () => {
  it("reads file content", () => {
    expect(readTextFile(join(root, "a.md"))).toBe("A");
  });

  it("returns null for a missing file", () => {
    expect(readTextFile(join(root, "nope.md"))).toBeNull();
  });
});

describe("fileExists", () => {
  it("is true for a file, false for a directory or missing path", () => {
    expect(fileExists(join(root, "a.md"))).toBe(true);
    expect(fileExists(join(root, "sub"))).toBe(false);
    expect(fileExists(join(root, "nope"))).toBe(false);
  });
});

describe("fileModifiedAt", () => {
  it("returns a parseable ISO timestamp", () => {
    const iso = fileModifiedAt(join(root, "a.md"));
    expect(new Date(iso).getTime()).not.toBeNaN();
  });

  it("falls back to the epoch for a missing file", () => {
    expect(fileModifiedAt(join(root, "nope"))).toBe(new Date(0).toISOString());
  });
});
```

- [ ] **Step 2: Write the failing tests `src/main/providers/shared/frontmatter.test.ts`**

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./scan` / `./frontmatter`.

- [ ] **Step 4: Implement `src/main/providers/shared/scan.ts`**

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Files with the extension directly inside dir, sorted. Missing dir -> []. */
export function listFiles(dir: string, extension: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/** Files with the extension at any depth under dir, sorted. Missing dir -> []. */
export function listFilesRecursive(dir: string, extension: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/** Direct subdirectories of dir, sorted. Missing dir -> []. */
export function listSubdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/** File content, or null when unreadable (missing, permission, directory). */
export function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** ISO mtime, or the epoch when the file cannot be stat'ed. */
export function fileModifiedAt(path: string): string {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}
```

- [ ] **Step 5: Implement `src/main/providers/shared/frontmatter.ts`**

```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS (all existing suites + these two).

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/main/providers/shared
git commit -m "feat: shared discovery helpers for scanning and frontmatter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Resource id codec and document builder

**Files:**

- Modify: `src/shared/resource.ts` (add `entryKey` to `NativeResource`)
- Create: `src/main/providers/shared/resource-id.ts`
- Create: `src/main/providers/shared/resource-id.test.ts`
- Create: `src/main/providers/shared/document.ts`
- Create: `src/main/providers/shared/document.test.ts`

**Interfaces:**

- Consumes: `AppOperationError` from `src/main/errors.ts`; `fileModifiedAt` from Task 1's `scan.ts`.
- Produces: from `resource-id.ts`: `ResourceRef { provider: 'codex' | 'claude'; kind: string; scope: 'user' | 'project' | 'directory'; projectId?: string; path: string; entryKey?: string }`, `encodeResourceId(ref: ResourceRef): string`, `decodeResourceId(id: string): ResourceRef` (throws `AppOperationError` with code `invalid-request`). From `document.ts`: `ScopeTemplate { provider: ProviderId; scope: ResourceScope; projectId?: string }`, `DocumentParts { name: string; description?: string; fields: Record<string, unknown>; native: ResourceDocument['native']; diagnostics: Diagnostic[] }`, `buildDocument(native: NativeResource, parts: DocumentParts): ResourceDocument`, `stringField(fields: Record<string, unknown>, key: string): string | undefined`, `missingFieldDiagnostics(fields: Record<string, unknown>, required: string[], path: string): Diagnostic[]`. Consumed by all scanners (Tasks 3–6) and the ResourceService (Task 8).

- [ ] **Step 1: Add `entryKey` to `NativeResource` in `src/shared/resource.ts`**

Replace the `NativeResource` interface with:

```ts
export interface NativeResource {
  provider: ProviderId;
  kind: string;
  scope: ResourceScope;
  projectId?: string;
  paths: string[];
  /** Distinguishes entries inside a shared file (e.g. one MCP server name). */
  entryKey?: string;
}
```

- [ ] **Step 2: Write the failing tests `src/main/providers/shared/resource-id.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { AppOperationError } from "../../errors";
import {
  decodeResourceId,
  encodeResourceId,
  type ResourceRef,
} from "./resource-id";

const fullRef: ResourceRef = {
  provider: "claude",
  kind: "mcp-servers",
  scope: "project",
  projectId: "p1",
  path: "/repo/.mcp.json",
  entryKey: "github",
};

describe("resource id codec", () => {
  it("round-trips a full ref", () => {
    expect(decodeResourceId(encodeResourceId(fullRef))).toEqual(fullRef);
  });

  it("round-trips a minimal ref and omits undefined keys", () => {
    const ref: ResourceRef = {
      provider: "codex",
      kind: "agents",
      scope: "user",
      path: "/home/x/.codex/agents/a.toml",
    };
    const decoded = decodeResourceId(encodeResourceId(ref));
    expect(decoded).toEqual(ref);
    expect("projectId" in decoded).toBe(false);
    expect("entryKey" in decoded).toBe(false);
  });

  it("is deterministic for equal refs", () => {
    expect(encodeResourceId(fullRef)).toBe(encodeResourceId({ ...fullRef }));
  });

  it("throws invalid-request for garbage input", () => {
    try {
      decodeResourceId("not-a-real-id");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppOperationError);
      expect((error as AppOperationError).code).toBe("invalid-request");
    }
  });

  it("throws invalid-request for valid base64 of the wrong shape", () => {
    const bogus = Buffer.from('{"nope":1}', "utf8").toString("base64url");
    expect(() => decodeResourceId(bogus)).toThrowError(AppOperationError);
  });
});
```

- [ ] **Step 3: Write the failing tests `src/main/providers/shared/document.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { NativeResource } from "../../../shared/resource";
import {
  buildDocument,
  missingFieldDiagnostics,
  stringField,
} from "./document";
import { decodeResourceId } from "./resource-id";

const native: NativeResource = {
  provider: "claude",
  kind: "agents",
  scope: "user",
  paths: ["/tmp/does-not-exist.md"],
};

describe("buildDocument", () => {
  it("fills the shared boilerplate and encodes a decodable id", () => {
    const doc = buildDocument(native, {
      name: "x",
      fields: {},
      native: { format: "markdown" },
      diagnostics: [],
    });
    expect(doc.enabled).toBe("unsupported");
    expect(doc.sourcePaths).toEqual(native.paths);
    expect(doc.provider).toBe("claude");
    expect(doc.kind).toBe("agents");
    expect(decodeResourceId(doc.id)).toMatchObject({
      provider: "claude",
      kind: "agents",
      scope: "user",
      path: "/tmp/does-not-exist.md",
    });
    expect(doc.modifiedAt).toBe(new Date(0).toISOString());
  });

  it("carries entryKey into the id", () => {
    const doc = buildDocument(
      { ...native, kind: "mcp-servers", entryKey: "github" },
      {
        name: "github",
        fields: {},
        native: { format: "json" },
        diagnostics: [],
      },
    );
    expect(decodeResourceId(doc.id).entryKey).toBe("github");
  });
});

describe("stringField", () => {
  it("returns non-empty strings and undefined otherwise", () => {
    expect(stringField({ a: "x" }, "a")).toBe("x");
    expect(stringField({ a: "  " }, "a")).toBeUndefined();
    expect(stringField({ a: 3 }, "a")).toBeUndefined();
    expect(stringField({}, "a")).toBeUndefined();
  });
});

describe("missingFieldDiagnostics", () => {
  it("warns per missing required field", () => {
    expect(
      missingFieldDiagnostics({ name: "x" }, ["name", "description"], "/f.md"),
    ).toEqual([
      {
        severity: "warning",
        message: "Missing required field: description",
        path: "/f.md",
      },
    ]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./resource-id` / `./document`.

- [ ] **Step 5: Implement `src/main/providers/shared/resource-id.ts`**

```ts
import { z } from "zod";
import { AppOperationError } from "../../errors";

const refSchema = z.object({
  provider: z.enum(["codex", "claude"]),
  kind: z.string(),
  scope: z.enum(["user", "project", "directory"]),
  projectId: z.string().optional(),
  path: z.string(),
  entryKey: z.string().optional(),
});

export type ResourceRef = z.infer<typeof refSchema>;

/** Stable id: base64url JSON with a fixed key order (undefined keys drop out). */
export function encodeResourceId(ref: ResourceRef): string {
  const canonical = {
    provider: ref.provider,
    kind: ref.kind,
    scope: ref.scope,
    projectId: ref.projectId,
    path: ref.path,
    entryKey: ref.entryKey,
  };
  return Buffer.from(JSON.stringify(canonical), "utf8").toString("base64url");
}

export function decodeResourceId(id: string): ResourceRef {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(id, "base64url").toString("utf8"));
  } catch {
    throw new AppOperationError(
      "invalid-request",
      "resources:read",
      "Malformed resource id",
    );
  }
  const result = refSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppOperationError(
      "invalid-request",
      "resources:read",
      "Malformed resource id",
    );
  }
  return result.data;
}
```

- [ ] **Step 6: Implement `src/main/providers/shared/document.ts`**

```ts
import type {
  Diagnostic,
  NativeResource,
  ProviderId,
  ResourceDocument,
  ResourceScope,
} from "../../../shared/resource";
import { encodeResourceId } from "./resource-id";
import { fileModifiedAt } from "./scan";

/** The provider/scope context a discover function stamps onto its natives. */
export interface ScopeTemplate {
  provider: ProviderId;
  scope: ResourceScope;
  projectId?: string;
}

export interface DocumentParts {
  name: string;
  description?: string;
  fields: Record<string, unknown>;
  native: ResourceDocument["native"];
  diagnostics: Diagnostic[];
}

/** Assemble the ResourceDocument boilerplate every scanner shares. */
export function buildDocument(
  native: NativeResource,
  parts: DocumentParts,
): ResourceDocument {
  return {
    id: encodeResourceId({
      provider: native.provider,
      kind: native.kind,
      scope: native.scope,
      projectId: native.projectId,
      path: native.paths[0],
      entryKey: native.entryKey,
    }),
    provider: native.provider,
    kind: native.kind,
    scope: native.scope,
    projectId: native.projectId,
    enabled: "unsupported",
    sourcePaths: native.paths,
    modifiedAt: fileModifiedAt(native.paths[0]),
    ...parts,
  };
}

/** The field's non-empty string value, or undefined. */
export function stringField(
  fields: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = fields[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** One warning per missing required string field (e.g. name, description). */
export function missingFieldDiagnostics(
  fields: Record<string, unknown>,
  required: string[],
  path: string,
): Diagnostic[] {
  return required
    .filter((key) => stringField(fields, key) === undefined)
    .map((key) => ({
      severity: "warning" as const,
      message: `Missing required field: ${key}`,
      path,
    }));
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/shared/resource.ts src/main/providers/shared
git commit -m "feat: resource id codec and shared document builder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Claude markdown scanners — agents and commands

**Files:**

- Create: `tests/fixtures/discovery/claude-user/agents/code-reviewer.md`
- Create: `tests/fixtures/discovery/claude-user/agents/no-description.md`
- Create: `tests/fixtures/discovery/claude-user/agents/broken.md`
- Create: `tests/fixtures/discovery/claude-user/commands/deploy.md`
- Create: `tests/fixtures/discovery/claude-user/commands/empty.md`
- Create: `tests/fixtures/discovery/claude-user/commands/frontend/component.md`
- Create: `tests/fixtures/discovery/project/.claude/agents/project-agent.md`
- Create: `tests/fixtures/discovery/project/.claude/commands/ship.md`
- Create: `src/main/providers/claude/agents.ts`
- Create: `src/main/providers/claude/agents.test.ts`
- Create: `src/main/providers/claude/commands.ts`
- Create: `src/main/providers/claude/commands.test.ts`

**Interfaces:**

- Consumes: Task 1's `listFiles`, `listFilesRecursive`, `readTextFile`; Task 2's `ScopeTemplate`, `buildDocument`, `stringField`, `missingFieldDiagnostics`; `parseFrontmatter`.
- Produces: `discoverClaudeAgents(agentsDir: string, template: ScopeTemplate): NativeResource[]`, `parseClaudeAgent(native: NativeResource): ResourceDocument`, `discoverClaudeCommands(commandsDir: string, template: ScopeTemplate): NativeResource[]`, `parseClaudeCommand(native: NativeResource): ResourceDocument`. Consumed by Task 7's Claude adapter.

- [ ] **Step 1: Write the agent fixtures**

`tests/fixtures/discovery/claude-user/agents/code-reviewer.md`:

```markdown
---
name: code-reviewer
description: Reviews pull requests for style issues
model: sonnet
---

You are a meticulous code reviewer.
```

`tests/fixtures/discovery/claude-user/agents/no-description.md`:

```markdown
---
name: no-description
---

Agent without a description.
```

`tests/fixtures/discovery/claude-user/agents/broken.md`:

```markdown
---
name: [unclosed
description: bad yaml
---

Body.
```

`tests/fixtures/discovery/project/.claude/agents/project-agent.md`:

```markdown
---
name: project-agent
description: Project-scoped agent used by integration tests
---

Do project things.
```

- [ ] **Step 2: Write the command fixtures**

`tests/fixtures/discovery/claude-user/commands/deploy.md`:

```markdown
---
description: Deploy the current branch
---

Run the deploy pipeline for $ARGUMENTS.
```

`tests/fixtures/discovery/claude-user/commands/empty.md`: an empty file (zero bytes).

`tests/fixtures/discovery/claude-user/commands/frontend/component.md`:

```markdown
Generate a React component named $ARGUMENTS.
```

`tests/fixtures/discovery/project/.claude/commands/ship.md`:

```markdown
---
description: Ship the project
---

Ship it.
```

- [ ] **Step 3: Write the failing tests `src/main/providers/claude/agents.test.ts`**

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ScopeTemplate } from "../shared/document";
import { discoverClaudeAgents, parseClaudeAgent } from "./agents";

const FIXTURES = join(
  import.meta.dirname,
  "../../../../tests/fixtures/discovery",
);
const AGENTS_DIR = join(FIXTURES, "claude-user", "agents");
const USER: ScopeTemplate = { provider: "claude", scope: "user" };

describe("discoverClaudeAgents", () => {
  it("finds every markdown agent, sorted", () => {
    const natives = discoverClaudeAgents(AGENTS_DIR, USER);
    expect(natives.map((n) => n.paths[0])).toEqual([
      join(AGENTS_DIR, "broken.md"),
      join(AGENTS_DIR, "code-reviewer.md"),
      join(AGENTS_DIR, "no-description.md"),
    ]);
    expect(natives[0]).toMatchObject({
      provider: "claude",
      kind: "agents",
      scope: "user",
    });
  });

  it("returns [] for a missing directory", () => {
    expect(discoverClaudeAgents(join(FIXTURES, "nope"), USER)).toEqual([]);
  });
});

describe("parseClaudeAgent", () => {
  const parse = (file: string) =>
    parseClaudeAgent({
      ...USER,
      kind: "agents",
      paths: [join(AGENTS_DIR, file)],
    });

  it("parses a healthy agent", () => {
    const doc = parse("code-reviewer.md");
    expect(doc.name).toBe("code-reviewer");
    expect(doc.description).toBe("Reviews pull requests for style issues");
    expect(doc.fields["model"]).toBe("sonnet");
    expect(doc.native.format).toBe("markdown");
    expect(doc.native.raw).toContain("meticulous");
    expect(doc.diagnostics).toEqual([]);
    expect(doc.enabled).toBe("unsupported");
  });

  it("warns when description is missing", () => {
    const doc = parse("no-description.md");
    expect(doc.diagnostics).toEqual([
      {
        severity: "warning",
        message: "Missing required field: description",
        path: join(AGENTS_DIR, "no-description.md"),
      },
    ]);
  });

  it("reports malformed frontmatter as an error and falls back to the filename", () => {
    const doc = parse("broken.md");
    expect(doc.name).toBe("broken");
    expect(doc.diagnostics.some((d) => d.severity === "error")).toBe(true);
    // parse errors suppress required-field noise
    expect(doc.diagnostics.some((d) => d.severity === "warning")).toBe(false);
    expect(doc.native.raw).toBeDefined();
  });

  it("contains an unreadable file as an error diagnostic", () => {
    const doc = parse("missing.md");
    expect(doc.name).toBe("missing");
    expect(doc.diagnostics).toEqual([
      {
        severity: "error",
        message: "File could not be read",
        path: join(AGENTS_DIR, "missing.md"),
      },
    ]);
  });
});
```

- [ ] **Step 4: Write the failing tests `src/main/providers/claude/commands.test.ts`**

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ScopeTemplate } from "../shared/document";
import { discoverClaudeCommands, parseClaudeCommand } from "./commands";

const FIXTURES = join(
  import.meta.dirname,
  "../../../../tests/fixtures/discovery",
);
const COMMANDS_DIR = join(FIXTURES, "claude-user", "commands");
const USER: ScopeTemplate = { provider: "claude", scope: "user" };

describe("discoverClaudeCommands", () => {
  it("finds commands recursively and names them by relative path", () => {
    const natives = discoverClaudeCommands(COMMANDS_DIR, USER);
    expect(natives.map((n) => n.entryKey)).toEqual([
      "deploy",
      "empty",
      "frontend/component",
    ]);
    expect(natives[0]).toMatchObject({
      provider: "claude",
      kind: "commands",
      scope: "user",
    });
  });

  it("returns [] for a missing directory", () => {
    expect(discoverClaudeCommands(join(FIXTURES, "nope"), USER)).toEqual([]);
  });
});

describe("parseClaudeCommand", () => {
  const parse = (relative: string, entryKey: string) =>
    parseClaudeCommand({
      ...USER,
      kind: "commands",
      paths: [join(COMMANDS_DIR, relative)],
      entryKey,
    });

  it("parses a command with frontmatter description", () => {
    const doc = parse("deploy.md", "deploy");
    expect(doc.name).toBe("deploy");
    expect(doc.description).toBe("Deploy the current branch");
    expect(doc.native.raw).toContain("$ARGUMENTS");
    expect(doc.diagnostics).toEqual([]);
  });

  it("uses the namespaced entryKey as the name", () => {
    const doc = parse(join("frontend", "component.md"), "frontend/component");
    expect(doc.name).toBe("frontend/component");
    expect(doc.description).toBeUndefined();
    expect(doc.diagnostics).toEqual([]);
  });

  it("warns for an empty command file", () => {
    const doc = parse("empty.md", "empty");
    expect(doc.diagnostics).toEqual([
      {
        severity: "warning",
        message: "Command file is empty",
        path: join(COMMANDS_DIR, "empty.md"),
      },
    ]);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./agents` / `./commands`.

- [ ] **Step 6: Implement `src/main/providers/claude/agents.ts`**

```ts
import { basename } from "node:path";
import type {
  NativeResource,
  ResourceDocument,
} from "../../../shared/resource";
import {
  buildDocument,
  missingFieldDiagnostics,
  stringField,
} from "../shared/document";
import type { ScopeTemplate } from "../shared/document";
import { parseFrontmatter } from "../shared/frontmatter";
import { listFiles, readTextFile } from "../shared/scan";

export function discoverClaudeAgents(
  agentsDir: string,
  template: ScopeTemplate,
): NativeResource[] {
  return listFiles(agentsDir, ".md").map((path) => ({
    ...template,
    kind: "agents",
    paths: [path],
  }));
}

export function parseClaudeAgent(native: NativeResource): ResourceDocument {
  const path = native.paths[0];
  const fallbackName = basename(path, ".md");
  const raw = readTextFile(path);
  if (raw === null) {
    return buildDocument(native, {
      name: fallbackName,
      fields: {},
      native: { format: "markdown" },
      diagnostics: [
        { severity: "error", message: "File could not be read", path },
      ],
    });
  }
  const parsed = parseFrontmatter(raw);
  const diagnostics = parsed.diagnostics.map((d) => ({ ...d, path }));
  const parseFailed = diagnostics.some((d) => d.severity === "error");
  return buildDocument(native, {
    name: stringField(parsed.fields, "name") ?? fallbackName,
    description: stringField(parsed.fields, "description"),
    fields: parsed.fields,
    native: { format: "markdown", raw },
    diagnostics: parseFailed
      ? diagnostics
      : [
          ...diagnostics,
          ...missingFieldDiagnostics(
            parsed.fields,
            ["name", "description"],
            path,
          ),
        ],
  });
}
```

- [ ] **Step 7: Implement `src/main/providers/claude/commands.ts`**

```ts
import { basename, relative, sep } from "node:path";
import type {
  NativeResource,
  ResourceDocument,
} from "../../../shared/resource";
import { buildDocument, stringField } from "../shared/document";
import type { ScopeTemplate } from "../shared/document";
import { parseFrontmatter } from "../shared/frontmatter";
import { listFilesRecursive, readTextFile } from "../shared/scan";

export function discoverClaudeCommands(
  commandsDir: string,
  template: ScopeTemplate,
): NativeResource[] {
  return listFilesRecursive(commandsDir, ".md").map((path) => ({
    ...template,
    kind: "commands",
    paths: [path],
    entryKey: relative(commandsDir, path)
      .replace(/\.md$/, "")
      .split(sep)
      .join("/"),
  }));
}

export function parseClaudeCommand(native: NativeResource): ResourceDocument {
  const path = native.paths[0];
  const name = native.entryKey ?? basename(path, ".md");
  const raw = readTextFile(path);
  if (raw === null) {
    return buildDocument(native, {
      name,
      fields: {},
      native: { format: "markdown" },
      diagnostics: [
        { severity: "error", message: "File could not be read", path },
      ],
    });
  }
  const parsed = parseFrontmatter(raw);
  const diagnostics = parsed.diagnostics.map((d) => ({ ...d, path }));
  if (raw.trim() === "") {
    diagnostics.push({
      severity: "warning",
      message: "Command file is empty",
      path,
    });
  }
  return buildDocument(native, {
    name,
    description: stringField(parsed.fields, "description"),
    fields: parsed.fields,
    native: { format: "markdown", raw },
    diagnostics,
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/main/providers/claude tests/fixtures/discovery
git commit -m "feat: claude agent and command discovery scanners

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Shared skills and instructions scanners (both providers)

**Files:**

- Create: `tests/fixtures/discovery/claude-user/skills/writing-docs/SKILL.md`
- Create: `tests/fixtures/discovery/claude-user/skills/no-desc/SKILL.md`
- Create: `tests/fixtures/discovery/claude-user/CLAUDE.md`
- Create: `tests/fixtures/discovery/codex-user/skills/deploy-helper/SKILL.md`
- Create: `tests/fixtures/discovery/codex-user/skills/no-manifest/README.md`
- Create: `tests/fixtures/discovery/codex-user/AGENTS.md` (empty file)
- Create: `tests/fixtures/discovery/project/.claude/skills/project-skill/SKILL.md`
- Create: `tests/fixtures/discovery/project/CLAUDE.md`
- Create: `tests/fixtures/discovery/project/AGENTS.md`
- Create: `src/main/providers/shared/skills.ts`
- Create: `src/main/providers/shared/skills.test.ts`
- Create: `src/main/providers/shared/instructions.ts`
- Create: `src/main/providers/shared/instructions.test.ts`

**Interfaces:**

- Consumes: Task 1's `listFiles`, `listSubdirectories`, `readTextFile`, `fileExists`; Task 2's helpers.
- Produces: `discoverSkills(skillsDir: string, template: ScopeTemplate): NativeResource[]`, `parseSkill(native: NativeResource): ResourceDocument` from `skills.ts`; `discoverInstructionsFile(path: string, template: ScopeTemplate): NativeResource[]`, `parseInstructions(native: NativeResource): ResourceDocument` from `instructions.ts`. Consumed by both adapters in Task 7.

- [ ] **Step 1: Write the skill fixtures**

`tests/fixtures/discovery/claude-user/skills/writing-docs/SKILL.md`:

```markdown
---
name: writing-docs
description: Structure and edit technical documentation
---

# Writing docs

Guidance body.
```

`tests/fixtures/discovery/claude-user/skills/no-desc/SKILL.md`:

```markdown
---
name: no-desc
---

Body.
```

`tests/fixtures/discovery/codex-user/skills/deploy-helper/SKILL.md`:

```markdown
---
name: deploy-helper
description: Helps run deploys safely
---

# Deploy helper

Steps.
```

`tests/fixtures/discovery/codex-user/skills/no-manifest/README.md`:

```markdown
Just a readme, no SKILL.md here.
```

`tests/fixtures/discovery/project/.claude/skills/project-skill/SKILL.md`:

```markdown
---
name: project-skill
description: Project-scoped skill used by integration tests
---

Body.
```

- [ ] **Step 2: Write the instructions fixtures**

`tests/fixtures/discovery/claude-user/CLAUDE.md`:

```markdown
# Personal instructions

- Prefer TypeScript.
```

`tests/fixtures/discovery/codex-user/AGENTS.md`: an **empty file** (zero bytes — exercises the empty-file info diagnostic).

`tests/fixtures/discovery/project/CLAUDE.md`:

```markdown
# Project instructions
```

`tests/fixtures/discovery/project/AGENTS.md`:

```markdown
# Codex project instructions
```

- [ ] **Step 3: Write the failing tests `src/main/providers/shared/skills.test.ts`**

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ScopeTemplate } from "./document";
import { discoverSkills, parseSkill } from "./skills";

const FIXTURES = join(
  import.meta.dirname,
  "../../../../tests/fixtures/discovery",
);
const CLAUDE_SKILLS = join(FIXTURES, "claude-user", "skills");
const CODEX_SKILLS = join(FIXTURES, "codex-user", "skills");
const CLAUDE_USER: ScopeTemplate = { provider: "claude", scope: "user" };
const CODEX_USER: ScopeTemplate = { provider: "codex", scope: "user" };

describe("discoverSkills", () => {
  it("emits one native per skill directory, pointing at SKILL.md", () => {
    const natives = discoverSkills(CLAUDE_SKILLS, CLAUDE_USER);
    expect(natives.map((n) => n.paths[0])).toEqual([
      join(CLAUDE_SKILLS, "no-desc", "SKILL.md"),
      join(CLAUDE_SKILLS, "writing-docs", "SKILL.md"),
    ]);
    expect(natives[0]).toMatchObject({
      provider: "claude",
      kind: "skills",
      scope: "user",
    });
  });

  it("returns [] for a missing directory", () => {
    expect(discoverSkills(join(FIXTURES, "nope"), CLAUDE_USER)).toEqual([]);
  });
});

describe("parseSkill", () => {
  it("parses a healthy skill", () => {
    const doc = parseSkill({
      ...CLAUDE_USER,
      kind: "skills",
      paths: [join(CLAUDE_SKILLS, "writing-docs", "SKILL.md")],
    });
    expect(doc.name).toBe("writing-docs");
    expect(doc.description).toBe("Structure and edit technical documentation");
    expect(doc.native.format).toBe("markdown");
    expect(doc.diagnostics).toEqual([]);
  });

  it("warns when description is missing", () => {
    const doc = parseSkill({
      ...CLAUDE_USER,
      kind: "skills",
      paths: [join(CLAUDE_SKILLS, "no-desc", "SKILL.md")],
    });
    expect(doc.diagnostics).toEqual([
      {
        severity: "warning",
        message: "Missing required field: description",
        path: join(CLAUDE_SKILLS, "no-desc", "SKILL.md"),
      },
    ]);
  });

  it("reports a skill directory without SKILL.md as an error", () => {
    const doc = parseSkill({
      ...CODEX_USER,
      kind: "skills",
      paths: [join(CODEX_SKILLS, "no-manifest", "SKILL.md")],
    });
    expect(doc.name).toBe("no-manifest");
    expect(doc.native.format).toBe("directory");
    expect(doc.diagnostics).toEqual([
      {
        severity: "error",
        message: "Skill directory has no SKILL.md",
        path: join(CODEX_SKILLS, "no-manifest"),
      },
    ]);
  });

  it("lists supporting files without parsing them", () => {
    const doc = parseSkill({
      ...CODEX_USER,
      kind: "skills",
      paths: [join(CODEX_SKILLS, "deploy-helper", "SKILL.md")],
    });
    expect(doc.fields["supportingFiles"]).toBeUndefined();
    const withExtras = parseSkill({
      ...CODEX_USER,
      kind: "skills",
      paths: [join(CODEX_SKILLS, "no-manifest", "SKILL.md")],
    });
    expect(withExtras.fields["supportingFiles"]).toEqual(["README.md"]);
  });
});
```

- [ ] **Step 4: Write the failing tests `src/main/providers/shared/instructions.test.ts`**

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ScopeTemplate } from "./document";
import { discoverInstructionsFile, parseInstructions } from "./instructions";

const FIXTURES = join(
  import.meta.dirname,
  "../../../../tests/fixtures/discovery",
);
const CLAUDE_MD = join(FIXTURES, "claude-user", "CLAUDE.md");
const EMPTY_AGENTS_MD = join(FIXTURES, "codex-user", "AGENTS.md");
const CLAUDE_USER: ScopeTemplate = { provider: "claude", scope: "user" };
const CODEX_USER: ScopeTemplate = { provider: "codex", scope: "user" };

describe("discoverInstructionsFile", () => {
  it("emits one native when the file exists", () => {
    expect(discoverInstructionsFile(CLAUDE_MD, CLAUDE_USER)).toEqual([
      {
        provider: "claude",
        scope: "user",
        kind: "instructions",
        paths: [CLAUDE_MD],
      },
    ]);
  });

  it("emits nothing when the file is missing", () => {
    expect(
      discoverInstructionsFile(join(FIXTURES, "nope.md"), CLAUDE_USER),
    ).toEqual([]);
  });
});

describe("parseInstructions", () => {
  it("parses an instructions file, named after the file", () => {
    const doc = parseInstructions({
      ...CLAUDE_USER,
      kind: "instructions",
      paths: [CLAUDE_MD],
    });
    expect(doc.name).toBe("CLAUDE.md");
    expect(doc.native.raw).toContain("Prefer TypeScript");
    expect(doc.diagnostics).toEqual([]);
  });

  it("flags an empty file with an info diagnostic", () => {
    const doc = parseInstructions({
      ...CODEX_USER,
      kind: "instructions",
      paths: [EMPTY_AGENTS_MD],
    });
    expect(doc.name).toBe("AGENTS.md");
    expect(doc.diagnostics).toEqual([
      { severity: "info", message: "File is empty", path: EMPTY_AGENTS_MD },
    ]);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./skills` / `./instructions`.

- [ ] **Step 6: Implement `src/main/providers/shared/skills.ts`**

```ts
import { basename, dirname, join } from "node:path";
import type {
  NativeResource,
  ResourceDocument,
} from "../../../shared/resource";
import {
  buildDocument,
  missingFieldDiagnostics,
  stringField,
} from "./document";
import type { ScopeTemplate } from "./document";
import { parseFrontmatter } from "./frontmatter";
import { listFiles, listSubdirectories, readTextFile } from "./scan";

export function discoverSkills(
  skillsDir: string,
  template: ScopeTemplate,
): NativeResource[] {
  return listSubdirectories(skillsDir).map((dir) => ({
    ...template,
    kind: "skills",
    paths: [join(dir, "SKILL.md")],
  }));
}

export function parseSkill(native: NativeResource): ResourceDocument {
  const skillMd = native.paths[0];
  const dir = dirname(skillMd);
  const fallbackName = basename(dir);
  // '' matches every extension: list all sibling files except the manifest.
  const supportingFiles = listFiles(dir, "")
    .map((path) => basename(path))
    .filter((name) => name !== "SKILL.md");
  const raw = readTextFile(skillMd);
  if (raw === null) {
    return buildDocument(native, {
      name: fallbackName,
      fields: supportingFiles.length > 0 ? { supportingFiles } : {},
      native: { format: "directory" },
      diagnostics: [
        {
          severity: "error",
          message: "Skill directory has no SKILL.md",
          path: dir,
        },
      ],
    });
  }
  const parsed = parseFrontmatter(raw);
  const diagnostics = parsed.diagnostics.map((d) => ({ ...d, path: skillMd }));
  const parseFailed = diagnostics.some((d) => d.severity === "error");
  return buildDocument(native, {
    name: stringField(parsed.fields, "name") ?? fallbackName,
    description: stringField(parsed.fields, "description"),
    fields:
      supportingFiles.length > 0
        ? { ...parsed.fields, supportingFiles }
        : parsed.fields,
    native: { format: "markdown", raw },
    diagnostics: parseFailed
      ? diagnostics
      : [
          ...diagnostics,
          ...missingFieldDiagnostics(
            parsed.fields,
            ["name", "description"],
            skillMd,
          ),
        ],
  });
}
```

Note the ordering: `supportingFiles` is computed before the `raw === null` check so a directory without SKILL.md still lists its files (`no-manifest` → `['README.md']`).

- [ ] **Step 7: Implement `src/main/providers/shared/instructions.ts`**

```ts
import { basename } from "node:path";
import type {
  NativeResource,
  ResourceDocument,
} from "../../../shared/resource";
import { buildDocument } from "./document";
import type { ScopeTemplate } from "./document";
import { fileExists, readTextFile } from "./scan";

export function discoverInstructionsFile(
  path: string,
  template: ScopeTemplate,
): NativeResource[] {
  return fileExists(path)
    ? [{ ...template, kind: "instructions", paths: [path] }]
    : [];
}

export function parseInstructions(native: NativeResource): ResourceDocument {
  const path = native.paths[0];
  const name = basename(path);
  const raw = readTextFile(path);
  if (raw === null) {
    return buildDocument(native, {
      name,
      fields: {},
      native: { format: "markdown" },
      diagnostics: [
        { severity: "error", message: "File could not be read", path },
      ],
    });
  }
  return buildDocument(native, {
    name,
    fields: {},
    native: { format: "markdown", raw },
    diagnostics:
      raw.trim() === ""
        ? [{ severity: "info", message: "File is empty", path }]
        : [],
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/main/providers/shared tests/fixtures/discovery
git commit -m "feat: shared skill and instructions discovery scanners

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Claude MCP server scanner

**Files:**

- Create: `tests/fixtures/discovery/claude-user.json`
- Create: `tests/fixtures/discovery/claude-user-broken.json`
- Create: `tests/fixtures/discovery/project/.mcp.json`
- Create: `src/main/providers/claude/mcp-servers.ts`
- Create: `src/main/providers/claude/mcp-servers.test.ts`

**Interfaces:**

- Consumes: Task 1's `readTextFile`; Task 2's `buildDocument`, `stringField`, `ScopeTemplate`; `jsonc-parser`'s `parse`, `printParseErrorCode`, `ParseError`.
- Produces: `discoverClaudeMcpServers(userMcpPath: string, projects: Array<{ id: string; path: string }>): NativeResource[]`, `parseClaudeMcpServer(native: NativeResource): ResourceDocument`. A native WITHOUT `entryKey` marks a malformed/unreadable shared file (parses to one synthetic "MCP configuration" error resource). Consumed by Task 7's Claude adapter.

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/discovery/claude-user.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_example1234567890abcd" }
    },
    "incomplete": {
      "args": ["--port", "3000"]
    }
  }
}
```

`tests/fixtures/discovery/claude-user-broken.json` (intentionally truncated, invalid JSON):

```
{ "mcpServers": { "oops":
```

`tests/fixtures/discovery/project/.mcp.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "bunx",
      "args": ["@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

- [ ] **Step 2: Write the failing tests `src/main/providers/claude/mcp-servers.test.ts`**

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverClaudeMcpServers, parseClaudeMcpServer } from "./mcp-servers";

const FIXTURES = join(
  import.meta.dirname,
  "../../../../tests/fixtures/discovery",
);
const USER_MCP = join(FIXTURES, "claude-user.json");
const BROKEN_MCP = join(FIXTURES, "claude-user-broken.json");
const PROJECT = { id: "project-1", path: join(FIXTURES, "project") };

describe("discoverClaudeMcpServers", () => {
  it("emits one native per server entry across user and project scopes", () => {
    const natives = discoverClaudeMcpServers(USER_MCP, [PROJECT]);
    expect(
      natives.map((n) => ({ scope: n.scope, entryKey: n.entryKey })),
    ).toEqual([
      { scope: "user", entryKey: "github" },
      { scope: "user", entryKey: "incomplete" },
      { scope: "project", entryKey: "filesystem" },
    ]);
    expect(natives[2]?.projectId).toBe("project-1");
    expect(natives[2]?.paths).toEqual([join(PROJECT.path, ".mcp.json")]);
  });

  it("emits a single marker native (no entryKey) for a malformed file", () => {
    const natives = discoverClaudeMcpServers(BROKEN_MCP, []);
    expect(natives).toHaveLength(1);
    expect(natives[0]?.entryKey).toBeUndefined();
  });

  it("emits nothing when files are missing", () => {
    expect(
      discoverClaudeMcpServers(join(FIXTURES, "nope.json"), [
        { id: "p", path: join(FIXTURES, "nope-project") },
      ]),
    ).toEqual([]);
  });
});

describe("parseClaudeMcpServer", () => {
  it("parses a healthy server entry", () => {
    const doc = parseClaudeMcpServer({
      provider: "claude",
      kind: "mcp-servers",
      scope: "user",
      paths: [USER_MCP],
      entryKey: "github",
    });
    expect(doc.name).toBe("github");
    expect(doc.fields["command"]).toBe("npx");
    expect(doc.native.format).toBe("json");
    expect(doc.native.raw).toContain("mcpServers");
    expect(doc.diagnostics).toEqual([]);
  });

  it("warns when command and url are both missing", () => {
    const doc = parseClaudeMcpServer({
      provider: "claude",
      kind: "mcp-servers",
      scope: "user",
      paths: [USER_MCP],
      entryKey: "incomplete",
    });
    expect(doc.diagnostics).toEqual([
      {
        severity: "warning",
        message: "Missing required field: command (or url for remote servers)",
        path: USER_MCP,
      },
    ]);
  });

  it("parses the malformed-file marker into a synthetic error resource", () => {
    const doc = parseClaudeMcpServer({
      provider: "claude",
      kind: "mcp-servers",
      scope: "user",
      paths: [BROKEN_MCP],
    });
    expect(doc.name).toBe("MCP configuration");
    expect(doc.diagnostics[0]?.severity).toBe("error");
    expect(doc.diagnostics[0]?.message).toContain("Invalid JSON");
    expect(doc.native.raw).toBeDefined();
  });

  it("reports an entry that vanished since discovery", () => {
    const doc = parseClaudeMcpServer({
      provider: "claude",
      kind: "mcp-servers",
      scope: "user",
      paths: [USER_MCP],
      entryKey: "gone",
    });
    expect(doc.diagnostics[0]?.severity).toBe("error");
    expect(doc.diagnostics[0]?.message).toContain("no longer present");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./mcp-servers`.

- [ ] **Step 4: Implement `src/main/providers/claude/mcp-servers.ts`**

```ts
import { join } from "node:path";
import { parse, printParseErrorCode } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import type {
  NativeResource,
  ResourceDocument,
} from "../../../shared/resource";
import { buildDocument, stringField } from "../shared/document";
import type { ScopeTemplate } from "../shared/document";
import { readTextFile } from "../shared/scan";

interface McpFile {
  servers: Record<string, unknown> | null;
  error: string | null;
}

function readMcpFile(raw: string): McpFile {
  const errors: ParseError[] = [];
  const value: unknown = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0];
    return {
      servers: null,
      error: `${printParseErrorCode(first.error)} at offset ${first.offset}`,
    };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { servers: null, error: "top-level value is not an object" };
  }
  const servers = (value as Record<string, unknown>)["mcpServers"];
  if (servers === undefined || servers === null)
    return { servers: {}, error: null };
  if (typeof servers !== "object" || Array.isArray(servers)) {
    return { servers: null, error: "mcpServers is not an object" };
  }
  return { servers: servers as Record<string, unknown>, error: null };
}

function discoverMcpJsonFile(
  path: string,
  template: ScopeTemplate,
): NativeResource[] {
  const raw = readTextFile(path);
  if (raw === null) return [];
  const file = readMcpFile(raw);
  if (file.servers === null) {
    // Malformed shared file: one synthetic marker resource (no entryKey).
    return [{ ...template, kind: "mcp-servers", paths: [path] }];
  }
  return Object.keys(file.servers)
    .sort()
    .map((name) => ({
      ...template,
      kind: "mcp-servers",
      paths: [path],
      entryKey: name,
    }));
}

export function discoverClaudeMcpServers(
  userMcpPath: string,
  projects: Array<{ id: string; path: string }>,
): NativeResource[] {
  return [
    ...discoverMcpJsonFile(userMcpPath, { provider: "claude", scope: "user" }),
    ...projects.flatMap((project) =>
      discoverMcpJsonFile(join(project.path, ".mcp.json"), {
        provider: "claude",
        scope: "project",
        projectId: project.id,
      }),
    ),
  ];
}

export function parseClaudeMcpServer(native: NativeResource): ResourceDocument {
  const path = native.paths[0];
  const raw = readTextFile(path);
  if (raw === null) {
    return buildDocument(native, {
      name: native.entryKey ?? "MCP configuration",
      fields: {},
      native: { format: "json" },
      diagnostics: [
        { severity: "error", message: "File could not be read", path },
      ],
    });
  }
  const file = readMcpFile(raw);
  if (native.entryKey === undefined || file.servers === null) {
    return buildDocument(native, {
      name: "MCP configuration",
      fields: {},
      native: { format: "json", raw },
      diagnostics: [
        {
          severity: "error",
          message: `Invalid JSON: ${file.error ?? "unexpected content"}`,
          path,
        },
      ],
    });
  }
  const entry = file.servers[native.entryKey];
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return buildDocument(native, {
      name: native.entryKey,
      fields: {},
      native: { format: "json", raw },
      diagnostics: [
        {
          severity: "error",
          message: `Server entry no longer present: ${native.entryKey}`,
          path,
        },
      ],
    });
  }
  const fields = entry as Record<string, unknown>;
  const diagnostics =
    stringField(fields, "command") === undefined &&
    stringField(fields, "url") === undefined
      ? [
          {
            severity: "warning" as const,
            message:
              "Missing required field: command (or url for remote servers)",
            path,
          },
        ]
      : [];
  return buildDocument(native, {
    name: native.entryKey,
    fields,
    native: { format: "json", raw },
    diagnostics,
  });
}
```

Note: `entry === undefined` is covered by the `typeof entry !== 'object'` check (`typeof undefined` is `'undefined'`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/providers/claude tests/fixtures/discovery
git commit -m "feat: claude mcp server discovery from shared json files

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Codex scanners — TOML agents and MCP servers

**Files:**

- Create: `tests/fixtures/discovery/codex-user/agents/reviewer.toml`
- Create: `tests/fixtures/discovery/codex-user/agents/no-description.toml`
- Create: `tests/fixtures/discovery/codex-user/agents/broken.toml`
- Create: `tests/fixtures/discovery/codex-user/config.toml`
- Create: `tests/fixtures/discovery/codex-user-broken/config.toml`
- Create: `src/main/providers/codex/agents.ts`
- Create: `src/main/providers/codex/agents.test.ts`
- Create: `src/main/providers/codex/mcp-servers.ts`
- Create: `src/main/providers/codex/mcp-servers.test.ts`

**Interfaces:**

- Consumes: Task 1's `listFiles`, `readTextFile`; Task 2's helpers; `toml-eslint-parser`'s `parseTOML` + `getStaticTOMLValue`.
- Produces: `discoverCodexAgents(agentsDir: string, template: ScopeTemplate): NativeResource[]`, `parseCodexAgent(native: NativeResource): ResourceDocument`, `discoverCodexMcpServers(configRoot: string): NativeResource[]`, `parseCodexMcpServer(native: NativeResource): ResourceDocument`. Same marker convention as Task 5: a native without `entryKey` means a malformed `config.toml`. Consumed by Task 7's Codex adapter.

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/discovery/codex-user/agents/reviewer.toml`:

```toml
# Generated agent
name = "reviewer"
description = "Reviews pull requests"
developer_instructions = "Be meticulous."
```

`tests/fixtures/discovery/codex-user/agents/no-description.toml`:

```toml
name = "no-description"
```

`tests/fixtures/discovery/codex-user/agents/broken.toml` (unclosed string, invalid TOML):

```
name = "broken
```

`tests/fixtures/discovery/codex-user/config.toml`:

```toml
# Codex configuration
model = "gpt-5.5"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github", "--access-token=sbp_secret1234567890"]

[mcp_servers.incomplete]
args = ["--flag"]
```

`tests/fixtures/discovery/codex-user-broken/config.toml` (invalid TOML):

```
model = "unclosed
```

- [ ] **Step 2: Write the failing tests `src/main/providers/codex/agents.test.ts`**

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ScopeTemplate } from "../shared/document";
import { discoverCodexAgents, parseCodexAgent } from "./agents";

const FIXTURES = join(
  import.meta.dirname,
  "../../../../tests/fixtures/discovery",
);
const AGENTS_DIR = join(FIXTURES, "codex-user", "agents");
const USER: ScopeTemplate = { provider: "codex", scope: "user" };

describe("discoverCodexAgents", () => {
  it("finds every TOML agent, sorted", () => {
    const natives = discoverCodexAgents(AGENTS_DIR, USER);
    expect(natives.map((n) => n.paths[0])).toEqual([
      join(AGENTS_DIR, "broken.toml"),
      join(AGENTS_DIR, "no-description.toml"),
      join(AGENTS_DIR, "reviewer.toml"),
    ]);
    expect(natives[0]).toMatchObject({
      provider: "codex",
      kind: "agents",
      scope: "user",
    });
  });

  it("returns [] for a missing directory", () => {
    expect(discoverCodexAgents(join(FIXTURES, "nope"), USER)).toEqual([]);
  });
});

describe("parseCodexAgent", () => {
  const parse = (file: string) =>
    parseCodexAgent({
      ...USER,
      kind: "agents",
      paths: [join(AGENTS_DIR, file)],
    });

  it("parses a healthy agent", () => {
    const doc = parse("reviewer.toml");
    expect(doc.name).toBe("reviewer");
    expect(doc.description).toBe("Reviews pull requests");
    expect(doc.fields["developer_instructions"]).toBe("Be meticulous.");
    expect(doc.native.format).toBe("toml");
    expect(doc.native.raw).toContain("# Generated agent");
    expect(doc.diagnostics).toEqual([]);
  });

  it("warns when description is missing", () => {
    const doc = parse("no-description.toml");
    expect(doc.diagnostics).toEqual([
      {
        severity: "warning",
        message: "Missing required field: description",
        path: join(AGENTS_DIR, "no-description.toml"),
      },
    ]);
  });

  it("reports invalid TOML as an error and falls back to the filename", () => {
    const doc = parse("broken.toml");
    expect(doc.name).toBe("broken");
    expect(doc.diagnostics[0]?.severity).toBe("error");
    expect(doc.diagnostics[0]?.message).toContain("Invalid TOML");
    expect(doc.diagnostics).toHaveLength(1);
    expect(doc.native.raw).toBeDefined();
  });
});
```

- [ ] **Step 3: Write the failing tests `src/main/providers/codex/mcp-servers.test.ts`**

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverCodexMcpServers, parseCodexMcpServer } from "./mcp-servers";

const FIXTURES = join(
  import.meta.dirname,
  "../../../../tests/fixtures/discovery",
);
const CODEX_ROOT = join(FIXTURES, "codex-user");
const BROKEN_ROOT = join(FIXTURES, "codex-user-broken");
const CONFIG = join(CODEX_ROOT, "config.toml");

describe("discoverCodexMcpServers", () => {
  it("emits one native per mcp_servers entry, sorted", () => {
    const natives = discoverCodexMcpServers(CODEX_ROOT);
    expect(natives.map((n) => n.entryKey)).toEqual(["github", "incomplete"]);
    expect(natives[0]).toMatchObject({
      provider: "codex",
      kind: "mcp-servers",
      scope: "user",
      paths: [CONFIG],
    });
  });

  it("emits a single marker native for a malformed config.toml", () => {
    const natives = discoverCodexMcpServers(BROKEN_ROOT);
    expect(natives).toHaveLength(1);
    expect(natives[0]?.entryKey).toBeUndefined();
  });

  it("emits nothing when config.toml is missing", () => {
    expect(discoverCodexMcpServers(join(FIXTURES, "nope"))).toEqual([]);
  });
});

describe("parseCodexMcpServer", () => {
  it("parses a healthy server entry", () => {
    const doc = parseCodexMcpServer({
      provider: "codex",
      kind: "mcp-servers",
      scope: "user",
      paths: [CONFIG],
      entryKey: "github",
    });
    expect(doc.name).toBe("github");
    expect(doc.fields["command"]).toBe("npx");
    expect(doc.native.format).toBe("toml");
    expect(doc.diagnostics).toEqual([]);
  });

  it("warns when command and url are both missing", () => {
    const doc = parseCodexMcpServer({
      provider: "codex",
      kind: "mcp-servers",
      scope: "user",
      paths: [CONFIG],
      entryKey: "incomplete",
    });
    expect(doc.diagnostics).toEqual([
      {
        severity: "warning",
        message: "Missing required field: command (or url for remote servers)",
        path: CONFIG,
      },
    ]);
  });

  it("parses the malformed-file marker into a synthetic error resource", () => {
    const doc = parseCodexMcpServer({
      provider: "codex",
      kind: "mcp-servers",
      scope: "user",
      paths: [join(BROKEN_ROOT, "config.toml")],
    });
    expect(doc.name).toBe("MCP configuration");
    expect(doc.diagnostics[0]?.severity).toBe("error");
    expect(doc.diagnostics[0]?.message).toContain("Invalid TOML");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./agents` / `./mcp-servers` under `src/main/providers/codex`.

- [ ] **Step 5: Implement `src/main/providers/codex/agents.ts`**

```ts
import { basename } from "node:path";
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
import type {
  Diagnostic,
  NativeResource,
  ResourceDocument,
} from "../../../shared/resource";
import {
  buildDocument,
  missingFieldDiagnostics,
  stringField,
} from "../shared/document";
import type { ScopeTemplate } from "../shared/document";
import { listFiles, readTextFile } from "../shared/scan";

export function discoverCodexAgents(
  agentsDir: string,
  template: ScopeTemplate,
): NativeResource[] {
  return listFiles(agentsDir, ".toml").map((path) => ({
    ...template,
    kind: "agents",
    paths: [path],
  }));
}

export function parseCodexAgent(native: NativeResource): ResourceDocument {
  const path = native.paths[0];
  const fallbackName = basename(path, ".toml");
  const raw = readTextFile(path);
  if (raw === null) {
    return buildDocument(native, {
      name: fallbackName,
      fields: {},
      native: { format: "toml" },
      diagnostics: [
        { severity: "error", message: "File could not be read", path },
      ],
    });
  }
  let fields: Record<string, unknown> = {};
  const diagnostics: Diagnostic[] = [];
  try {
    const value: unknown = getStaticTOMLValue(parseTOML(raw));
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      fields = value as Record<string, unknown>;
    }
  } catch (error) {
    diagnostics.push({
      severity: "error",
      message: `Invalid TOML: ${error instanceof Error ? error.message : String(error)}`,
      path,
    });
  }
  if (diagnostics.length === 0) {
    diagnostics.push(
      ...missingFieldDiagnostics(fields, ["name", "description"], path),
    );
  }
  return buildDocument(native, {
    name: stringField(fields, "name") ?? fallbackName,
    description: stringField(fields, "description"),
    fields,
    native: { format: "toml", raw },
    diagnostics,
  });
}
```

- [ ] **Step 6: Implement `src/main/providers/codex/mcp-servers.ts`**

```ts
import { join } from "node:path";
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
import type {
  NativeResource,
  ResourceDocument,
} from "../../../shared/resource";
import { buildDocument, stringField } from "../shared/document";
import { readTextFile } from "../shared/scan";

interface CodexConfig {
  servers: Record<string, unknown> | null;
  error: string | null;
}

function readCodexConfig(raw: string): CodexConfig {
  let value: unknown;
  try {
    value = getStaticTOMLValue(parseTOML(raw));
  } catch (error) {
    return {
      servers: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { servers: null, error: "top-level value is not a table" };
  }
  const servers = (value as Record<string, unknown>)["mcp_servers"];
  if (servers === undefined || servers === null)
    return { servers: {}, error: null };
  if (typeof servers !== "object" || Array.isArray(servers)) {
    return { servers: null, error: "mcp_servers is not a table" };
  }
  return { servers: servers as Record<string, unknown>, error: null };
}

export function discoverCodexMcpServers(configRoot: string): NativeResource[] {
  const path = join(configRoot, "config.toml");
  const raw = readTextFile(path);
  if (raw === null) return [];
  const config = readCodexConfig(raw);
  const base: NativeResource = {
    provider: "codex",
    kind: "mcp-servers",
    scope: "user",
    paths: [path],
  };
  if (config.servers === null) {
    // Malformed config.toml: one synthetic marker resource (no entryKey).
    return [base];
  }
  return Object.keys(config.servers)
    .sort()
    .map((name) => ({ ...base, entryKey: name }));
}

export function parseCodexMcpServer(native: NativeResource): ResourceDocument {
  const path = native.paths[0];
  const raw = readTextFile(path);
  if (raw === null) {
    return buildDocument(native, {
      name: native.entryKey ?? "MCP configuration",
      fields: {},
      native: { format: "toml" },
      diagnostics: [
        { severity: "error", message: "File could not be read", path },
      ],
    });
  }
  const config = readCodexConfig(raw);
  if (native.entryKey === undefined || config.servers === null) {
    return buildDocument(native, {
      name: "MCP configuration",
      fields: {},
      native: { format: "toml", raw },
      diagnostics: [
        {
          severity: "error",
          message: `Invalid TOML: ${config.error ?? "unexpected content"}`,
          path,
        },
      ],
    });
  }
  const entry = config.servers[native.entryKey];
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return buildDocument(native, {
      name: native.entryKey,
      fields: {},
      native: { format: "toml", raw },
      diagnostics: [
        {
          severity: "error",
          message: `Server entry no longer present: ${native.entryKey}`,
          path,
        },
      ],
    });
  }
  const fields = entry as Record<string, unknown>;
  const diagnostics =
    stringField(fields, "command") === undefined &&
    stringField(fields, "url") === undefined
      ? [
          {
            severity: "warning" as const,
            message:
              "Missing required field: command (or url for remote servers)",
            path,
          },
        ]
      : [];
  return buildDocument(native, {
    name: native.entryKey,
    fields,
    native: { format: "toml", raw },
    diagnostics,
  });
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/main/providers/codex tests/fixtures/discovery
git commit -m "feat: codex agent and mcp server discovery scanners

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Wire the adapters — real discover/parse, honest capabilities

**Files:**

- Modify: `src/main/providers/codex.ts`
- Modify: `src/main/providers/claude.ts`
- Modify: `src/main/providers/adapters.test.ts`

**Interfaces:**

- Consumes: every scanner from Tasks 3–6; `AppOperationError`.
- Produces: `createCodexAdapter(options?: AdapterOptions)` unchanged signature; `createClaudeAdapter(options?: ClaudeAdapterOptions)` where `ClaudeAdapterOptions extends AdapterOptions { userMcpPath?: string }` (default `join(homedir(), '.claude.json')`). `discover(context)` returns natives for all M2 kinds; `parse(source)` dispatches on `source.kind`; `validate`/`plan` still throw `not-implemented`. Capabilities shrink to Codex: agents, skills, mcp-servers, instructions; Claude: agents, skills, commands, mcp-servers, instructions. Consumed by Task 8's ResourceService.

- [ ] **Step 1: Update the tests `src/main/providers/adapters.test.ts`**

Replace the whole file with:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppOperationError } from "../errors";
import { createClaudeAdapter } from "./claude";
import { createCodexAdapter } from "./codex";
import { ProviderRegistry, createDefaultRegistry } from "./registry";

const FIXTURES = join(import.meta.dirname, "../../../tests/fixtures/discovery");

let existingRoot: string;

beforeEach(() => {
  existingRoot = mkdtempSync(join(tmpdir(), "agent-control-provider-"));
});

afterEach(() => {
  rmSync(existingRoot, { recursive: true, force: true });
});

describe("provider adapters", () => {
  it("detects a provider when its config root exists", async () => {
    const adapter = createCodexAdapter({ configRoot: existingRoot });
    expect(await adapter.detect()).toEqual({
      id: "codex",
      displayName: "Codex",
      detected: true,
      configRoot: existingRoot,
    });
  });

  it("reports not detected when the config root is missing", async () => {
    const missing = join(existingRoot, "nope");
    const adapter = createClaudeAdapter({ configRoot: missing });
    expect(await adapter.detect()).toEqual({
      id: "claude",
      displayName: "Claude Code",
      detected: false,
      configRoot: null,
    });
  });

  it("exposes only categories discovery serves (spec: provider honesty)", () => {
    const codexCategories = createCodexAdapter().capabilities().categories;
    const claudeCategories = createClaudeAdapter().capabilities().categories;
    expect(codexCategories.map((c) => c.id)).toEqual([
      "agents",
      "skills",
      "mcp-servers",
      "instructions",
    ]);
    expect(claudeCategories.map((c) => c.id)).toEqual([
      "agents",
      "skills",
      "commands",
      "mcp-servers",
      "instructions",
    ]);
  });

  it("throws not-implemented for milestone 3 operations", async () => {
    const adapter = createCodexAdapter();
    await expect(
      adapter.validate({
        provider: "codex",
        kind: "agents",
        scope: "user",
        fields: {},
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppOperationError && error.code === "not-implemented",
    );
  });
});

describe("adapter discovery integration", () => {
  const context = {
    projects: [{ id: "project-1", path: join(FIXTURES, "project") }],
  };

  it("codex adapter discovers fixture resources across kinds and scopes", async () => {
    const adapter = createCodexAdapter({
      configRoot: join(FIXTURES, "codex-user"),
    });
    const natives = await adapter.discover(context);
    const count = (kind: string) =>
      natives.filter((n) => n.kind === kind).length;
    expect(count("agents")).toBe(3);
    expect(count("skills")).toBe(2);
    expect(count("mcp-servers")).toBe(2);
    expect(count("instructions")).toBe(2);
    expect(natives.filter((n) => n.scope === "project")).toHaveLength(1);
    for (const native of natives) {
      const doc = await adapter.parse(native);
      expect(doc.provider).toBe("codex");
      expect(doc.kind).toBe(native.kind);
    }
  });

  it("claude adapter discovers fixture resources across kinds and scopes", async () => {
    const adapter = createClaudeAdapter({
      configRoot: join(FIXTURES, "claude-user"),
      userMcpPath: join(FIXTURES, "claude-user.json"),
    });
    const natives = await adapter.discover(context);
    const count = (kind: string) =>
      natives.filter((n) => n.kind === kind).length;
    expect(count("agents")).toBe(4);
    expect(count("skills")).toBe(3);
    expect(count("commands")).toBe(4);
    expect(count("mcp-servers")).toBe(3);
    expect(count("instructions")).toBe(2);
    expect(natives.filter((n) => n.scope === "project")).toHaveLength(5);
    for (const native of natives) {
      const doc = await adapter.parse(native);
      expect(doc.provider).toBe("claude");
      expect(doc.kind).toBe(native.kind);
    }
  });

  it("parse rejects an unknown resource kind", async () => {
    const adapter = createCodexAdapter({
      configRoot: join(FIXTURES, "codex-user"),
    });
    await expect(
      adapter.parse({
        provider: "codex",
        kind: "plugins",
        scope: "user",
        paths: ["/tmp/x"],
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppOperationError && error.code === "invalid-request",
    );
  });
});

describe("ProviderRegistry", () => {
  it("registers and retrieves adapters by id", () => {
    const registry = new ProviderRegistry();
    const codex = createCodexAdapter();
    registry.register(codex);
    expect(registry.get("codex")).toBe(codex);
    expect(registry.all()).toEqual([codex]);
  });

  it("default registry contains codex and claude", () => {
    const registry = createDefaultRegistry();
    expect(registry.all().map((a) => a.id)).toEqual(["codex", "claude"]);
  });

  it("throws for an unknown provider id", () => {
    expect(() => new ProviderRegistry().get("codex")).toThrowError(
      AppOperationError,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify the new assertions fail**

Run: `bun run test`
Expected: FAIL — capabilities still list plugins/hooks; `discover` throws not-implemented.

- [ ] **Step 3: Rewrite `src/main/providers/codex.ts`**

```ts
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AppOperationError } from "../errors";
import { discoverCodexAgents, parseCodexAgent } from "./codex/agents";
import {
  discoverCodexMcpServers,
  parseCodexMcpServer,
} from "./codex/mcp-servers";
import {
  discoverInstructionsFile,
  parseInstructions,
} from "./shared/instructions";
import { discoverSkills, parseSkill } from "./shared/skills";
import type { ProviderAdapter } from "./types";

export interface AdapterOptions {
  configRoot?: string;
}

function notImplemented(operation: string): never {
  throw new AppOperationError(
    "not-implemented",
    operation,
    "Editing arrives in Milestone 3.",
  );
}

export function createCodexAdapter(
  options: AdapterOptions = {},
): ProviderAdapter {
  const configRoot = options.configRoot ?? join(homedir(), ".codex");
  return {
    id: "codex",
    async detect() {
      const detected = existsSync(configRoot);
      return {
        id: "codex",
        displayName: "Codex",
        detected,
        configRoot: detected ? configRoot : null,
      };
    },
    capabilities() {
      return {
        providerId: "codex",
        displayName: "Codex",
        categories: [
          { id: "agents", label: "Agents" },
          { id: "skills", label: "Skills" },
          { id: "mcp-servers", label: "MCP Servers" },
          { id: "instructions", label: "Instructions" },
        ],
      };
    },
    async discover(context) {
      return [
        ...discoverCodexAgents(join(configRoot, "agents"), {
          provider: "codex",
          scope: "user",
        }),
        ...discoverSkills(join(configRoot, "skills"), {
          provider: "codex",
          scope: "user",
        }),
        ...discoverCodexMcpServers(configRoot),
        ...discoverInstructionsFile(join(configRoot, "AGENTS.md"), {
          provider: "codex",
          scope: "user",
        }),
        ...context.projects.flatMap((project) =>
          discoverInstructionsFile(join(project.path, "AGENTS.md"), {
            provider: "codex",
            scope: "project",
            projectId: project.id,
          }),
        ),
      ];
    },
    async parse(source) {
      switch (source.kind) {
        case "agents":
          return parseCodexAgent(source);
        case "skills":
          return parseSkill(source);
        case "mcp-servers":
          return parseCodexMcpServer(source);
        case "instructions":
          return parseInstructions(source);
        default:
          throw new AppOperationError(
            "invalid-request",
            "codex:parse",
            `Unknown resource kind: ${source.kind}`,
          );
      }
    },
    async validate() {
      return notImplemented("codex:validate");
    },
    async plan() {
      return notImplemented("codex:plan");
    },
  };
}
```

- [ ] **Step 4: Rewrite `src/main/providers/claude.ts`**

```ts
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AppOperationError } from "../errors";
import { discoverClaudeAgents, parseClaudeAgent } from "./claude/agents";
import { discoverClaudeCommands, parseClaudeCommand } from "./claude/commands";
import {
  discoverClaudeMcpServers,
  parseClaudeMcpServer,
} from "./claude/mcp-servers";
import type { AdapterOptions } from "./codex";
import {
  discoverInstructionsFile,
  parseInstructions,
} from "./shared/instructions";
import { discoverSkills, parseSkill } from "./shared/skills";
import type { ProviderAdapter } from "./types";

export interface ClaudeAdapterOptions extends AdapterOptions {
  /** The shared user-scope MCP config (~/.claude.json), overridable in tests. */
  userMcpPath?: string;
}

function notImplemented(operation: string): never {
  throw new AppOperationError(
    "not-implemented",
    operation,
    "Editing arrives in Milestone 3.",
  );
}

export function createClaudeAdapter(
  options: ClaudeAdapterOptions = {},
): ProviderAdapter {
  const configRoot = options.configRoot ?? join(homedir(), ".claude");
  const userMcpPath = options.userMcpPath ?? join(homedir(), ".claude.json");
  return {
    id: "claude",
    async detect() {
      const detected = existsSync(configRoot);
      return {
        id: "claude",
        displayName: "Claude Code",
        detected,
        configRoot: detected ? configRoot : null,
      };
    },
    capabilities() {
      return {
        providerId: "claude",
        displayName: "Claude Code",
        categories: [
          { id: "agents", label: "Agents" },
          { id: "skills", label: "Skills" },
          { id: "commands", label: "Commands" },
          { id: "mcp-servers", label: "MCP Servers" },
          { id: "instructions", label: "Instructions" },
        ],
      };
    },
    async discover(context) {
      const user = { provider: "claude" as const, scope: "user" as const };
      const forProject = (id: string) => ({
        provider: "claude" as const,
        scope: "project" as const,
        projectId: id,
      });
      return [
        ...discoverClaudeAgents(join(configRoot, "agents"), user),
        ...context.projects.flatMap((project) =>
          discoverClaudeAgents(
            join(project.path, ".claude", "agents"),
            forProject(project.id),
          ),
        ),
        ...discoverSkills(join(configRoot, "skills"), user),
        ...context.projects.flatMap((project) =>
          discoverSkills(
            join(project.path, ".claude", "skills"),
            forProject(project.id),
          ),
        ),
        ...discoverClaudeCommands(join(configRoot, "commands"), user),
        ...context.projects.flatMap((project) =>
          discoverClaudeCommands(
            join(project.path, ".claude", "commands"),
            forProject(project.id),
          ),
        ),
        ...discoverClaudeMcpServers(userMcpPath, context.projects),
        ...discoverInstructionsFile(join(configRoot, "CLAUDE.md"), user),
        ...context.projects.flatMap((project) =>
          discoverInstructionsFile(
            join(project.path, "CLAUDE.md"),
            forProject(project.id),
          ),
        ),
      ];
    },
    async parse(source) {
      switch (source.kind) {
        case "agents":
          return parseClaudeAgent(source);
        case "skills":
          return parseSkill(source);
        case "commands":
          return parseClaudeCommand(source);
        case "mcp-servers":
          return parseClaudeMcpServer(source);
        case "instructions":
          return parseInstructions(source);
        default:
          throw new AppOperationError(
            "invalid-request",
            "claude:parse",
            `Unknown resource kind: ${source.kind}`,
          );
      }
    },
    async validate() {
      return notImplemented("claude:validate");
    },
    async plan() {
      return notImplemented("claude:plan");
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS (all suites, including the new integration tests).

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/providers
git commit -m "feat: wire real discovery into codex and claude adapters

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: ResourceService — list and safe read

**Files:**

- Create: `src/main/services/resources.ts`
- Create: `src/main/services/resources.test.ts`

**Interfaces:**

- Consumes: `ProviderRegistry` (`registry.all()`, `registry.get(id)`), `ProjectsStore.list()`, `decodeResourceId`, adapter `discover`/`parse`. This task does NOT touch `src/shared/ipc.ts`: it defines and exports `ResourceQuery`/`ResourceSummary` itself so it is testable standalone. Task 9 adds structurally-identical Zod schemas to `ipc.ts`; the two stay compatible because both derive from `ResourceDocument`.
- Produces: `class ResourceService { constructor(registry: ProviderRegistry, projects: ProjectsStore); list(query: ResourceQuery): Promise<ResourceSummary[]>; read(id: string): Promise<ResourceDocument> }`, `interface ResourceQuery { providerId?: ProviderId; kind?: string; scope?: 'user' | 'project'; projectId?: string }`, `type ResourceSummary = Omit<ResourceDocument, 'fields' | 'native'>` from `src/main/services/resources.ts`. Consumed by Task 9's IPC handlers.

- [ ] **Step 1: Write the failing tests `src/main/services/resources.test.ts`**

```ts
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AppOperationError } from "../errors";
import { createClaudeAdapter } from "../providers/claude";
import { createCodexAdapter } from "../providers/codex";
import { ProviderRegistry } from "../providers/registry";
import { encodeResourceId } from "../providers/shared/resource-id";
import { openDatabase } from "./db";
import { ProjectsStore } from "./projects-store";
import { ResourceService } from "./resources";

const FIXTURES = join(import.meta.dirname, "../../../tests/fixtures/discovery");

let service: ResourceService;
let projectId: string;

beforeEach(() => {
  const registry = new ProviderRegistry();
  registry.register(
    createCodexAdapter({ configRoot: join(FIXTURES, "codex-user") }),
  );
  registry.register(
    createClaudeAdapter({
      configRoot: join(FIXTURES, "claude-user"),
      userMcpPath: join(FIXTURES, "claude-user.json"),
    }),
  );
  const projects = new ProjectsStore(openDatabase(":memory:"));
  projectId = projects.add(join(FIXTURES, "project")).id;
  service = new ResourceService(registry, projects);
});

describe("ResourceService.list", () => {
  it("lists every discovered resource with no query", async () => {
    // codex: 3 agents + 2 skills + 2 mcp + 2 instructions = 9
    // claude: 4 agents + 3 skills + 4 commands + 3 mcp + 2 instructions = 16
    expect(await service.list({})).toHaveLength(25);
  });

  it("filters by provider, kind, scope, and project", async () => {
    expect(await service.list({ providerId: "codex" })).toHaveLength(9);
    expect(await service.list({ kind: "agents" })).toHaveLength(7);
    expect(await service.list({ scope: "project" })).toHaveLength(6);
    expect(await service.list({ projectId })).toHaveLength(6);
    expect(
      await service.list({
        providerId: "claude",
        kind: "mcp-servers",
        scope: "user",
      }),
    ).toHaveLength(2);
  });

  it("returns summaries without fields or native content", async () => {
    const summaries = await service.list({
      providerId: "codex",
      kind: "agents",
    });
    expect(summaries[0]).not.toHaveProperty("fields");
    expect(summaries[0]).not.toHaveProperty("native");
    expect(summaries[0]?.diagnostics).toBeDefined();
    expect(summaries[0]?.modifiedAt).toBeDefined();
  });
});

describe("ResourceService.read", () => {
  it("round-trips an id from list", async () => {
    const summaries = await service.list({
      providerId: "claude",
      kind: "agents",
      scope: "user",
    });
    const target = summaries.find((s) => s.name === "code-reviewer");
    if (!target) throw new Error("fixture agent not found in list");
    const doc = await service.read(target.id);
    expect(doc.fields["model"]).toBe("sonnet");
    expect(doc.native.raw).toContain("meticulous");
  });

  it("rejects a forged id pointing outside discovered resources", async () => {
    const forged = encodeResourceId({
      provider: "claude",
      kind: "agents",
      scope: "user",
      path: "/etc/passwd",
    });
    await expect(service.read(forged)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppOperationError && error.code === "not-found",
    );
  });

  it("rejects a malformed id", async () => {
    await expect(service.read("not-a-real-id")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppOperationError && error.code === "invalid-request",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./resources`.

- [ ] **Step 3: Implement `src/main/services/resources.ts`**

```ts
import type {
  DiscoveryContext,
  NativeResource,
  ProviderId,
  ResourceDocument,
} from "../../shared/resource";
import { AppOperationError } from "../errors";
import type { ProviderRegistry } from "../providers/registry";
import { decodeResourceId } from "../providers/shared/resource-id";
import type { ProjectsStore } from "./projects-store";

export interface ResourceQuery {
  providerId?: ProviderId;
  kind?: string;
  scope?: "user" | "project";
  projectId?: string;
}

export type ResourceSummary = Omit<ResourceDocument, "fields" | "native">;

function matches(native: NativeResource, query: ResourceQuery): boolean {
  if (query.kind !== undefined && native.kind !== query.kind) return false;
  if (query.scope !== undefined && native.scope !== query.scope) return false;
  if (query.projectId !== undefined && native.projectId !== query.projectId)
    return false;
  return true;
}

function toSummary(doc: ResourceDocument): ResourceSummary {
  const { fields: _fields, native: _native, ...summary } = doc;
  return summary;
}

/**
 * Scan-on-demand resource access (design section 2). No cache: every call
 * rescans. read() only parses what discovery finds, so a forged id can never
 * reach a path outside approved roots.
 */
export class ResourceService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly projects: ProjectsStore,
  ) {}

  private context(): DiscoveryContext {
    return {
      projects: this.projects.list().map((project) => ({
        id: project.id,
        path: project.path,
      })),
    };
  }

  async list(query: ResourceQuery): Promise<ResourceSummary[]> {
    const adapters = this.registry
      .all()
      .filter(
        (adapter) =>
          query.providerId === undefined || adapter.id === query.providerId,
      );
    const summaries: ResourceSummary[] = [];
    for (const adapter of adapters) {
      const natives = (await adapter.discover(this.context())).filter(
        (native) => matches(native, query),
      );
      for (const native of natives) {
        summaries.push(toSummary(await adapter.parse(native)));
      }
    }
    return summaries;
  }

  async read(id: string): Promise<ResourceDocument> {
    const ref = decodeResourceId(id);
    const adapter = this.registry.get(ref.provider);
    const natives = await adapter.discover(this.context());
    const match = natives.find(
      (native) =>
        native.kind === ref.kind &&
        native.scope === ref.scope &&
        native.projectId === ref.projectId &&
        native.paths[0] === ref.path &&
        native.entryKey === ref.entryKey,
    );
    if (!match) {
      throw new AppOperationError(
        "not-found",
        "resources:read",
        `Resource no longer exists: ${ref.path}`,
        { path: ref.path },
      );
    }
    return adapter.parse(match);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/services
git commit -m "feat: resource service with scan-on-demand list and safe read"
```

---

### Task 9: IPC channels, DesktopApi, preload, and main wiring

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipc.test.ts`
- Modify: `src/shared/desktop-api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: Task 8's `ResourceService`; existing `handle()` helper in `handlers.ts`; existing `invoke()` helper in preload.
- Produces: `resources:list` / `resources:read` channels in `ipcContract`; `diagnosticSchema`, `resourceScopeSchema`, `resourceQuerySchema` + `ResourceQuery`, `resourceSummarySchema` + `ResourceSummary`, `resourceDocumentSchema` exported from `src/shared/ipc.ts`; `DesktopApi.resources.list(query?) / .read(id)`. Consumed by Task 11's renderer screens (via `window.desktopApi`).

- [ ] **Step 1: Extend the tests `src/shared/ipc.test.ts`**

Add to the imports: `resourceDocumentSchema, resourceSummarySchema` (from `./ipc`). Append inside the existing `describe('ipc contract schemas', ...)` block:

```ts
  it('accepts an empty resources:list query and rejects an unsupported scope', () => {
    expect(ipcContract['resources:list'].request.safeParse({}).success).toBe(true)
    expect(
      ipcContract['resources:list'].request.safeParse({
        providerId: 'codex',
        kind: 'agents',
        scope: 'user'
      }).success
    ).toBe(true)
    expect(
      ipcContract['resources:list'].request.safeParse({ scope: 'directory' }).success
    ).toBe(false)
  })

  it('requires an id for resources:read', () => {
    expect(ipcContract['resources:read'].request.safeParse({}).success).toBe(false)
    expect(ipcContract['resources:read'].request.safeParse({ id: 'abc' }).success).toBe(true)
  })

  it('accepts resource summary and document shapes', () => {
    const summary = {
      id: 'abc',
      provider: 'claude',
      kind: 'agents',
      name: 'code-reviewer',
      scope: 'user',
      enabled: 'unsupported',
      sourcePaths: ['/tmp/a.md'],
      diagnostics: [
        { severity: 'warning', message: 'Missing required field: description' }
      ],
      modifiedAt: '2026-07-08T12:00:00.000Z'
    }
    expect(resourceSummarySchema.safeParse(summary).success).toBe(true)
    const document = {
      ...summary,
      fields: { model: 'sonnet' },
      native: { format: 'markdown', raw: '---\n' }
    }
    expect(resourceDocumentSchema.safeParse(document).success).toBe(true)
    expect(resourceDocumentSchema.safeParse(summary).success).toBe(false)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `resources:list` not in contract; schemas not exported.

- [ ] **Step 3: Extend `src/shared/ipc.ts`**

Insert after the `appErrorSchema` block (before `ipcContract`):

```ts
export const resourceScopeSchema = z.enum(['user', 'project', 'directory'])

export const diagnosticSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  path: z.string().optional()
})

export const resourceQuerySchema = z.object({
  providerId: providerIdSchema.optional(),
  kind: z.string().optional(),
  scope: z.enum(['user', 'project']).optional(),
  projectId: z.string().optional()
})
export type ResourceQuery = z.infer<typeof resourceQuerySchema>

export const resourceSummarySchema = z.object({
  id: z.string(),
  provider: providerIdSchema,
  kind: z.string(),
  name: z.string(),
  description: z.string().optional(),
  scope: resourceScopeSchema,
  projectId: z.string().optional(),
  enabled: z.union([z.boolean(), z.literal('unsupported')]),
  sourcePaths: z.array(z.string()),
  diagnostics: z.array(diagnosticSchema),
  modifiedAt: z.string()
})
export type ResourceSummary = z.infer<typeof resourceSummarySchema>

export const resourceDocumentSchema = resourceSummarySchema.extend({
  fields: z.record(z.string(), z.unknown()),
  native: z.object({
    format: z.enum(['markdown', 'json', 'toml', 'yaml', 'directory', 'unknown']),
    raw: z.string().optional(),
    unknownFields: z.record(z.string(), z.unknown()).optional()
  })
})
```

Add to `ipcContract`:

```ts
  'resources:list': {
    request: resourceQuerySchema,
    response: z.array(resourceSummarySchema)
  },
  'resources:read': {
    request: z.object({ id: z.string() }),
    response: resourceDocumentSchema
  }
```

- [ ] **Step 4: Rewrite `src/shared/desktop-api.ts`**

```ts
import type {
  Project,
  ProviderCapabilities,
  ProviderStatus,
  ResourceQuery,
  ResourceSummary
} from './ipc'
import type { ResourceDocument } from './resource'

/**
 * The complete surface the preload exposes to the renderer. No generic
 * filesystem access is ever added here (spec section 10.2).
 */
export interface DesktopApi {
  providers: {
    detect(): Promise<ProviderStatus[]>
    capabilities(): Promise<ProviderCapabilities[]>
  }
  projects: {
    add(): Promise<Project | null>
    list(): Promise<Project[]>
    remove(id: string): Promise<void>
  }
  resources: {
    list(query?: ResourceQuery): Promise<ResourceSummary[]>
    read(id: string): Promise<ResourceDocument>
  }
}
```

Note: `IpcResponse<'resources:read'>` (the Zod inference) and `ResourceDocument` (the interface) are structurally identical, so the preload assignment typechecks.

- [ ] **Step 5: Add the resources section to `src/preload/index.ts`**

In the `const api: DesktopApi = { ... }` object, after `projects`, add:

```ts
  resources: {
    list: (query) => invoke('resources:list', query ?? {}),
    read: (id) => invoke('resources:read', { id })
  }
```

- [ ] **Step 6: Register the handlers in `src/main/ipc/handlers.ts`**

Add the import: `import type { ResourceService } from '../services/resources'`. Extend `HandlerDeps`:

```ts
export interface HandlerDeps {
  projects: ProjectsStore
  registry: ProviderRegistry
  resources: ResourceService
  pickDirectory(): Promise<string | null>
}
```

Append inside `registerIpcHandlers`:

```ts
  handle('resources:list', (request) => deps.resources.list(request))
  handle('resources:read', (request) => deps.resources.read(request.id))
```

- [ ] **Step 7: Wire the service in `src/main/index.ts`**

Add the import: `import { ResourceService } from './services/resources'`. Replace the `whenReady` registration block body with:

```ts
void app.whenReady().then(() => {
  const db = openDatabase(join(app.getPath('userData'), 'agent-control.db'))
  const registry = createDefaultRegistry()
  const projects = new ProjectsStore(db)
  registerIpcHandlers({
    projects,
    registry,
    resources: new ResourceService(registry, projects),
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog({
        title: 'Add project',
        properties: ['openDirectory', 'createDirectory']
      })
      return result.canceled || result.filePaths.length === 0
        ? null
        : result.filePaths[0]
    }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0. If the `handle('resources:list', ...)` line errors because `ResourceService.list` takes its own `ResourceQuery` type (Task 8) while `IpcRequest<'resources:list'>` is the Zod inference, change `src/main/services/resources.ts` to import the type instead of defining it: `import type { ResourceQuery, ResourceSummary } from '../../shared/ipc'` — but keep `ResourceSummary` as `Omit<ResourceDocument, 'fields' | 'native'>` only if the inferred import fails too. The Zod-inferred and hand-written types are structurally identical, so plain structural typing is expected to succeed without changes.

- [ ] **Step 9: Commit**

```bash
git add src/shared src/preload src/main
git commit -m "feat: resources list/read IPC channels and desktop api

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Renderer credential masking and Input component

**Files:**
- Create: `src/renderer/src/lib/mask.ts`
- Create: `src/renderer/src/lib/mask.test.ts`
- Create: `src/renderer/src/components/ui/input.tsx`

**Interfaces:**
- Consumes: nothing project-specific (pure functions + `cn` from `@renderer/lib/utils`).
- Produces: `maskSecretText(text: string): string`, `maskValue(key: string, value: unknown): unknown`, `formatFieldValue(key: string, value: unknown): string` from `lib/mask.ts`; `Input` component from `ui/input.tsx`. Consumed by Task 11's inspector (fields section) and list screen (search box).

- [ ] **Step 1: Write the failing tests `src/renderer/src/lib/mask.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { formatFieldValue, maskSecretText, maskValue } from './mask'

describe('maskSecretText', () => {
  it('masks provider-prefixed tokens', () => {
    expect(
      maskSecretText('--access-token=sbp_839af9cff7c851047bd63ba87173d29b35e098c0')
    ).toBe('--access-token=••••')
    expect(maskSecretText('ghp_example1234567890abcd')).toBe('••••')
  })

  it('masks key=value credential assignments', () => {
    expect(maskSecretText('password=hunter2secret')).toBe('password=••••')
  })

  it('leaves ordinary text alone', () => {
    expect(maskSecretText('npx')).toBe('npx')
    expect(maskSecretText('@modelcontextprotocol/server-github')).toBe(
      '@modelcontextprotocol/server-github'
    )
  })
})

describe('maskValue', () => {
  it('masks whole values under secret-like keys', () => {
    expect(maskValue('apiKey', 'plainvalue')).toBe('••••')
    expect(maskValue('GITHUB_TOKEN', 'anything')).toBe('••••')
  })

  it('recurses into objects, masking by nested key', () => {
    expect(
      maskValue('env', { GITHUB_TOKEN: 'ghp_example1234567890abcd', PORT: '3000' })
    ).toEqual({ GITHUB_TOKEN: '••••', PORT: '3000' })
  })

  it('masks token-shaped strings inside arrays', () => {
    expect(
      maskValue('args', ['-y', '--access-token=sbp_839af9cff7c851047bd63ba87173d29b35e098c0'])
    ).toEqual(['-y', '--access-token=••••'])
  })

  it('passes through non-secret scalars', () => {
    expect(maskValue('command', 'npx')).toBe('npx')
    expect(maskValue('startup_timeout_sec', 120)).toBe(120)
  })
})

describe('formatFieldValue', () => {
  it('returns strings directly and JSON for structures', () => {
    expect(formatFieldValue('command', 'npx')).toBe('npx')
    expect(formatFieldValue('env', { PORT: '3000' })).toBe('{\n  "PORT": "3000"\n}')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./mask`.

- [ ] **Step 3: Implement `src/renderer/src/lib/mask.ts`**

```ts
const MASK = '••••'

// Known credential token shapes (GitHub, Supabase, Slack, OpenAI-style, GitLab).
const TOKEN_SHAPE = /\b(?:sk|sbp|ghp|gho|ghu|ghs|xoxb|xoxp|glpat|pat)[-_][A-Za-z0-9_-]{10,}/g

// key=value / key: value assignments whose key sounds like a credential.
const ASSIGNMENT = /\b(token|secret|password|api[-_]?key|access[-_]?key)(\s*[=:]\s*)[^\s"']+/gi

const SECRET_KEY = /token|secret|password|credential|api[-_]?key|access[-_]?key/i

/** Mask credential-shaped substrings in display text (spec section 14). */
export function maskSecretText(text: string): string {
  return text.replace(TOKEN_SHAPE, MASK).replace(ASSIGNMENT, `$1$2${MASK}`)
}

/** Recursively mask a field value: by key name, then by string content. */
export function maskValue(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) return MASK
  if (typeof value === 'string') return maskSecretText(value)
  if (Array.isArray(value)) return value.map((item) => maskValue(key, item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nested]) => [
        nestedKey,
        maskValue(nestedKey, nested)
      ])
    )
  }
  return value
}

/** Human-readable, credential-masked rendering of one resource field. */
export function formatFieldValue(key: string, value: unknown): string {
  const masked = maskValue(key, value)
  return typeof masked === 'string' ? masked : JSON.stringify(masked, null, 2)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS. If the `--access-token=…` case produces a doubled mask (both patterns firing), the expected output stays `'--access-token=••••'` because ASSIGNMENT's `[^\s"']+` consumes the already-masked value idempotently — if the actual output differs, adjust the ASSIGNMENT replacement order (run TOKEN_SHAPE first, as written).

- [ ] **Step 5: Write `src/renderer/src/components/ui/input.tsx`**

```tsx
import * as React from 'react'

import { cn } from '@renderer/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-8 w-full min-w-0 rounded-md border border-border bg-transparent px-3 py-1 text-[13px] transition-[color,box-shadow] outline-none',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Input }
```

- [ ] **Step 6: Verify typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/lib src/renderer/src/components/ui
git commit -m "feat: credential masking helpers and input component

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Renderer — resource list screen and inspector

**Files:**
- Create: `src/renderer/src/components/ResourceInspector.tsx`
- Create: `src/renderer/src/screens/ResourceListScreen.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `window.desktopApi.resources.list/read`, `window.desktopApi.projects.list` (Task 9); `formatFieldValue` (Task 10); `Input`, `Badge`, `Button`, `EmptyState`, `ProviderLogo`, `cn` (existing).
- Produces: `ResourceListScreen({ providerId, kind, title, kindLabel })` and `ResourceInspector({ resourceId, kindLabel, projectName })`. Routed from `App.tsx` for every `provider/<id>/<category>` nav key — categories still come from `capabilities()`, nothing hard-coded.

- [ ] **Step 1: Write `src/renderer/src/components/ResourceInspector.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import type { ResourceDocument } from '@shared/resource'
import { formatFieldValue } from '../lib/mask'
import { Badge } from './ui/badge'
import { ProviderLogo } from './ProviderLogo'

interface ResourceInspectorProps {
  resourceId: string
  kindLabel: string
  projectName?: string
}

export function ResourceInspector({ resourceId, kindLabel, projectName }: ResourceInspectorProps) {
  const [doc, setDoc] = useState<ResourceDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setError(null)
    window.desktopApi.resources
      .read(resourceId)
      .then((loaded) => {
        if (!cancelled) setDoc(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [resourceId])

  if (error) {
    return (
      <p role="alert" className="p-6 text-[13px] text-destructive">
        {error}
      </p>
    )
  }
  if (!doc) {
    return <p className="p-6 text-[13px] text-muted-foreground">Loading…</p>
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <ProviderLogo providerId={doc.provider} className="size-4" />
          <h2 className="text-[15px] font-semibold tracking-tight">{doc.name}</h2>
          <Badge variant="outline">{kindLabel}</Badge>
          <Badge variant="secondary">
            {doc.scope === 'user' ? 'User' : (projectName ?? 'Project')}
          </Badge>
        </div>
        {doc.description ? (
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {doc.description}
          </p>
        ) : null}
        <div className="mt-3 flex flex-col gap-1">
          {doc.sourcePaths.map((path) => (
            <code key={path} className="truncate font-mono text-[11px] text-muted-foreground">
              {path}
            </code>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Modified {new Date(doc.modifiedAt).toLocaleString()}
        </p>
      </header>

      {doc.diagnostics.length > 0 ? (
        <section className="border-b border-border px-6 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Diagnostics
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {doc.diagnostics.map((diagnostic, index) => (
              <li key={index} className="flex items-start gap-2 text-[12px]">
                {diagnostic.severity === 'error' ? (
                  <OctagonAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                ) : diagnostic.severity === 'warning' ? (
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                ) : (
                  <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span>
                  <span className="sr-only">{diagnostic.severity}: </span>
                  {diagnostic.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {Object.keys(doc.fields).length > 0 ? (
        <section className="border-b border-border px-6 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Fields
          </h3>
          <dl className="mt-2 flex flex-col gap-2">
            {Object.entries(doc.fields).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[140px_1fr] gap-2 text-[12px]">
                <dt className="truncate font-mono text-muted-foreground">{key}</dt>
                <dd className="max-h-40 min-w-0 overflow-y-auto font-mono whitespace-pre-wrap break-words">
                  {formatFieldValue(key, value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {doc.native.raw !== undefined ? (
        <section className="px-6 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Source
          </h3>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
            {doc.native.raw}
          </pre>
        </section>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Write `src/renderer/src/screens/ResourceListScreen.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, OctagonAlert, RefreshCw, Search } from 'lucide-react'
import type { Project, ResourceSummary } from '@shared/ipc'
import type { ProviderId } from '@shared/resource'
import { EmptyState } from '../components/EmptyState'
import { ResourceInspector } from '../components/ResourceInspector'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { cn } from '../lib/utils'

interface ResourceListScreenProps {
  providerId: ProviderId
  kind: string
  title: string
  kindLabel: string
}

export function ResourceListScreen({ providerId, kind, title, kindLabel }: ResourceListScreenProps) {
  const [summaries, setSummaries] = useState<ResourceSummary[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setError(null)
    window.desktopApi.resources
      .list({ providerId, kind })
      .then(setSummaries)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause))
      )
    window.desktopApi.projects
      .list()
      .then(setProjects)
      .catch(() => setProjects([]))
  }, [providerId, kind])

  useEffect(refresh, [refresh])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (summaries ?? []).filter((summary) => {
      if (scopeFilter === 'user' && summary.scope !== 'user') return false
      if (scopeFilter !== 'all' && scopeFilter !== 'user' && summary.projectId !== scopeFilter) {
        return false
      }
      if (query === '') return true
      return (
        summary.name.toLowerCase().includes(query) ||
        (summary.description ?? '').toLowerCase().includes(query)
      )
    })
  }, [summaries, search, scopeFilter])

  const projectName = (id?: string) => projects.find((project) => project.id === id)?.name

  const worstSeverity = (summary: ResourceSummary): 'error' | 'warning' | null =>
    summary.diagnostics.some((d) => d.severity === 'error')
      ? 'error'
      : summary.diagnostics.some((d) => d.severity === 'warning')
        ? 'warning'
        : null

  const selected = visible.find((summary) => summary.id === selectedId)

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-border">
        <div className="flex flex-col gap-2 border-b border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="px-1 text-[13px] font-semibold tracking-tight">{title}</h1>
            <Button variant="ghost" size="sm" aria-label="Refresh" onClick={refresh}>
              <RefreshCw aria-hidden />
            </Button>
          </div>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              placeholder="Search by name or description"
              aria-label="Search resources"
              className="pl-8"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            aria-label="Filter by scope"
            className="h-8 rounded-md border border-border bg-transparent px-2 text-[12px] text-foreground"
            value={scopeFilter}
            onChange={(event) => setScopeFilter(event.target.value)}
          >
            <option value="all">All scopes</option>
            <option value="user">User</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <p role="alert" className="p-3 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}

        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {visible.map((summary) => {
            const status = worstSeverity(summary)
            const active = selectedId === summary.id
            return (
              <li key={summary.id}>
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setSelectedId(summary.id)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                    active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">{summary.name}</span>
                    {status === 'error' ? (
                      <OctagonAlert
                        aria-label="Has errors"
                        className="size-3.5 shrink-0 text-destructive"
                      />
                    ) : null}
                    {status === 'warning' ? (
                      <AlertTriangle
                        aria-label="Has warnings"
                        className="size-3.5 shrink-0 text-amber-500"
                      />
                    ) : null}
                  </span>
                  {summary.description ? (
                    <span className="line-clamp-2 text-[12px] text-muted-foreground">
                      {summary.description}
                    </span>
                  ) : null}
                  <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                      {summary.scope === 'user'
                        ? 'User'
                        : (projectName(summary.projectId) ?? 'Project')}
                    </Badge>
                    {new Date(summary.modifiedAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            )
          })}
          {summaries !== null && visible.length === 0 ? (
            <li className="px-3 py-8 text-center text-[13px] text-muted-foreground">
              {summaries.length === 0
                ? 'Nothing discovered in this category yet.'
                : 'No resources match the current filters.'}
            </li>
          ) : null}
        </ul>
      </div>

      <div className="min-w-0 flex-1">
        {selected ? (
          <ResourceInspector
            resourceId={selected.id}
            kindLabel={kindLabel}
            projectName={projectName(selected.projectId)}
          />
        ) : (
          <EmptyState
            title="Nothing selected"
            description="Pick a resource from the list to inspect its fields, diagnostics, and source."
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Route provider categories in `src/renderer/src/App.tsx`**

Add the import: `import { ResourceListScreen } from './screens/ResourceListScreen'`. Replace the `if (selected.startsWith('provider/'))` block in `Screen` with:

```tsx
  if (selected.startsWith('provider/')) {
    const [, providerId, categoryId] = selected.split('/')
    const provider = capabilities.find((c) => c.providerId === providerId)
    const category = provider?.categories.find((c) => c.id === categoryId)
    if (provider && category) {
      return (
        <ResourceListScreen
          key={selected}
          providerId={provider.providerId}
          kind={category.id}
          title={`${provider.displayName} ${category.label}`}
          kindLabel={category.label}
        />
      )
    }
    return (
      <EmptyState title="Unknown category" description="Pick a section from the sidebar." />
    )
  }
```

(`key={selected}` resets search/selection state when switching categories. The `EmptyState` import is already present.)

- [ ] **Step 4: Verify typecheck and tests**

Run: `bun run typecheck`
Expected: exit 0.

Run: `bun run test`
Expected: PASS (unchanged — no renderer test infra; UI verified in Task 12).

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat: resource list screen with search, filters, and inspector

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Final verification — full suite plus real-app screenshots

**Files:**
- Modify: `src/main/index.ts` (extend the AC_CAPTURE debug block)

**Interfaces:**
- Consumes: everything. This task is authorized to run `bun run build` and `bun run start` (the standing "no build" constraint is lifted here only, mirroring Milestone 1's launch verification).

- [ ] **Step 1: Extend the AC_CAPTURE sequence in `src/main/index.ts`**

In the capture block, after `await shoot('settings')` and before `app.quit()`, add:

```ts
        await clickNav('Agents')
        await shoot('agents')
        await win.webContents.executeJavaScript(
          "document.querySelector('main ul button')?.click()"
        )
        await shoot('agents-selected')
```

(`clickNav('Agents')` hits the first "Agents" item — Codex — which on this machine has a real agent in `~/.codex/agents/`.)

- [ ] **Step 2: Run the full verification suite**

Run: `bun run typecheck`
Expected: exit 0.

Run: `bun run test`
Expected: PASS — every suite from Tasks 1–10 plus the Milestone 1 suites.

- [ ] **Step 3: Build and capture (authorized)**

Run: `bun run build`
Expected: main, preload, and renderer bundles build without errors.

Run: `AC_CAPTURE=/tmp/agent-control-m2.png bun run start`
Expected: the app launches, walks the capture script, writes `/tmp/agent-control-m2.overview-dark.png`, `…overview-light.png`, `…projects.png`, `…settings.png`, `…agents.png`, `…agents-selected.png`, and exits.

- [ ] **Step 4: Inspect the screenshots**

Read `/tmp/agent-control-m2.agents.png` and `/tmp/agent-control-m2.agents-selected.png`. Verify: the Codex Agents list shows at least one real agent row; the selected view shows the inspector with name, badges, fields, and source. If MCP-server fields are visible anywhere, confirm token-like values render as `••••`.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: capture discovery screens in AC_CAPTURE debug flow

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Plan Self-Review Notes

- **Spec coverage:** design §1 locations → Tasks 3–7; §2 scanners/ResourceService → Tasks 1–8; §3 IPC → Task 9; §4 UI (list, search, scope filter, inspector, empty states, credential masking) → Tasks 10–11; §5 diagnostics/containment → tested per scanner in Tasks 3–6; §6 fixtures/tests → embedded throughout. Capabilities honesty → Task 7.
- **Deliberate scope cuts (match the spec's out-of-scope list):** no plugins/hooks, no SQLite index, no watching, no editing, no Monaco, no reveal-in-file-manager.
- **Type consistency spot-checks:** `ScopeTemplate` defined once (Task 2), consumed by every discover function; `NativeResource.entryKey` added in Task 2, used by Tasks 3 (commands), 5, 6; `ResourceQuery`/`ResourceSummary` defined in Task 8 (service) and Task 9 (Zod) as structurally identical shapes.


