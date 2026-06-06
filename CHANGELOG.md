# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - Unreleased

### Added

- **Panel mode setting** — New `panelMode: "sidebar" | "bottom"` setting. Choose between the existing right-sidebar terminal and a VS Code-style bottom panel. ([#15](https://github.com/kriss-spy/obsidian-opencode/issues/15))
- **Bottom panel docking** — When `panelMode === "bottom"`, the terminal leaf docks into a bottom container via `workspace.getContainerOfLeaf()` (with a horizontal-split fallback). ([#19](https://github.com/kriss-spy/obsidian-opencode/issues/19))
- **Clean panel chrome** — Bottom-panel terminal leaves hide their tab header; a right-click context menu adds "Close terminal" / "Restart terminal" to compensate. ([#16](https://github.com/kriss-spy/obsidian-opencode/issues/16))
- **Open-in-mode commands** — `Open terminal in sidebar` and `Open terminal in bottom panel` destroy the other mode's leaf (if any) and re-spawn the active session via `SessionState.lastSession`. ([#17](https://github.com/kriss-spy/obsidian-opencode/issues/17))
- **Toggle terminal command** — Single `Toggle terminal` command cycles shown-focused → shown-unfocused → hidden for the active mode. ([#18](https://github.com/kriss-spy/obsidian-opencode/issues/18))

### Changed

- Removed both ribbon icons (terminal + conversations); the plugin is now command-palette-only. ([#15](https://github.com/kriss-spy/obsidian-opencode/issues/15))
- `SessionState` gains a `lastSession: { args, cwd } | null` snapshot that survives `consumeArgs()` so mode-switch commands can re-spawn the original session. ([#15](https://github.com/kriss-spy/obsidian-opencode/issues/15))
- `OpencodePlugin` now registers two terminal view types: `OPENCODE_TERMINAL_VIEW_TYPE` (sidebar) and `OPENCODE_TERMINAL_BOTTOM_VIEW_TYPE` (bottom). Only one ever has a live leaf at a time.

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

[Unreleased]: https://github.com/kriss-spy/obsidian-opencode/compare/1.3.4...HEAD
[1.3.0]: https://github.com/kriss-spy/obsidian-opencode/compare/1.2.1...1.3.0
[1.2.1]: https://github.com/kriss-spy/obsidian-opencode/compare/1.2.0...1.2.1
[1.2.0]: https://github.com/kriss-spy/obsidian-opencode/compare/1.1.1...1.2.0
[1.1.1]: https://github.com/kriss-spy/obsidian-opencode/compare/1.1.0...1.1.1
[1.1.0]: https://github.com/kriss-spy/obsidian-opencode/compare/1.0.1...1.1.0
[1.0.1]: https://github.com/kriss-spy/obsidian-opencode/compare/1.0.0...1.0.1
[1.0.0]: https://github.com/kriss-spy/obsidian-opencode/releases/tag/1.0.0
