# Testing in Obsidian

Unit tests cannot establish that an Obsidian plugin loads, registers commands, creates workspace leaves, or renders correctly in Electron. The end-to-end suite launches an isolated Obsidian instance and creates a fresh vault from `test/vault` for every run.

It does not open, register, modify, or read any existing vault. `wdio-obsidian-service` stores downloaded Obsidian versions and temporary profiles under `.obsidian-cache/`.

## Run

```bash
npm run test:obsidian
```

This is the requirements suite. It includes assertions for open bugs and therefore fails while those requirements are unmet. To check only the currently working harness and baseline behavior, run:

```bash
npm run test:obsidian:smoke
```

On the first run, the service downloads a compatible Obsidian installer and app bundle. Later runs reuse that cache but still receive a fresh copy of the test vault.

The suite builds and installs the plugin, configures a deterministic local fake `opencode` executable, and checks:

- The plugin activates in the isolated Obsidian process.
- Its expected commands are registered.
- Session history renders fixture data, previews messages, and exports a Markdown note.
- Restoring a session launches the terminal with the exact `-s <session>` arguments.
- New Session and Continue Last Session restart an existing PTY and remain responsive to keyboard input.
- The terminal is a singleton with usable dimensions, rows, and columns, and its sidebar collapses and reveals.
- The private editor server completes the JSON-RPC handshake, sends single and multiple `at_mentioned` messages, closes clients, and stays out of global lock-file discovery.

Screenshots of the conversations and terminal views are written to `test-results/obsidian/`.

Set `OBSIDIAN_VERSION` and `OBSIDIAN_INSTALLER_VERSION` to pin versions instead of testing the latest release:

```bash
OBSIDIAN_VERSION=1.12.7 OBSIDIAN_INSTALLER_VERSION=1.12.7 npm run test:obsidian
```

Linux CI needs Xvfb and a window manager. The `wdio-obsidian-service` sample workflow demonstrates the supported setup.

`.github/workflows/test.yml` runs the unit and isolated Obsidian suites on pushes and pull requests. CI pins both Obsidian components to 1.12.7, caches downloads, and uploads the screenshots as build artifacts.

## Obsidian CLI

The official CLI is useful for quick diagnostics against an already registered development vault:

```bash
obsidian plugin:reload id=opencode
obsidian command id=opencode:open-terminal
obsidian dev:errors
obsidian dev:screenshot path=screenshot.png
```

It cannot non-interactively create or register an arbitrary fresh vault. `vault:open` is TUI-only, so the CLI is not the isolation boundary for this suite. WebdriverIO supplies fresh profiles, vault copying, locators, input actions, waiting, screenshots, and assertions.

## Issue Coverage

| Issues | Automated evidence |
| --- | --- |
| #1, #2, #3, #4 | Real terminal-view drop events produce normalized single/multiple WebSocket mentions; handshake and cleanup are verified. |
| #24 | The Linux terminal must have non-trivial pixel dimensions and xterm rows/columns. |
| #27 | Failing requirement: New Session and Continue Last Session must replace an existing PTY and then accept keyboard input. The current stale-child exit race disconnects the replacement process. |
| #28 | The editor server is passed directly to the embedded OpenCode process and is not published for unrelated OpenCode clients to discover. |
| #26 | Failing composition requirement: pinyin keydowns emitted while `isComposing` must not reach the PTY; only the committed Chinese text may be sent. Run with `npm run test:obsidian:macos-ime`. |
| #10 | Unit tests cover large-export limits; E2E covers normal preview and export-to-note behavior. |

Not yet automatable in this Linux job:

- #22 requires a real Windows PTY implementation and Windows CI runner.
- #15-#19 describe panel-mode behavior not present on the current branch.
- #21 concerns OpenCode rollback ownership outside the plugin's current API boundary.

## macOS VM

The suite was executed in a Quickemu macOS 26.5.2 x86_64 guest against Obsidian app and installer 1.12.7:

- `npm test`: 33 passing.
- `npm run build`: passing.
- `npm run test:obsidian:smoke`: 6 passing.
- `npm run test:obsidian`: 7 passing and 3 requirement failures (#26, #27, #28).
- `npm run test:obsidian:macos-ime`: reproduces #26 as `nihao你好` reaching the PTY instead of only `你好`.

The #26 test drives Chromium's composition event sequence inside the real macOS Obsidian/Electron process. It does not automate selection of the macOS Pinyin input source or generate native keystrokes through Accessibility APIs. Its assertion is at the plugin boundary: keydowns marked `isComposing` must be suppressed, while the committed text must be delivered once.

## Sources

- [Official Obsidian CLI documentation](https://help.obsidian.md/cli)
- [Official CLI command reference source](https://github.com/obsidianmd/obsidian-help/blob/master/en/Extending%20Obsidian/Obsidian%20CLI.md)
- [Obsidian 1.12.7 release notes](https://obsidian.md/changelog/2026-03-23-desktop-v1.12.7/)
- [`wdio-obsidian-service`](https://github.com/jesse-r-s-hines/wdio-obsidian-service)
- [`wdio-obsidian-service` sample plugin](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin)
- [WebdriverIO Electron testing](https://webdriver.io/docs/desktop-testing/electron/)
