# Obsidian Plugin Development Skill

A comprehensive skill for developing Obsidian plugins with TypeScript. This skill guides you through the entire plugin development lifecycle from setup to release.

## When to Use This Skill

Use this skill when:
- Creating a new Obsidian plugin from scratch
- Adding features to existing plugins (commands, settings, views, etc.)
- Debugging plugin issues
- Setting up the development environment
- Understanding Obsidian plugin architecture

## Quick Start

### 1. Generate a New Plugin

Use the included generator script:

```bash
python3 ~/.config/opencode/skills/obsidian-plugin-dev/scripts/generate_plugin.py my-plugin-name
```

This creates a complete plugin scaffold with:
- `manifest.json` - Plugin metadata
- `main.ts` - Entry point with sample code
- `settings.ts` - Settings interface and defaults
- `settingsTab.ts` - Settings UI
- Build configuration files

### 2. Install Dependencies

```bash
cd my-plugin-name
npm install
```

### 3. Build the Plugin

```bash
npm run dev    # Watch mode for development
npm run build  # Production build
```

### 4. Test in Obsidian

1. Copy `main.js` and `manifest.json` to your vault:
   - Linux: `~/.config/obsidian/plugins/my-plugin-name/`
   - macOS: `~/Library/Application Support/obsidian/plugins/my-plugin-name/`
   - Windows: `%APPDATA%\obsidian\plugins\my-plugin-name\`

2. Enable the plugin in Obsidian: Settings → Community Plugins

## Skill Contents

### SKILL.md
Comprehensive guide covering:
- Plugin architecture and lifecycle
- Project structure recommendations
- Adding commands, settings, and UI elements
- Custom views and modals
- Event handling
- File system operations
- Best practices

### References
- **api-reference.md** - Complete API reference with examples
- Common patterns and code snippets
- Debugging tips
- Testing checklist

### Examples
- **task-manager-example.md** - Complete working plugin example
  - Settings system
  - Multiple commands
  - Custom view
  - Modal dialogs
  - File operations
  - Event handling
  - CSS styling

### Scripts
- **generate_plugin.py** - Plugin scaffolding generator

## Common Patterns

### Adding a Command
```typescript
this.addCommand({
  id: 'my-command',
  name: 'My Command',
  callback: () => {
    new Notice('Command executed!');
  }
});
```

### Adding Settings
```typescript
// In settings.ts
export interface MySettings {
  mySetting: string;
}
export const DEFAULT_SETTINGS: MySettings = {
  mySetting: 'default'
};

// In main.ts
async loadSettings() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
}
```

### Working with Files
```typescript
const file = this.app.vault.getAbstractFileByPath('MyNote.md');
if (file instanceof TFile) {
  const content = await this.app.vault.read(file);
}
```

## Development Tips

1. **Hot Reload** - Install the "Hot-Reload" community plugin for automatic reloading during development
2. **Console** - Open Developer Tools (Ctrl/Cmd+Shift+I) to see console output
3. **TypeScript** - Use TypeScript for better IDE support and type safety
4. **Error Handling** - Always wrap async operations in try/catch blocks

## Resources

- [Obsidian Documentation](https://docs.obsidian.md/)
- [Sample Plugin Template](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
