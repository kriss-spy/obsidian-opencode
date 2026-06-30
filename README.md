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

- **Linux**: Experimental (stable on my daily driver, not tested on all distros).
- **Windows**: Work in Progress (WIP).
- **macOS**: Not planned.

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
- **Settings:** Configure your `opencode` binary path, default CLI arguments, and terminal styling preferences (font size/family) in the Obsidian settings under the "OpenCode" tab.

## Development

To develop the plugin, you can run the development script which automatically rebuilds the plugin when files change:

```bash
npm run dev
```

## ⚠️ Known Issues

- **Session Previews / Loading:** While the buffer size for exporting sessions has been increased (up to 100MB), exceptionally large or deeply complex OpenCode sessions with massive token counts may still occasionally fail to preview or load properly.

- **Limited Linux support:** While the plugin should work on major distros, it's only tested on manjaro, ubuntu, and fedora.

## 🙏 Acknowledgements

- **Terminal integration approach** inspired by [polyipseity/obsidian-terminal](https://github.com/polyipseity/obsidian-terminal) — the Python PTY proxy with `pty.fork()` and 4-pipe stdio for resize control (FD 3).

## 📄 License

MIT License
