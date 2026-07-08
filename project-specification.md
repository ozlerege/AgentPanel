# Agent Control

## Project specification

**Status:** Draft v0.1  
**Product type:** Cross-platform desktop application  
**Primary stack:** Electron, React, TypeScript , Shadcn

## 1. Product summary

Agent Control is a local desktop configuration manager for Codex and Claude Code. It gives users one graphical interface to discover, inspect, create, edit, enable, disable, import, export, and delete provider resources such as agents, skills, plugins, commands, hooks, MCP servers, and instruction files.

The application does not replace Codex or Claude Code and does not initially execute agent tasks. It manages the files and settings those products use.

### Product statement

> A simple desktop control panel for managing Codex and Claude Code customization without manually navigating configuration folders or editing structured files.

## 2. Problem

Power users accumulate resources across user-level and project-level directories. These resources can be difficult to locate, compare, validate, update, and remove safely. The two providers also use different names, formats, locations, and scope rules.

Users currently need to:

- Remember where each provider stores resources.
- Navigate hidden folders and project directories.
- Edit Markdown, JSON, TOML, or YAML manually.
- Understand which configuration is global and which is project-specific.
- Detect duplicate, broken, or outdated resources themselves.
- Manually back up files before risky changes.

## 3. Goals

The first release must:

- Present Codex and Claude Code resources in one consistent interface.
- Preserve provider-specific behavior and file formats.
- Support safe create, read, update, disable, and delete operations.
- Clearly identify provider, resource type, source path, and scope.
- Validate changes before writing them.
- Back up every modified or deleted resource.
- Detect changes made outside the application.
- Work without requiring cloud accounts or a hosted backend.

## 4. Non-goals for the MVP

- Running or orchestrating agent tasks.
- Replacing the Codex or Claude Code interface.
- Translating every resource automatically between providers.
- Hosting a public plugin or skill marketplace.
- Synchronizing configurations between computers.
- Editing API keys directly in ordinary text fields.
- Team administration, policy enforcement, or remote device management.

These may be considered after the local configuration manager is reliable.

## 5. Target users

### Primary user

An individual who regularly uses both Codex and Claude Code and has enough agents, skills, plugins, or MCP servers that manual file management has become inconvenient.

### Secondary users

- Skill and plugin authors testing multiple local resources.
- Teams preparing a standard repository configuration.
- Users learning how provider customization is structured.

## 6. Product principles

1. **Local first:** Configuration stays on the user's computer.
2. **Safe by default:** Preview, validate, back up, and support undo.
3. **Native fidelity:** Never discard fields the application does not understand.
4. **Simple first, source available:** Use forms by default and provide source editing as an advanced option.
5. **Explicit scope:** Always show whether a resource is global, project-level, or inherited.
6. **Provider honesty:** Similar concepts may share UI patterns, but provider-specific differences must remain visible.

## 7. Supported resource model

The exact available resources are determined by each installed provider version. The initial adapter model should support these categories where they exist.

| Resource                |             Codex | Claude Code | MVP operation        |
| ----------------------- | ----------------: | ----------: | -------------------- |
| Agents/subagents        |               Yes |         Yes | Manage               |
| Skills                  |               Yes |         Yes | Manage               |
| Plugins                 |               Yes |         Yes | Manage               |
| Commands                | Provider-specific |         Yes | Manage               |
| Hooks                   |               Yes |         Yes | Manage               |
| MCP servers             |               Yes |         Yes | Manage               |
| Persistent instructions |               Yes |         Yes | Inspect and edit     |
| Provider configuration  |               Yes |         Yes | Limited safe editing |

“Manage” means list, inspect, create, edit, duplicate, enable or disable when supported, export, and delete.

## 8. Core user experience

### 8.1 Application shell

The application uses a settings-style, three-column layout:

- **Navigation:** Providers, projects, resource categories, and application settings.
- **Resource list:** Searchable and filterable resources for the selected category.
- **Inspector:** Summary, structured editor, files, validation results, and advanced source view.

### 8.2 Navigation

