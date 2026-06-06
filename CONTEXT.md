# obsidian-opencode

The Obsidian plugin that embeds the OpenCode CLI inside Obsidian, lets the user manage OpenCode conversation history from a sidebar view, and exchanges file-drop notifications with the OpenCode TUI over a local WebSocket.

## Language

### The product and its host

**OpenCode**:
The external CLI / TUI that this plugin embeds. Lives in the user's PATH (or at the configured `opencodePath`); the plugin never reimplements it.
_Avoid_: "the agent", "the AI", "opencode binary".

**Plugin**:
This Obsidian plugin (the `opencode` plugin id, the `obsidian-opencode` repository). Runs inside Obsidian's Electron renderer, owns two views, and shells out to the OpenCode CLI.
_Avoid_: "extension", "wrapper", "integration", "Obsidian OpenCode" (that's the repo name, not the in-app concept).

**Vault**:
The Obsidian vault. Doubles as the plugin's default working directory and as the workspace the plugin advertises to the OpenCode TUI.
_Avoid_: "workspace" (collides with `app.workspace` and with `cwd`).

### User-facing surfaces

**Terminal View**:
The right-sidebar Obsidian view that hosts the xterm.js terminal running the OpenCode CLI. The user types prompts and watches streaming output here.
_Avoid_: "terminal panel", "terminal tab" (it's a leaf, not a tab).

**Conversation View**:
The right-sidebar Obsidian view that lists past OpenCode sessions, previews a session's message history, and offers Restore / Export / Delete.
_Avoid_: "history panel", "sessions tab".

### OpenCode-side concepts (as exposed by the CLI)

**Session**:
A single conversation with OpenCode, identified by a stable `id`, with its own title, working directory, and message history. Persisted by the OpenCode CLI itself; this plugin only reads, resumes, or exports it.
_Avoid_: "chat", "thread", "conversation" (see flagged ambiguity below).

**Continue Last Session**:
A new terminal spawn that passes `-c` to the OpenCode CLI so it picks up the user's most recent session automatically.
_Avoid_: "resume session" (that word is overloaded with Restore in Terminal — see dialogue).

**Restore in Terminal**:
A new terminal spawn that passes `-s <sessionId>` plus the session's original working directory, reopening a specific past session in the Terminal View.
_Avoid_: "open session", "reopen".

### Bridging concepts (plugin ↔ TUI)

**Drop / File Drop**:
The user action of dragging a file (from Obsidian's file explorer, or from the OS) into the Terminal View. The plugin's job is to surface that file to the running OpenCode TUI as a context reference.
_Avoid_: "drag", "drop event" (be specific — it's a file drop, not any drop).

**Context Pill**:
The in-TUI rendered representation of a referenced file (looks like `@path/to/file.md` inside the prompt). The goal of a File Drop is to produce a fully-confirmed Context Pill in the TUI without forcing the user to manually press Enter to confirm the autocomplete menu.
_Avoid_: "mention", "file reference" (OpenCode's own UI calls it a pill; "mention" is the wire-protocol verb).

**Editor Server**:
A localhost WebSocket server the plugin runs while the Terminal View is open. Advertises the vault to the OpenCode TUI via a lock file so the TUI auto-discovers this vault as an "editor" and accepts `at_mentioned` JSON-RPC notifications.
_Avoid_: "WebSocket server" (true but generic; the editor-protocol framing is what makes it an Editor Server).

**at_mentioned**:
The JSON-RPC method the Editor Server pushes to a connected OpenCode TUI to tell it that a file was dropped onto the Terminal View, so the TUI can render a Context Pill for it.
_Avoid_: "file mention event", "drop notification" (the wire method is `at_mentioned`).

**Vault-relative Path**:
A path expressed relative to the vault root, as opposed to an absolute filesystem path. The Editor Server normalises dropped paths to vault-relative form before sending `at_mentioned`.
_Avoid_: "relative path" (ambiguous — relative to what?).

### Lifecycle concepts

**Session State**:
The queued args / cwd / pending-prompt that the next Terminal View spawn should pick up. Held in memory only; cleared after one spawn.
_Avoid_: "session config", "spawn config".

**Pending Prompt**:
A prompt string queued onto the next `opencode --prompt` spawn, set by the `@opencode` Markdown editor suggest before the user invokes "New Session".
_Avoid_: "initial prompt", "queued prompt".

## Relationships

- A **Plugin** registers exactly two **Views**: one **Terminal View** and one **Conversation View**.
- A **Terminal View** hosts zero or one **OpenCode CLI process** at a time (replaced on every Continue / Restore / New).
- A running **Terminal View** also owns one **Editor Server**; both are torn down on view close.
- An **OpenCode CLI process** owns zero or more **Sessions**, identified by a stable `id`.
- A **Conversation View** lists **Sessions** and, on user action, triggers a new **Terminal View** spawn to perform a **Continue Last Session** or **Restore in Terminal**.
- A **File Drop** on a **Terminal View** produces an `at_mentioned` message from the **Editor Server** to the **OpenCode TUI**, which renders a **Context Pill**.
- A **Session Export** is a 1:1 projection of one **Session** (identified by `opencode-session` in its frontmatter) into a Markdown file under `<vault>/OpenCode/`.
- A **Pending Prompt** is consumed by the next **Terminal View** spawn; a **Session State** entry is consumed by the next spawn.

## Example dialogue

> **Dev:** "When the user clicks 'Restore in Terminal' on a session in the Conversation View, what exactly gets spawned?"
> **Domain expert:** "A new Terminal View is opened, the plugin sets Session State to `-s <sessionId>` and the session's original working directory, and the next terminal spawn runs `opencode -s <sessionId>` in that directory. That's what makes it 'restore' — same session, same cwd it was born in."

> **Dev:** "And 'Continue Last Session' on the ribbon icon — same thing?"
> **Domain expert:** "Different. Continue passes `-c` and no session id, so OpenCode itself picks whatever its most recent session is. No Session State cwd is set — it falls back to the vault root or the configured default. Don't call it 'restore' — that word means the specific `-s <id>` form."

> **Dev:** "OK, and the `~/.claude/ide/<port>.lock` file the Editor Server writes — is that an OpenCode convention or a Claude one?"
> **Domain expert:** "It's the lock-file convention the OpenCode TUI watches for editor discovery. The plugin currently writes it under `~/.claude/ide/` because the OpenCode editor-discovery protocol is modelled on Claude Code's. We treat that path as a protocol-level convention, not a plugin choice — but it's worth flagging as a question of correctness if the protocol ever changes."

## Flagged ambiguities

- **"conversation" vs "session"** — The UI surface is called the **Conversation View** and the user-facing buttons say "Conversations" / "Restore in Terminal" / "Export to Note", but the underlying OpenCode concept is a **Session** (it's what `opencode session list` returns, what `--session` / `-s` resumes, and what `opencode export` writes out). Resolution: **Session** is the canonical term for the data; **Conversation** is reserved for the View's display name and ribbon label. Issue titles and code identifiers should use "session" (matches the CLI and the data model).

- **"workspace"** — Obsidian exposes `app.workspace` (the leaf/split API) and the plugin also deals with working directories (vault root, per-session cwd). Resolution: use **workspace** only for the Obsidian API object; use **working directory** (or **cwd**) for the filesystem concept, and **vault** for the Obsidian vault itself.

- **"drop"** — Could mean a File Drop (the intended UX), a Tab drag (a side effect of the Terminal View living in a leaf), or a generic DOM drop event. Resolution: **File Drop** is the product concept; the DOM event is just the transport. Code identifiers may say `drop` / `dropHandler` because that's the DOM term, but issues and design notes should say File Drop.
