# Obsidian OpenCode

A plugin that embeds the OpenCode CLI directly into Obsidian. Manage your AI coding sessions, browse conversation history, and resume work without leaving your vault.

## ✨ Features

- **Native OpenCode Execution:** Runs the OpenCode CLI directly inside Obsidian using a WebGL-accelerated terminal, ensuring smooth performance for long coding sessions.
- **Vault-Centric Workflow:** Automatically spawns the agent in your vault's root, ensuring it has immediate access to your notes and project files.
- **Session Manager:** 
  - **History Browser:** View a list of all your past OpenCode sessions with timestamps and working directories.
  - **Conversation Preview:** Inspect message history, token usage, model details, and costs before deciding to resume.
  - **One-Click Restore:** Instantly resume a previous session in the embedded terminal.
  - **Export to Markdown:** Save entire conversation threads as formatted notes in your vault for documentation or review.

## 🚀 Installation

*Note: This plugin must currently be installed manually.*

1. Clone this repository to your local machine:
   ```bash
   git clone https://github.com/kriss-spy/obsidian-opencode.git
   ```
2. Navigate to the project directory and install dependencies:
   ```bash
   cd obsidian-opencode
   npm install
   ```
3. Build the plugin:
   ```bash
   npm run build
   ```
4. Create the plugin folder in your vault and copy the required files over:
   ```bash
   mkdir -p /path/to/your/vault/.obsidian/plugins/obsidian-opencode/
   cp main.js manifest.json styles.css /path/to/your/vault/.obsidian/plugins/obsidian-opencode/
   ```
5. Reload Obsidian and enable the **OpenCode** plugin in the Community Plugins settings.

## 💻 Usage

- **Terminal:** Use the command palette (`Ctrl/Cmd + P`) and select **"OpenCode: Open Terminal"** to launch the CLI.
- **Sessions View:** Use the command palette to select **"OpenCode: Open Sessions"** to browse, restore, or export past conversations.
- **Settings:** Configure your `opencode` binary path, default CLI arguments, and terminal styling preferences (font size/family) in the Obsidian settings under the "OpenCode" tab.

## 🛠️ Development

To develop the plugin, you can run the development script which automatically rebuilds the plugin when files change:

```bash
npm run dev
```

## ⚠️ Known Issues

- **Session Previews / Loading:** While the buffer size for exporting sessions has been increased (up to 100MB), exceptionally large or deeply complex OpenCode sessions with massive token counts may still occasionally fail to preview or load properly.

## 📄 License

MIT License
