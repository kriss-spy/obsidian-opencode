# Terminal input contract

The focused terminal is an xterm surface, not an Obsidian text surface. xterm owns keyboard encoding and IME composition. The plugin owns only the boundary between Obsidian commands and terminal input.

## Before and after

```text
Before

document capture keydown ---------------------> PtySession.writeStdin
xterm textarea / CompositionHelper -> onData -> PtySession.writeStdin
paste ----------------------------------------> PtySession.writeStdin
drop -----------------------------------------> PtySession.writeStdin
Windows mouse helpers ------------------------> PtySession.writeStdin

After

focused standalone Scope -> non-conflicting Obsidian command
DOM keyboard / composition -----+
paste -> terminal.paste ---------+
drop / mouse -> terminal.input --+-> xterm onData -> PtySession.writeStdin -> platform PTY
```

The old path had five independently scheduled PTY writers. The new path has one.

## Ownership

| Input | Owner while the terminal is focused | Route |
| --- | --- | --- |
| Printable, navigation, Enter, Tab, function, Ctrl/Alt/Meta, AltGr, and dead keys | xterm / OpenCode | DOM event -> xterm -> `terminal.onData` -> `PtySession.writeStdin` |
| IME composition and committed text | xterm's `CompositionHelper` | composition events -> xterm -> `terminal.onData` -> PTY |
| Obsidian and plugin hotkeys not claimed by OpenCode | Obsidian | focused standalone `Scope` -> command registry |
| Clipboard paste | plugin policy, xterm encoding | normalize line endings -> `terminal.paste` -> `terminal.onData` -> PTY |
| Drop and synthesized TUI mouse input | plugin policy, xterm transport | `terminal.input` -> `terminal.onData` -> PTY |
| PTY byte transport | `PtySession` | the terminal view's `onData` callback is the only production caller of `writeStdin` |

The router resolves OpenCode defaults plus its global, environment-selected, project, and `.opencode` `tui.json`/`tui.jsonc` overrides. It then exposes every effective Obsidian hotkey whose normalized keystroke is absent from that OpenCode set. OpenCode owns conflicts, including context-specific bindings such as dialog navigation. Leader sequences reserve their first stroke so Obsidian cannot interrupt a pending sequence.

Obsidian custom hotkeys replace defaults, including an empty custom list. A command is never invoked for an event whose `isComposing` flag is set or whose legacy key code is 229. Keymap changes are picked up when a terminal view is registered; reopen the view after changing either application's hotkeys.

## Why issue #44 happened

The old document-capture router and xterm were competing writers. On Korean Chromium IME, xterm deliberately reads committed textarea content in a zero-delay task after `compositionend`. The router wrote the following Space directly to the PTY during the key event, so the PTY could receive Space before the Korean commit.

The router no longer encodes or writes terminal keys. xterm now orders composition finalization and the following key, and `terminal.onData` provides one ordered byte stream.

## Platform boundary

The browser-side input path is shared across operating systems. Only the PTY transport changes:

| Platform | PTY backend | Input handling difference |
| --- | --- | --- |
| Windows 10 1809+ | Node helper -> embedded zigpty native module -> ConPTY | None before `PtySession`; the helper writes UTF-8 strings to zigpty. xterm's `windowsPty` option affects terminal rendering/reflow, not key ownership. |
| Linux and macOS | Node child -> Python proxy -> `pty.fork()` | None before `PtySession`; the proxy forwards stdin bytes to the pseudoterminal. |

This means a Windows-only key encoder would be the wrong seam. Platform IMEs differ in their DOM event sequences, but all must be handled by xterm before the PTY backend.

## Event traces

Use this compact format when recording a regression:

```text
platform / browser / IME
event: key, code, keyCode, isComposing, textarea value
xterm onData: escaped payload
PTY stdin: escaped payload
```

Representative traces and required invariant:

| Case | Event outline | Required `onData` order |
| --- | --- | --- |
| Windows Korean IME + Space (#44) | `compositionstart`, updates, `compositionend`, `keydown Space` | `안녕`, then ` ` |
| CJK IME + Enter | composition lifecycle, `keydown Enter` | committed text, then `\r` |
| macOS dead key | dead-key event(s), committed key | one composed Unicode character; no intermediate accent |
| Windows AltGr | Ctrl+Alt-shaped key events producing a printable character | printable character; no Obsidian command |
| Linux IBus/Fcitx | composition lifecycle followed by printable/navigation key | committed text before following key |

The automated Obsidian test covers the Korean commit-plus-Space ordering with xterm's real `CompositionHelper`. Unit tests cover focused-scope arbitration, custom hotkeys, composition suppression, focus lifetime, and paste routing.

## Native IME smoke test

Synthetic browser events cannot validate an operating system's candidate window or every native event sequence. Before changing the router or xterm version, run this short native check on each available platform:

1. Focus the OpenCode prompt and enter composed Korean, Japanese, or Chinese text followed immediately by Space and Enter.
2. Confirm the committed text precedes Space and no character is missing or duplicated.
3. While composition is active, press keys that overlap configured Obsidian hotkeys; confirm no command opens.
4. Test one non-conflicting Obsidian/plugin hotkey and one OpenCode-conflicting hotkey while the terminal is focused.
5. Test AltGr or a dead key where available, then paste multiline text.

Record failures using the event-trace format above. Candidate-window placement and behavior still require a human using the native IME.
