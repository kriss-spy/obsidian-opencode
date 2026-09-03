# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.5.3] - 2026-09-03

### Fixed

- **Korean IME input ordering on Windows** — Let xterm own keyboard encoding and composition so committed Hangul reaches OpenCode before a following Space. Paste, drop, and synthesized mouse input now use the same ordered xterm input stream. ([#44](https://github.com/kriss-spy/obsidian-opencode/issues/44))
- **Shortcuts while the terminal is focused** — Load OpenCode's effective keymap and give it priority on conflicts while allowing every non-conflicting Obsidian shortcut to work normally. The router respects both applications' custom keybindings and suppresses Obsidian commands during IME composition. ([#45](https://github.com/kriss-spy/obsidian-opencode/issues/45))

## [1.5.2] - 2026-08-31

### Fixed

- **Flatpak override command granted the wrong DBus name** — The permission notice instructed `--talk-name=org.freedesktop.flatpak` (lowercase), but DBus names are case-sensitive and `flatpak-spawn --host` requires access to `org.freedesktop.Flatpak`. The override therefore had no effect and every host command failed with `org.freedesktop.DBus.Error.ServiceUnknown`. ([#25](https://github.com/kriss-spy/obsidian-opencode/issues/25))
- **OpenCode TUI layout broke on resize under Flatpak** — Across the `flatpak-spawn --host` portal boundary the kernel never delivers `SIGWINCH` to the host-side process (no controlling terminal), so the TUI started at a 0x0 PTY and never learned about terminal resizes, drawing at stale geometry. The PTY proxy now applies the terminal's initial size at startup, and a host-side supervisor polls the PTY winsize and forwards `SIGWINCH` to the TUI explicitly. ([#25](https://github.com/kriss-spy/obsidian-opencode/issues/25))
- **Orphaned OpenCode processes after terminal close on Flatpak** — Killing the PTY proxy closed the PTY master, but the hangup could not cross the portal boundary, leaving host-side OpenCode processes behind on plugin reload or terminal close. The proxy now forwards termination to the session's host supervisor via a per-session kill token, which tears the TUI down cleanly. ([#25](https://github.com/kriss-spy/obsidian-opencode/issues/25))

## [1.5.1] - 2026-08-19

### Fixed

- **Windows npm launchers** — OpenCode paths installed through npm now work with Windows PowerShell (`.ps1`) and command (`.cmd`) shims for terminal and session operations, including stable and beta CLI variants.
- **Terminal probe text after Ctrl+C** — Filters XTGETTCAP and Kitty graphics capability payloads exposed as visible text when ConPTY strips their unsupported control-sequence framing.
- **Windows terminal hanging after Ctrl+C** — Completes shutdown after OpenCode restores terminal modes, reports a clean exit, and suppresses the internal Job Object diagnostic caused by terminating the PTY host.

## [1.5.0] - 2026-08-17

### Added

- **New session panel action** — Added a compact new-session button to the conversations panel so OpenCode can be started without an existing session. ([#32](https://github.com/kriss-spy/obsidian-opencode/issues/32))
- **Per-vault environment variables** — Added settings for environment variables passed to OpenCode session, export, delete, and terminal processes while preserving the inherited environment. Values are passed literally, including empty values and shell metacharacters. ([#37](https://github.com/kriss-spy/obsidian-opencode/issues/37))
- **Resizable conversation list** — Drag the divider in the conversations view to adjust the session-list width.

### Fixed

- **Caps Lock inserted as terminal input** — Modifier-only Caps Lock events no longer write `CapsLock` or derived control sequences to the terminal, while native lock-state behavior and ordinary input remain available. ([#33](https://github.com/kriss-spy/obsidian-opencode/issues/33))
- **Corrupted text after restarting a session** — New and restored sessions now reset xterm state before launching, preventing stale alternate-screen cells and character-set modes from carrying into the replacement OpenCode process.
- **Incorrect layout after restarting the terminal** — Restarting now refits xterm to the current sidebar and passes the fitted dimensions to the replacement OpenCode process.
- **Conversation panel terminology and metadata** — Session rows no longer repeat the vault path, and assistant messages are labeled as agent messages.

## [1.4.1] - 2026-08-01

### Fixed

- **Orphaned OpenCode processes on Windows** — Terminal close, plugin unload, and normal Obsidian shutdown now await the complete PTY process tree, including launcher shims and descendants.
- **Overlapping terminal restart and shutdown** — Serialized lifecycle operations so a late restart cannot create a replacement session while the terminal view is closing.

### Changed

- **Fail-safe Windows process ownership** — Windows PTY trees now run inside a Job Object configured to terminate all descendants when its owner closes.
- **Windows shutdown coverage** — Added integration coverage that launches a real `zigpty` descendant process tree and verifies bounded cleanup.

## [1.4.0] - 2026-08-01

### Added

- **Windows terminal support** — Beta support on Windows 10 version 1809 and later through ConPTY. Spawns the OpenCode CLI inside an isolated Node.js helper with embedded x64 and ARM64 `zigpty` native binaries, so the terminal works without requiring a separately installed native build environment. Node.js must be available on `PATH`. ([#22](https://github.com/kriss-spy/obsidian-opencode/issues/22))
- **Windows terminal rendering** — Uses the WebGL xterm.js addon with a DOM fallback, fixes box-drawing segmentation, and keeps normal text selection available when the terminal is not showing a picker.
- **Mouse click forwarding on Windows** — Forwards mouse clicks into the OpenCode TUI for model/session pickers and prompt cursor positioning.
- **Windows UI regression suite** — Added `npm run test:obsidian:windows-ui` for running real OpenCode CLI interactions inside Obsidian on Windows.
- **Windows CI job** — GitHub Actions now runs the unit and isolated Obsidian tests on `windows-latest`.

### Changed

- **Beta platform labeling** — Windows support is now labeled as beta in the README.

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

[Unreleased]: https://github.com/kriss-spy/obsidian-opencode/compare/1.5.2...HEAD
[1.5.2]: https://github.com/kriss-spy/obsidian-opencode/compare/1.5.1...1.5.2
[1.5.0]: https://github.com/kriss-spy/obsidian-opencode/compare/1.4.1...1.5.0
[1.4.1]: https://github.com/kriss-spy/obsidian-opencode/compare/1.4.0...1.4.1
[1.4.0]: https://github.com/kriss-spy/obsidian-opencode/compare/1.3.13...1.4.0
[1.3.13]: https://github.com/kriss-spy/obsidian-opencode/compare/1.3.12...1.3.13
[1.2.1]: https://github.com/kriss-spy/obsidian-opencode/compare/1.2.0...1.2.1
[1.2.0]: https://github.com/kriss-spy/obsidian-opencode/compare/1.1.1...1.2.0
[1.1.1]: https://github.com/kriss-spy/obsidian-opencode/compare/1.1.0...1.1.1
[1.1.0]: https://github.com/kriss-spy/obsidian-opencode/compare/1.0.1...1.1.0
[1.0.1]: https://github.com/kriss-spy/obsidian-opencode/compare/1.0.0...1.0.1
[1.0.0]: https://github.com/kriss-spy/obsidian-opencode/releases/tag/1.0.0
