# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.13] - 2026-07-19

### Fixed

- **Terminal restart race** - Kept a replacement PTY active when the previous process exits after a restart. ([#27](https://github.com/kriss-spy/obsidian-opencode/issues/27))
- **File mentions leaking to external OpenCode sessions** - Limited editor lock-file discovery to the embedded OpenCode terminal so file mentions are not routed to unrelated CLI sessions. ([#28](https://github.com/kriss-spy/obsidian-opencode/issues/28))
- **macOS IME composition interrupted in the terminal** - Allowed composition events to reach xterm.js instead of treating them as regular key input. ([#26](https://github.com/kriss-spy/obsidian-opencode/issues/26))

## [1.3.12] - 2026-07-04

### Fixed

- **Session list empty on Flatpak Obsidian** — `listSessions` captured `opencode session list --format json` directly off stdout, which flatpak-spawn can drop/truncate, yielding an empty string and a `JSON.parse("")` crash (sessions silently appeared empty, refresh showed an error). Now routes Flatpak output through a host-side temp file (matching the export path), falls back to stderr when stdout is empty but stderr carries JSON, and treats truly-empty output as "no sessions" instead of crashing, surfacing any stderr for diagnosis. ([#25](https://github.com/kriss-spy/obsidian-opencode/issues/25))

## [1.3.11] - 2026-06-30

### Fixed

- **Flatpak Obsidian app ID typo** — Corrected the Flatpak override command shown in the permission error notice from `md.Obsidian.Obsidian` to `md.obsidian.Obsidian`. ([#25](https://github.com/kriss-spy/obsidian-opencode/issues/25))

## [1.3.10] - 2026-06-26

### Added

- **PATH fallback for desktop-launched Electron** — Added PATH augmentation with common user-local binary directories (`~/.opencode/bin`, `~/.local/bin`, `~/bin`) so the Python PTY proxy can find the `opencode` CLI even when Obsidian is launched from the desktop/GNOME (where shell init files like `.bashrc`/`.zshrc` aren't read). Also resolves the executable absolute path when found. ([#24](https://github.com/kriss-spy/obsidian-opencode/issues/24))

### Fixed

- **Terminal not opening on Linux** — Fixed `FileNotFoundError` from `os.execvp` in the PTY proxy by ensuring the Python child process inherits an augmented `PATH` that includes common user-local binary directories. ([#24](https://github.com/kriss-spy/obsidian-opencode/issues/24))
- **Shell injection in session export** — Validated `sessionId` format before shell interpolation in `exportSessionStreamed` to prevent shell injection via crafted session IDs.
- **Unhandled promise rejections** — Added `void` prefix to all async command callbacks in `main.ts` (6 instances).
- **Race condition in temp file cleanup** — Replaced direct `fs.unlinkSync` with guarded `safeUnlinkSync` in `exportSessionStreamed` to prevent crashes when `error` and `close` events fire in quick succession.
- **Unhandled `ExportTooLargeError`** — Wrapped `exportSessionToNote` in a try-catch to prevent unhandled rejections when a session exceeds the export size limit.
- **Stale editor server version** — Synced the `serverInfo.version` reported during WebSocket handshake from `"1.1.1"` to `"1.3.10"`.

### Removed

- **Dead code: `spawnTerminal`** from `opencode.ts` — Unused; PTY spawning is handled by `ptySession.ts`.
- **Dead code: `consumeArgs`** from `sessionState.ts` — Replaced by direct field access in `opencodeTerminalView.ts`.
- **Dead external: `node-pty`** from `esbuild.config.mjs` — Never imported; vestigial from an earlier approach.

### Technical

- 33 tests passing.
- Production build verified in Electron Node.js context.

## [1.3.0] - 2026-06-05

### Added

- **SessionState** module — Extracted session lifecycle state (args, cwd, pending prompt) from `OpencodePlugin` into `src/modules/sessionState.ts`. ([#5](https://github.com/kriss-spy/obsidian-opencode/issues/5))
- **ViewCoordinator** module — Extracted view activation/sidebar toggle logic from `OpencodePlugin` into `src/modules/viewCoordinator.ts`. ([#6](https://github.com/kriss-spy/obsidian-opencode/issues/6))
- **PtySession** module — Extracted PTY spawn/resize/kill logic from `OpencodeTerminalView` into `src/modules/ptySession.ts`. ([#7](https://github.com/kriss-spy/obsidian-opencode/issues/7))
- **SessionExporter** module — Extracted session-to-note Markdown export logic from `OpencodeConversationView` into `src/modules/sessionExporter.ts`. ([#8](https://github.com/kriss-spy/obsidian-opencode/issues/8))
- **TerminalKeyRouter** module — Extracted keyboard interception & drag-and-drop routing from `OpencodeTerminalView` into `src/modules/terminalKeyRouter.ts`. ([#9](https://github.com/kriss-spy/obsidian-opencode/issues/9))
- Unit tests for all extracted modules (`sessionState.test.ts`, `viewCoordinator.test.ts`, `sessionExporter.test.ts`).
- Streaming export for large sessions via temp file with `ExportTooLargeError` graceful degradation. ([#10](https://github.com/kriss-spy/obsidian-opencode/issues/10))

### Changed

- `OpencodePlugin` now delegates to `SessionState` and `ViewCoordinator` for session and view management.
- `OpencodeTerminalView` now delegates to `PtySession` and `TerminalKeyRouter` for PTY and input handling.
- `OpencodeConversationView` now delegates to `SessionExporter` for note export.
- `exportSession` switched from `execFile` with 100MB buffer to `spawn` with shell redirection to a temp file, avoiding Bun stdout buffering race conditions.

### Fixed

- **Session preview loading for large sessions** — Fixed race condition in `opencode` Bun binary where large JSON exports were randomly truncated. Now exports to a temp file via shell redirection for reliable writes. ([#10](https://github.com/kriss-spy/obsidian-opencode/issues/10))
- Removed spurious "Export stderr" console spam by redirecting `opencode export` stderr to `/dev/null`.

### Technical

- 33 tests passing (up from 16).
- All 6 milestone issues resolved.
- Production build verified in Electron Node.js context.

## [1.2.1] - 2026-06-03

### Fixed

- Corrected plugin id from `opencode-beta` to `opencode` for community plugin registry compatibility.

## [1.2.0] - 2026-06-03

### Added

- **WebSocket Editor Server** — Auto-discovers vault as an OpenCode editor via lock file; JSON-RPC handshake with initialize / notifications/initialized; sends `at_mentioned` messages on file drop; lazy start/stop tied to terminal view lifecycle. ([#4](https://github.com/kriss-spy/obsidian-opencode/issues/4))
- **Drag and Drop Improvements** — Single internal note drops via dragManager; external OS file drops via `dataTransfer.files` fallback; multi-file drops with staggered delivery; vault-relative path normalization; pure WebSocket protocol (no PTY keystroke injection). ([#1](https://github.com/kriss-spy/obsidian-opencode/issues/1), [#2](https://github.com/kriss-spy/obsidian-opencode/issues/2), [#3](https://github.com/kriss-spy/obsidian-opencode/issues/3))
- `ws` dependency for WebSocket server.

### Technical

- 16 tests passing.
- Production build verified in Electron Node.js context.

## [1.1.1] - 2026-05-16

### Fixed

- Fixed release assets for Obsidian plugin review.

## [1.1.0] - 2026-05-16

### Added

- Auto-focus terminal on open (not on every click).
- Block all Obsidian shortcuts when terminal is focused, forwarding keys directly to PTY.
- Re-focus terminal after Escape (opencode blur workaround).

### Changed

- Toggle sidebar now uses `rightSplit.toggle()` to preserve PTY session.

### Removed

- Removed `terminalTheme` setting (dead code).
- Removed `autoRestoreSessions` setting (never implemented).
- Removed empty `modals/` directory.

### Fixed

- Fixed xterm WebGL addon dispose error.

## [1.0.1] - 2026-05-16

### Fixed

- Replaced deprecated `builtin-modules` with Node.js `module.builtinModules`.
- Removed `!important` declarations from CSS.
- Merged duplicate CSS selectors.

## [1.0.0] - 2026-05-16

### Added

- Initial release of the OpenCode plugin for Obsidian.
- Embedded terminal using xterm.js with WebGL renderer.
- Python PTY proxy for native PTY support inside Electron.
- Session manager with history browser, conversation preview, one-click restore, and Markdown export.
- Settings for `opencode` binary path, default CLI arguments, and terminal styling.

[Unreleased]: https://github.com/kriss-spy/obsidian-opencode/compare/1.3.13...HEAD
[1.3.13]: https://github.com/kriss-spy/obsidian-opencode/compare/1.3.12...1.3.13
[1.2.1]: https://github.com/kriss-spy/obsidian-opencode/compare/1.2.0...1.2.1
[1.2.0]: https://github.com/kriss-spy/obsidian-opencode/compare/1.1.1...1.2.0
[1.1.1]: https://github.com/kriss-spy/obsidian-opencode/compare/1.1.0...1.1.1
[1.1.0]: https://github.com/kriss-spy/obsidian-opencode/compare/1.0.1...1.1.0
[1.0.1]: https://github.com/kriss-spy/obsidian-opencode/compare/1.0.0...1.0.1
[1.0.0]: https://github.com/kriss-spy/obsidian-opencode/releases/tag/1.0.0
