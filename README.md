# Obsidian OpenCode

A powerful Obsidian plugin that integrates the OpenCode CLI seamlessly into your Obsidian vault. Access your AI coding agent, manage sessions, and run terminal commands directly from your personal knowledge management environment.

## ✨ Features

- **Integrated Terminal:** A fully featured, hardware-accelerated (WebGL) terminal inside Obsidian, powered by xterm.js.
- **Vault-Aware Context:** The terminal automatically launches in your vault's root directory, giving the agent immediate context of your notes, code, and files.
- **Session Management:** 
  - Browse your recent OpenCode sessions directly from the dedicated "OpenCode Sessions" view.
  - Preview conversation history, token usage, model details, and costs.
  - **Restore Sessions:** Quickly resume a past conversation right inside the integrated terminal.
  - **Export to Note:** Export valuable OpenCode conversations as formatted markdown notes directly into your Obsidian vault.

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
