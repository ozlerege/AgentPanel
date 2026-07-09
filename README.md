# Agent Control

Agent Control is a local desktop configuration manager for Codex and Claude Code.

## Development

Run the unit and type checks before sharing a change:

```sh
bun run test
bun run typecheck
```

The end-to-end gate runs against an Electron build:

```sh
bun run test:e2e
```

## Release

macOS packaging, signing, notarization, artifact verification, and GitHub publishing are documented in [the release guide](docs/RELEASING.md).
