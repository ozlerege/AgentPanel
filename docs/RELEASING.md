# Releasing Desmos Agent

## Prerequisites

Release builds require an Apple Developer account with a **Developer ID Application** certificate installed or supplied to electron-builder. Create an app-specific password for the Apple ID used for notarization and know that account's Apple team ID.

Set these environment variables before producing a signed, notarized release:

```sh
export CSC_LINK=/absolute/path/to/developer-id-application.p12
export CSC_KEY_PASSWORD='certificate-password'
export APPLE_ID='developer@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='YOURTEAMID'
```

`CSC_LINK` may also use an electron-builder-supported certificate URL or base64 value. GitHub publishing additionally requires a token that can create releases and upload assets:

```sh
export GH_TOKEN='github-token-with-repository-release-access'
```

For a local unsigned package, explicitly opt out of certificate discovery instead of changing the builder configuration:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false bun run package:mac
```

## Prepare the release

1. Update the version in `package.json` and keep the release notes/changelog entry aligned with the shipped changes.
2. Run the release gates:

   ```sh
   bun run test
   bun run test:e2e
   ```

3. With the signing and notarization variables set, build the macOS artifacts:

   ```sh
   bun run package:mac
   ```

   electron-builder signs when a valid identity is available and notarizes when the Apple credential variables are available.

## Verify artifacts

After building, verify the `.app` inside the generated distribution (or mount the generated DMG and verify the installed app):

```sh
codesign --verify --deep --strict --verbose=2 '/path/to/Desmos Agent.app'
spctl --assess --type execute --verbose=4 '/path/to/Desmos Agent.app'
```

## Publish

After the checks and artifact verification pass, create or update the GitHub release and upload the macOS artifacts:

```sh
bunx electron-builder --mac --publish always
```

Keep the signing, notarization, and `GH_TOKEN` environment variables available for this command.

## Post-release smoke check

- Install the released DMG on a clean macOS user account.
- Open Desmos Agent and confirm it boots normally.
- Confirm the app reports its release version.
- Inspect the main-process log for the delayed auto-update check line; an updater failure must only be logged and must not block the app with a dialog.
