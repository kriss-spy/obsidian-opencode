# Obsidian OpenCode

A plugin that embeds the OpenCode CLI directly into Obsidian. Manage your AI coding sessions, browse conversation history, and resume work without leaving your vault.

## ✨ Features

- **Native OpenCode Execution:** Runs the OpenCode CLI directly inside Obsidian using an integrated terminal, ensuring smooth performance for long coding sessions.
- **Vault-Centric Workflow:** Automatically spawns the agent in your vault's root, ensuring it has immediate access to your notes and project files.
- **Drag and Drop Context:** Drop files from Obsidian's file explorer directly into the terminal to insert them as `@path/to/file.md#1` mentions for OpenCode.
- **Session Manager:**
  - **History Browser:** View a list of all your past OpenCode sessions with timestamps and working directories.
  - **Conversation Preview:** Inspect message history, token usage, model details, and costs before deciding to resume.
  - **One-Click Restore:** Instantly resume a previous session in the embedded terminal.
  - **Export to Markdown:** Save entire conversation threads as formatted notes in your vault for documentation or review.

## 🖥️ Platform Support

- **Linux**: stable on my daily driver, not tested on all distros.
- **Windows**: Work in Progress.
- **macOS**: Experimental.

## 🚀 Installation

### From Obsidian Community Plugins (Recommended)

1. Open Obsidian and go to **Settings** → **Community plugins**
2. Click **Browse** and search for **OpenCode**
3. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/kriss-spy/obsidian-opencode/releases/latest)
2. Create a folder named `opencode` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into that folder
4. Reload Obsidian and enable the **OpenCode** plugin in Community Plugins settings

## Usage

- **Terminal:** Use the command palette (`Ctrl/Cmd + P`) and select **"OpenCode: Open Terminal"** to launch the CLI.
- **Sessions View:** Use the command palette to select **"OpenCode: Open Sessions"** to browse, restore, or export past conversations.
- **Settings:** Configure the full absolute path to your `opencode` executable, default CLI arguments, and terminal styling preferences (font size/family) in the Obsidian settings under the "OpenCode" tab. Do not rely on a command name from your shell `PATH`, because desktop-launched Obsidian may not inherit your shell environment.

## Development

To develop the plugin, you can run the development script which automatically rebuilds the plugin when files change:

```bash
npm run dev
```

Unit tests run with `npm test`. To create a fresh isolated vault and test the built plugin inside a sandboxed Obsidian instance, run:

```bash
npm run test:obsidian
```

This requirements suite includes open bug assertions and stays red until they are fixed. Use `npm run test:obsidian:smoke` for the currently passing baseline only.

See [Testing in Obsidian](docs/testing-obsidian.md) for setup, coverage, evidence, and limitations.

## ⚠️ Known Issues

- **Session Previews / Loading:** While the buffer size for exporting sessions has been increased (up to 100MB), exceptionally large or deeply complex OpenCode sessions with massive token counts may still occasionally fail to preview or load properly.

- **Limited Linux support:** While the plugin should work on major distros, it's only tested on manjaro, ubuntu, and fedora.

## 🙏 Acknowledgements

- **Terminal integration approach** inspired by [polyipseity/obsidian-terminal](https://github.com/polyipseity/obsidian-terminal) — the Python PTY proxy with `pty.fork()` and 4-pipe stdio for resize control (FD 3).

## 📄 License

MIT License