```text
Overview
Codex
  Agents
  Skills
  Plugins
  Hooks
  MCP Servers
  Instructions
Claude Code
  Agents
  Skills
  Plugins
  Commands
  Hooks
  MCP Servers
  Instructions
Projects
Backups
Settings
```

Categories should be generated from adapter capabilities rather than hard-coded assumptions.

### 8.3 Resource list

Every row should show:

- Name and description.
- Provider icon.
- Resource type.
- Global or project scope.
- Enabled, disabled, invalid, or unavailable status.
- Last modified time.
- Warning indicator when validation fails.

Available actions:

- Add.
- Edit.
- Duplicate.
- Enable or disable.
- Export.
- Reveal in file manager.
- Delete.

### 8.4 Resource editor

The default editor uses fields appropriate to the resource type. Common fields include:

- Name.
- Description.
- Provider.
- Scope.
- Project.
- Instructions or content.
- Supporting files.
- Dependencies.
- Enabled state.

An advanced source view exposes the native content. Switching between form and source views must not lose unknown fields or comments.

### 8.5 Change review

Before saving, the user sees:

- Files that will be created, changed, moved, or deleted.
- A textual diff.
- Validation warnings and errors.
- The backup that will be created.

Errors block saving. Warnings require explicit confirmation.

## 9. Primary workflows

### Discover resources

1. Launch the application.
2. Detect installed providers and known configuration roots.
3. Ask the user to add projects or discover recent repositories.
4. Scan supported locations through provider adapters.
5. Display resources grouped by provider, type, and scope.

### Add a resource

1. Select provider and category.
2. Choose global or project scope.
3. Complete the structured form or import a folder/file.
4. Validate the proposed resource.
5. Review the filesystem changes.
6. Save and create a backup/history record.

### Edit a resource

1. Select the resource.
2. Edit through the form or source view.
3. Detect whether the source changed externally during editing.
4. Validate and preview the diff.
5. Save atomically and record history.

### Disable a resource

Disabling must use a provider-supported mechanism when one exists. Otherwise, the application may move the resource into an application-managed disabled location, but only if the behavior is transparent, reversible, and tested for that resource type.

### Delete a resource

1. Show the exact files and dependencies affected.
2. Require confirmation.
3. Create a restorable backup.
4. Remove the resource.
5. Offer immediate undo.

## 10. Technical architecture

```text
Electron renderer
React UI + application state
          |
          | typed, allow-listed IPC
          v
Electron preload
Minimal contextBridge API
          |
          v
Electron main process
Resource service, adapters, validation, backups, file watcher
          |
          +-- Codex adapter ------ Native Codex files
          |
          +-- Claude adapter ----- Native Claude Code files
          |
          +-- SQLite ------------ Index and local history metadata
```

### 10.1 Renderer process

Responsibilities:

- Navigation and presentation.
- Forms and source editor.
- Search and filtering.
- Diff and validation presentation.
- Calling only predefined preload operations.

The renderer must not have direct Node.js or filesystem access.

### 10.2 Preload layer

Expose a narrow, typed API through `contextBridge`. Example operations:

```ts
interface DesktopApi {
  providers: {
    detect(): Promise<ProviderStatus[]>;
  };
  resources: {
    list(query: ResourceQuery): Promise<ResourceSummary[]>;
    read(id: ResourceId): Promise<ResourceDocument>;
    validate(draft: ResourceDraft): Promise<ValidationResult>;
    preview(change: ResourceChange): Promise<ChangePreview>;
    apply(change: ResourceChange): Promise<ApplyResult>;
    restore(backupId: string): Promise<ApplyResult>;
  };
  projects: {
    add(): Promise<Project | null>;
    list(): Promise<Project[]>;
    remove(id: string): Promise<void>;
  };
}
```

Do not expose generic filesystem methods such as `readFile(path)` or `writeFile(path, content)` to the renderer.

### 10.3 Main process services

- **Provider registry:** Loads adapters and reports capabilities.
- **Discovery service:** Finds provider installations and configuration roots.
- **Resource service:** Normalized CRUD operations.
- **Validation service:** Provider schemas and filesystem constraints.
- **Change planner:** Produces a preview before mutations.
- **Filesystem transaction service:** Performs atomic writes and guarded moves.
- **Backup service:** Snapshots files before changes.
- **Watcher service:** Detects external changes and invalidates cached data.
- **Index service:** Maintains searchable metadata in SQLite.
- **Audit service:** Records local application operations without secrets.

