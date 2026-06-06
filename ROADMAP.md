# Roadmap

## Overview

| Version | Theme | Status |
|---------|-------|--------|
| v1.3.0 | Internal Refactoring | Done |
| v1.4.0 | Panel Mode | Planned |
| v1.5.0 | Terminal Integration | Planned |
| v1.6.0 | Session Management | Planned |

---

## v1.3.0 — Internal Refactoring

> **Goal:** Decouple the monolithic `OpencodePlugin` and `OpencodeTerminalView` into testable, focused modules. No user-facing changes.

| # | Issue | Description |
|---|-------|-------------|
| 5 | [#5](https://github.com/kriss-spy/obsidian-opencode/issues/5) | **Extract `SessionState`** — Encapsulate transient terminal spawn args into a dedicated module. |
| 6 | [#6](https://github.com/kriss-spy/obsidian-opencode/issues/6) | **Extract `ViewCoordinator`** — Collapse repeated leaf-management logic into a single module. |
| 7 | [#7](https://github.com/kriss-spy/obsidian-opencode/issues/7) | **Extract `PtySession`** — Isolate PTY proxy lifecycle from the terminal view. Extract inline Python script to a standalone file. |
| 8 | [#8](https://github.com/kriss-spy/obsidian-opencode/issues/8) | **Extract `SessionExporter`** — Move export formatting out of `OpencodeConversationView`. |
| 9 | [#9](https://github.com/kriss-spy/obsidian-opencode/issues/9) | **Extract `TerminalKeyRouter`** — Replace raw DOM key interception with Obsidian `Scope` API. |
| 10 | [#10](https://github.com/kriss-spy/obsidian-opencode/issues/10) | **Fix session preview for large sessions** — Handle `export` buffer limits and parsing errors for sessions with massive token counts. |

**Blocked by:** None.

---

## v1.4.0 — Panel Mode

> **Goal:** Add a VS Code-style bottom terminal panel while keeping the existing sidebar mode intact.

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Panel mode setting** | New setting: `panelMode: "sidebar" | "bottom"`. Default remains `"sidebar"`. |
| 2 | **Bottom panel docking** | When `panelMode === "bottom"`, create the terminal leaf via horizontal split at the bottom of the workspace. |
| 3 | **Clean panel chrome** | Hide the tab header for OpenCode terminal leaves to remove the close button. |
| 4 | **Instance-preserving toggle** | Toggle command collapses or expands the parent split instead of closing the leaf. |
| 5 | **Toggle focus vs hide** | When the right sidebar is already showing the terminal, `toggleTerminalSidebar` focuses the terminal instead of hiding the sidebar. |

**Blocked by:** v1.3.0 (`PtySession` refactor for testability; `ViewCoordinator` for leaf management reuse).

---

## v1.5.0 — Terminal Integration

> **Goal:** Tighter integration between the terminal and the vault.

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Clickable vault links** | Custom xterm link provider: `[[WikiLinks]]` and vault-relative paths open the corresponding note in Obsidian. |
| 2 | **Folder drag-and-drop** | Extend `terminalDrop.ts` to accept folder drops (vault folder context injection). |
| 3 | **Session export command** | Command to export the active terminal session using OpenCode's built-in `export` to a path configurable in plugin settings. |

**Blocked by:** v1.3.0 (`SessionExporter` refactor unlocks clean export command implementation).

---

## v1.6.0 — Session Management

> **Goal:** Replace the heavy conversation view with lightweight, fast session tools.

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Quick session switcher** | Command palette fuzzy finder for all sessions; enter to restore in terminal. Replaces the current conversation view as the primary navigation. |
| 2 | **Session bookmarks / pins** | Command to pin the current session; pinned sessions appear first in the switcher. |
| 3 | **Session search** | Filter sessions in the switcher by title, directory, or date range. |

**Blocked by:** v1.3.0 (session list reliability); v1.5.0 (export command provides a path for conversation view removal). |

---

## Future (no milestone)

Ideas under consideration but not yet scheduled:

- **Multi-terminal tabs** — Multiple OpenCode terminal instances in the same panel area (held back by singleton `sessionArgs` architecture; requires `SessionState` Map refactor)
- **Export templates** — User-defined frontmatter keys and Markdown body format for session export
- **Cost aggregation dashboard** — Vault-level view of total OpenCode usage
- **Custom keyboard shortcuts for terminal input routing** — Override default terminal key interception per user preference
- **Environment variable injection** — Pass custom env vars to the `opencode` process via plugin settings
- **Workspace layout persistence** — Remember sidebar vs bottom panel per Obsidian workspace layout

---

[issues]: https://github.com/kriss-spy/obsidian-opencode/issues
