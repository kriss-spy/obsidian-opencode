# OpenCode TUI Context Injection Issue

## Background
We are developing an Obsidian plugin that embeds OpenCode inside Obsidian using a PTY (`child_process.spawn` + `node-pty` / python proxy). We are implementing a **drag-and-drop feature**: when a user drags a file from the Obsidian explorer into the terminal, we extract the path and write it to the PTY's `stdin` so it becomes a context pill (e.g., `@path/to/file.md`).

## The Goal
We want to programmatically inject one or multiple files into the OpenCode TUI as fully confirmed "mention" pills, without requiring the user to manually hit `Enter` to confirm the autocomplete menu.

## The Problem
We are hitting severe race conditions because we are interacting with OpenCode's React/Ink-based TUI via raw `stdin` keystrokes. The TUI's autocomplete menu (which turns `@` text into a context pill) requires time to render and perform its fuzzy search. 

Because we are injecting keystrokes programmatically, our confirmation keystrokes (`\r` or `\t`) arrive before the autocomplete menu has fully initialized or captured the event priority.

## What We've Tried & Failure Modes

**Attempt 1: The `\r` Race Condition**
*   **Logic:** `pty.write('@folder/note.md')` -> `setTimeout(100ms)` -> `pty.write('\r')`.
*   **Result:** The menu doesn't always open fast enough. When it fails, `\r` bypasses the menu entirely and **submits the user's prompt prematurely**.

**Attempt 2: The `\t` (Tab) Workaround**
*   **Logic:** Since Enter submits the prompt, we tried using Tab to confirm the autocomplete. `pty.write('@folder/note.md')` -> `setTimeout(300ms)` -> `pty.write('\t')`.
*   **Result:** The menu still misses the timing sometimes. When Tab is pressed and the menu isn't focused, OpenCode interprets it as the global shortcut to **switch the active agent**. 

**Attempt 3: Plain Text Injection**
*   **Logic:** Inject all files at once: `pty.write('@file1.md @file2.md ')`.
*   **Result:** The TUI receives it as a single bulk string paste. The mention menu is never triggered, and the text remains plain text instead of properly instantiating as context pills.

**Attempt 4: Staggered Typing Simulation**
*   **Logic:** `pty.write('@')` -> wait -> `pty.write('file.md')` -> wait -> `pty.write('\r')`.
*   **Result:** The TUI's input handling seems to drop or misinterpret the sequence when artificially staggered, resulting in the same fall-through bugs where the prompt submits.

**Attempt 5: Manual Confirmation (Current State)**
*   **Logic:** `pty.write('@folder/note.md')` and stop.
*   **Result:** The menu opens correctly and waits for the user to physically press Enter. This works perfectly but is a terrible UX, especially when dropping 5 files at once (the user shouldn't have to manually confirm them).

## Our Ask / Questions for the Expert

1. **Is there a robust way to bypass the UI race condition?** Can we send a specific escape sequence, or paste the text in a specific format that OpenCode automatically recognizes and parses into context pills *without* needing to trigger the interactive autocomplete menu?
2. **Bulk Pasting:** If a user pastes multiple paths, does OpenCode have a built-in mechanism to parse them into context? (Our testing showed it just stays as plain text). 
3. **Event Debouncing:** Does the Ink TUI debounce `stdin` events in a way that requires a specific timing pattern to reliably trigger the autocomplete menu state?

We are looking for the "correct" programmatic way to pipe file context into a running OpenCode interactive session.