### 10.4 Provider adapter contract

```ts
interface ProviderAdapter {
  id: "codex" | "claude";
  detect(): Promise<ProviderStatus>;
  capabilities(): ProviderCapabilities;
  discover(context: DiscoveryContext): Promise<NativeResource[]>;
  parse(source: NativeResource): Promise<ResourceDocument>;
  validate(draft: ResourceDraft): Promise<ValidationResult>;
  plan(change: ResourceChange): Promise<FileOperationPlan>;
}
```

Adapters understand provider-specific locations, formats, scope rules, validation, and enable/disable behavior. They must preserve raw source information needed for lossless round trips.

## 11. Internal data model

```ts
type ProviderId = "codex" | "claude";
type ResourceScope = "user" | "project" | "directory";

interface ResourceDocument {
  id: string;
  provider: ProviderId;
  kind: string;
  name: string;
  description?: string;
  scope: ResourceScope;
  projectId?: string;
  enabled: boolean | "unsupported";
  sourcePaths: string[];
  fields: Record<string, unknown>;
  native: {
    format: "markdown" | "json" | "toml" | "yaml" | "directory" | "unknown";
    raw?: string;
    unknownFields?: Record<string, unknown>;
  };
  diagnostics: Diagnostic[];
  modifiedAt: string;
}
```

This normalized model is for the UI and indexing. Native provider data remains authoritative.

## 12. Storage

SQLite stores only application-owned metadata:

- Registered projects.
- Resource search index.
- Resource fingerprints.
- Backup metadata.
- Change history.
- UI preferences.

Provider configuration remains in native files. The database must not become a second source of truth.

Backups should live under the application's user-data directory and contain:

- Original file content.
- Original path.
- File metadata needed for restoration.
- Change timestamp.
- Hash before and after the operation.

Secrets must be redacted from history where possible. Credentials should remain in provider-supported stores or the operating system keychain.

## 13. Filesystem safety

All mutations must:

1. Resolve and normalize paths.
2. Confirm the path belongs to an approved provider or project root.
3. Reject unexpected traversal and unsafe symlink targets.
4. Verify that the source has not changed since it was read.
5. Create a backup.
6. Write to a temporary sibling file.
7. Flush and atomically rename where supported.
8. Verify the resulting content.
9. Update the local index and history.

Directory deletion should first move content to a restorable application backup or operating-system trash where practical.

## 14. Security requirements

Electron configuration:

- `contextIsolation: true`.
- `nodeIntegration: false`.
- Sandbox renderer processes where compatible.
- Use a strict Content Security Policy.
- Disable navigation to untrusted origins.
- Deny unexpected window creation.
- Validate sender, channel, and payload for every IPC request.
- Validate all data again in the main process.

Application requirements:

- Maintain an allow-list of writable roots.
- Never execute resource content during discovery or validation.
- Never interpolate untrusted content into shell commands.
- Do not follow arbitrary links during import.
- Treat imported plugins and skills as untrusted files.
- Redact probable credentials from logs and previews.
- Require explicit confirmation before writing outside known roots.

## 15. Suggested technology stack

- Electron.
- React and TypeScript.
- Vite-based Electron build tooling.
- Zod for IPC and internal runtime validation.
- SQLite for local metadata and history.
- Monaco Editor for advanced source editing.
- A syntax-aware diff component.
- A robust file-watching library with debouncing.
- Electron Builder or Electron Forge for packaging.
- Vitest for unit tests.
- Playwright for application-level tests.

Exact dependencies should be selected when implementation begins and kept minimal.

## 16. Error handling

Errors must be actionable and identify:

- What operation failed.
- Which resource and file were involved.
- Whether anything was changed.
- Whether a backup exists.
- The recommended recovery action.

The application should distinguish:

- Invalid resource content.
- Unsupported provider version.
- Permission failure.
- External modification conflict.
- Missing source file.
- Partial filesystem operation.
- Corrupted or unavailable backup.

