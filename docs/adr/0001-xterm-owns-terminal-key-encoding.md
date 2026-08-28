# ADR 0001: xterm owns terminal key encoding

Status: Accepted

## Context

The plugin previously handled `keydown` at document capture phase, duplicated part of xterm's key encoder, and wrote directly to the PTY. xterm separately handled the same DOM and composition events. Multiple writers made ordering depend on browser IME timing and caused Korean committed text to arrive after a following Space (#44). It also risked stale behavior for terminal modes, AltGr, dead keys, and future xterm changes.

Obsidian commands still need a deliberate way to escape the terminal while it has focus. Obsidian's focused key scopes can provide that boundary without intercepting every terminal key.

## Decision

Use a standalone Obsidian `Scope` while the terminal container has focus. Load OpenCode's effective keymap (defaults plus `tui.json`/`tui.jsonc` overrides), then register every effective Obsidian hotkey not claimed by OpenCode. OpenCode wins conflicts. Do not invoke commands during composition.

Let xterm handle every other keyboard and composition event. Route paste through `terminal.paste` and synthesized terminal input through `terminal.input`. Treat `terminal.onData` as the sole ordered production input stream into `PtySession.writeStdin`.

Keep the PTY implementations behind that boundary. Windows ConPTY and Unix `pty.fork()` differ in process and resize transport, not in shortcut or IME ownership.

## Consequences

- Korean composition and a following key are ordered by xterm's composition helper.
- Terminal application modes and xterm fixes apply without maintaining a second encoder.
- Obsidian shortcuts work normally unless OpenCode claims the same keystroke.
- The OpenCode defaults are a versioned compatibility snapshot and must be updated when upstream adds or changes bindings.
- The localized effective-hotkey adapter relies on Obsidian internals because the public API does not expose resolved command hotkeys.
- Native candidate-window behavior remains a manual platform check; automated tests cover routing and committed-data ordering.