## 17. Accessibility and usability

- Full keyboard navigation.
- Visible focus states.
- Screen-reader labels for controls and statuses.
- Do not rely on color alone for provider or validation state.
- Support light, dark, and system themes.
- Confirm destructive operations by resource name and scope.
- Use plain language; expose provider terminology where accuracy requires it.

## 18. MVP milestones

### Milestone 1: Foundation

- Electron security baseline.
- React application shell.
- Typed IPC.
- Project registration.
- Provider adapter interface.
- Native-fidelity spike (below).

#### Native-fidelity spike

The riskiest technical bets are comment-preserving TOML editing, partial edits to shared files, and lossless form/source round trips. Prove them before any editing work begins:

1. **TOML round trip:** Parse a real `config.toml` (with comments), change one value, serialize, and verify the only diff is the intended change.
2. **Partial shared-file edits:** Modify a single MCP server entry inside `config.toml` and a single hook inside `settings.json` without disturbing unrelated sections.
3. **Form round trip:** Convert a resource with unknown fields and comments to the structured form and back with nothing lost.

Exit criterion: automated diff tests showing byte-identical output outside the edited region, against representative fixtures from both providers. If available libraries cannot achieve this, renegotiate principle 3 (“Native fidelity”) now — not during Milestone 3.

### Milestone 2: Read-only discovery

- Detect installed providers.
- Implement Codex and Claude adapters for selected MVP resource types.
- List and inspect global and project resources.
- Search, filter, and display validation diagnostics.

### Milestone 3: Safe editing

- Structured and source editors.
- Validation and change preview.
- Atomic writes.
- External-change conflict handling.
- Backups and restore.

### Milestone 4: Complete management

- Create, duplicate, import, export, enable/disable, and delete.
- File watching and automatic refresh.
- History screen and undo.
- Packaging for the first supported operating system.

### Milestone 5: Release quality

- End-to-end test matrix.
- Recovery testing for interrupted writes.
- Accessibility pass.
- Signed builds, update strategy, and release documentation.

## 19. MVP acceptance criteria

The MVP is complete when a user can:

- Open the application and see whether Codex and Claude Code were detected.
- Register a project and see supported resources from both providers.
- Search and filter by provider, type, scope, and status.
- Inspect a resource's native path and content.
- Create and edit a supported resource without manually opening its file.
- Preview and validate every change before saving.
- Disable or delete a supported resource with clear consequences.
- Restore the previous version after any application-managed mutation.
- Receive a conflict warning instead of overwriting an external edit.
- Use the application without exposing arbitrary filesystem access to the renderer.

## 20. Testing strategy

### Unit tests

- Provider parsing and serialization.
- Validation rules.
- Path normalization and allowed-root checks.
- Change planning.
- Unknown-field preservation.

### Integration tests

- CRUD operations in temporary provider directories.
- Backup and restoration.
- External modification conflicts.
- Symbolic links and malformed resources.
- File watcher behavior.

### End-to-end tests

- Provider detection.
- Add, edit, disable, delete, and restore flows.
- Form/source round trips.
- Keyboard navigation.
- Application restart and index recovery.

Maintain fixture sets for multiple provider versions. Never run destructive tests against the user's real configuration directories.

## 21. Decisions still required

Before implementation begins, decide:

1. The first supported operating system: macOS-only initially or macOS, Windows, and Linux together.
2. The exact Codex and Claude Code resource types included in the first adapter release.
3. Whether “disable” may move files when the provider has no native disabled state.
4. Whether projects are added manually or discovered automatically.
5. Whether the first release includes a raw provider configuration editor.
6. The product name and application identifier.
7. The backup retention policy.

## 22. Recommended initial decisions

For the smallest reliable release:

- Start with macOS, while keeping paths and services platform-neutral.
- Support agents, skills, plugins, MCP servers, and instruction files first.
- Require users to add project folders manually.
- Keep broad provider configuration read-only initially.
- Retain the latest 50 application-created backups per resource, with a storage cap.
- Call the project **Agent Control** until branding is finalized.
