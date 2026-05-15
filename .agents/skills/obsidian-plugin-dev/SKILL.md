---
name: obsidian-plugin-dev
description: Guide for developing Obsidian plugins with TypeScript. This skill should be used when creating new Obsidian plugins, adding features to existing plugins, debugging plugin issues, or setting up the development environment. Covers plugin lifecycle, commands, settings, views, event handling, and best practices.
---

# Obsidian Plugin Development

## Overview

This skill guides you through creating, developing, and debugging Obsidian plugins. Obsidian plugins are TypeScript/JavaScript modules that extend Obsidian's functionality through a well-defined API.

## Core Concepts

### Plugin Architecture

An Obsidian plugin consists of:

1. **Entry Point** (`main.ts` → compiled to `main.js`)
2. **Manifest** (`manifest.json`) - Plugin metadata and requirements
3. **Styles** (`styles.css` - optional) - Custom CSS
4. **Assets** - Any additional files your plugin needs

### Plugin Lifecycle

```
onload() → [Active] → onunload()
    ↓
Registers commands, settings, views, events
    ↓
onunload() - cleanup resources
```

**Key Lifecycle Methods:**
- `onload()` - Initialize plugin (register commands, settings, etc.)
- `onunload()` - Clean up (remove event listeners, save state)
- `onUserEnable()` - Called when user explicitly enables plugin

## Project Structure

### Minimal Plugin Structure

```
my-plugin/
├── manifest.json          # Plugin metadata
├── main.ts                # Entry point (TypeScript)
├── main.js                # Compiled output (generated)
├── styles.css             # Optional styling
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
└── esbuild.config.mjs     # Build configuration
```

### Recommended Project Structure

```
my-plugin/
├── src/
│   ├── main.ts           # Entry point
│   ├── settings.ts       # Settings interface & defaults
│   ├── commands.ts       # Command implementations
│   ├── views/
│   │   └── myView.ts     # Custom view classes
│   └── utils.ts          # Helper functions
├── manifest.json
├── styles.css
├── package.json
└── esbuild.config.mjs
```

## Required Files

### manifest.json

```json
{
  "id": "my-unique-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "minAppVersion": "0.15.0",
  "description": "Description of what the plugin does",
  "author": "Your Name",
  "authorUrl": "https://yourwebsite.com",
  "fundingUrl": "https://github.com/sponsors/yourusername",
  "isDesktopOnly": false
}
```

**Field Descriptions:**
- `id` - Unique identifier (lowercase, no spaces, never change after release)
- `name` - Human-readable display name
- `version` - Semantic versioning (x.y.z)
- `minAppVersion` - Minimum Obsidian version required
- `description` - Brief description
- `author` - Your name
- `authorUrl` - Optional link to your site
- `fundingUrl` - Optional donation/support link
- `isDesktopOnly` - Set to `true` if using Node.js/Electron APIs

### main.ts (Entry Point)

```typescript
import { Plugin } from 'obsidian';

export default class MyPlugin extends Plugin {
  async onload() {
    console.log('Loading plugin');
    
    // Register commands
    this.addCommand({
      id: 'my-command',
      name: 'My Command',
      callback: () => {
        console.log('Command executed!');
      }
    });
  }

  onunload() {
    console.log('Unloading plugin');
  }
}
```

## Plugin Features

### Adding Commands

Commands appear in the Command Palette (Ctrl/Cmd+P):

```typescript
this.addCommand({
  id: 'sample-command',
  name: 'Sample Command',
  callback: () => {
    new Notice('Hello from my plugin!');
  }
});
```

**Command Types:**

1. **Simple Command** - No editor context needed
```typescript
this.addCommand({
  id: 'simple-command',
  name: 'Simple Command',
  callback: () => {
    // Do something
  }
});
```

2. **Editor Command** - Works with the active editor
```typescript
this.addCommand({
  id: 'editor-command',
  name: 'Editor Command',
  editorCallback: (editor, view) => {
    editor.replaceSelection('Hello World');
  }
});
```

3. **Check Command** - Determines if command should be available
```typescript
this.addCommand({
  id: 'conditional-command',
  name: 'Conditional Command',
  checkCallback: (checking: boolean) => {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      if (!checking) {
        // Execute command
        new Notice(`Active file: ${activeFile.name}`);
      }
      return true; // Command is available
    }
    return false; // Command is not available
  }
});
```

### Settings

Create persistent configuration that survives restarts:

**settings.ts:**
```typescript
export interface MyPluginSettings {
  setting1: string;
  setting2: boolean;
  setting3: number;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
  setting1: 'default value',
  setting2: true,
  setting3: 42
};
```

**main.ts:**
```typescript
import { Plugin } from 'obsidian';
import { MyPluginSettings, DEFAULT_SETTINGS } from './settings';
import { MySettingTab } from './settingsTab';

export default class MyPlugin extends Plugin {
  settings: MyPluginSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new MySettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

**settingsTab.ts:**
```typescript
import { App, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from './main';

export class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'My Plugin Settings' });

    new Setting(containerEl)
      .setName('Setting 1')
      .setDesc('Description of setting 1')
      .addText(text => text
        .setPlaceholder('Enter value')
        .setValue(this.plugin.settings.setting1)
        .onChange(async (value) => {
          this.plugin.settings.setting1 = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Enable Feature')
      .setDesc('Toggle a feature on/off')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.setting2)
        .onChange(async (value) => {
          this.plugin.settings.setting2 = value;
          await this.plugin.saveSettings();
        }));
  }
}
```

**Setting Input Types:**
- `.addText()` - Text input
- `.addTextArea()` - Multi-line text
- `.addToggle()` - Boolean toggle
- `.addSlider()` - Numeric slider
- `.addDropdown()` - Dropdown selection
- `.addColorPicker()` - Color picker
- `.addButton()` - Action button
- `.addMomentFormat()` - Date/time format
- `.addSearch()` - Search input

### UI Elements

**Ribbon Icon** (left sidebar):
```typescript
this.addRibbonIcon('dice', 'My Plugin', (evt: MouseEvent) => {
  new Notice('Ribbon icon clicked!');
});
```

**Status Bar Item** (bottom bar, desktop only):
```typescript
const statusBarItem = this.addStatusBarItem();
statusBarItem.setText('Status: Ready');
```

**Modal Dialog:**
```typescript
import { Modal, App } from 'obsidian';

class MyModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.setText('Modal content here');
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// Usage
new MyModal(this.app).open();
```

**Suggest Modal** (autocomplete-style):
```typescript
import { SuggestModal, TFile } from 'obsidian';

class FileSuggestModal extends SuggestModal<TFile> {
  getSuggestions(query: string): TFile[] {
    const files = this.app.vault.getMarkdownFiles();
    return files.filter(file => 
      file.basename.toLowerCase().includes(query.toLowerCase())
    );
  }

  renderSuggestion(file: TFile, el: HTMLElement) {
    el.createEl('div', { text: file.basename });
    el.createEl('small', { text: file.path });
  }

  onChooseSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent) {
    new Notice(`Selected ${file.basename}`);
  }
}
```

### Custom Views

Create custom pane views (like Graph view or Backlinks):

```typescript
import { ItemView, WorkspaceLeaf } from 'obsidian';

export const VIEW_TYPE_EXAMPLE = 'example-view';

export class ExampleView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_EXAMPLE;
  }

  getDisplayText() {
    return 'Example View';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.createEl('h4', { text: 'My Custom View' });
  }

  async onClose() {
    // Cleanup
  }
}

// Register in main.ts
this.registerView(
  VIEW_TYPE_EXAMPLE,
  (leaf) => new ExampleView(leaf)
);

// Open the view
this.app.workspace.detachLeavesOfType(VIEW_TYPE_EXAMPLE);
await this.app.workspace.getRightLeaf(false).setViewState({
  type: VIEW_TYPE_EXAMPLE,
  active: true,
});
this.app.workspace.revealLeaf(
  this.app.workspace.getLeavesOfType(VIEW_TYPE_EXAMPLE)[0]
);
```

### Event Handling

**Register Events:**
```typescript
// File open event
this.registerEvent(
  this.app.workspace.on('file-open', (file: TFile) => {
    console.log('Opened:', file?.path);
  })
);

// Active leaf change
this.registerEvent(
  this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf) => {
    console.log('Active leaf changed');
  })
);

// Metadata cache change
this.registerEvent(
  this.app.metadataCache.on('changed', (file: TFile) => {
    console.log('Metadata changed:', file.path);
  })
);

// Editor change
this.registerEvent(
  this.app.workspace.on('editor-change', (editor: Editor) => {
    console.log('Editor content changed');
  })
);
```

**Available Events:**
- `file-open` - When a file is opened
- `file-create` - When a file is created
- `file-delete` - When a file is deleted
- `file-rename` - When a file is renamed
- `active-leaf-change` - When active pane changes
- `editor-change` - When editor content changes
- `metadata-cache:changed` - When file metadata changes
- `vault:change` - When vault changes
- `layout-change` - When workspace layout changes

### File System Operations

**Reading Files:**
```typescript
// Read file content
const file = this.app.vault.getAbstractFileByPath('MyNote.md');
if (file instanceof TFile) {
  const content = await this.app.vault.read(file);
  console.log(content);
}
```

**Creating Files:**
```typescript
await this.app.vault.create('NewNote.md', '# Hello World');
```

**Modifying Files:**
```typescript
const file = this.app.vault.getAbstractFileByPath('MyNote.md');
if (file instanceof TFile) {
  await this.app.vault.modify(file, '# Updated Content');
}
```

**Getting All Files:**
```typescript
const allMarkdownFiles = this.app.vault.getMarkdownFiles();
const allFiles = this.app.vault.getFiles();
```

### Metadata Cache

Access parsed metadata from files:

```typescript
const file = this.app.vault.getAbstractFileByPath('MyNote.md');
if (file instanceof TFile) {
  const cache = this.app.metadataCache.getFileCache(file);
  
  // Frontmatter
  console.log(cache?.frontmatter);
  
  // Headings
  console.log(cache?.headings);
  
  // Links
  console.log(cache?.links);
  
  // Embeds
  console.log(cache?.embeds);
  
  // Tags
  console.log(cache?.tags);
}
```

### Editor Extensions

Add CodeMirror 6 extensions for advanced editor features:

```typescript
import { Extension } from '@codemirror/state';
import { ViewPlugin, ViewUpdate } from '@codemirror/view';

const myViewPlugin = ViewPlugin.fromClass(class {
  constructor(view: EditorView) {
    // Initialize
  }

  update(update: ViewUpdate) {
    // Handle updates
  }
});

this.registerEditorExtension(myViewPlugin);
```

## Development Workflow

### Quick Start

1. **Clone sample plugin:**
```bash
git clone https://github.com/obsidianmd/obsidian-sample-plugin.git my-plugin
cd my-plugin
```

2. **Install dependencies:**
```bash
npm install
```

3. **Build plugin:**
```bash
npm run dev  # Watch mode
# or
npm run build  # One-time build
```

### Development Setup

1. **Create development vault** with folder structure:
```
DevVault/
└── .obsidian/
    └── plugins/
        └── my-plugin/
```

2. **Symlink or copy** plugin files:
```bash
# Option 1: Copy build artifacts
cp main.js manifest.json styles.css /path/to/DevVault/.obsidian/plugins/my-plugin/

# Option 2: Use symlinks (Linux/Mac)
ln -s /path/to/plugin/dist/main.js /path/to/DevVault/.obsidian/plugins/my-plugin/main.js
```

3. **Enable plugin** in Obsidian:
   - Open Settings → Community Plugins
   - Enable "My Plugin"

4. **Hot Reload** (optional):
   - Install "Hot-Reload" plugin from community plugins
   - Automatically reloads plugin on file changes

### Building for Release

1. Update `manifest.json` version
2. Update `versions.json` with compatibility:
```json
{
  "1.0.0": "0.15.0",
  "1.0.1": "0.15.0"
}
```
3. Build: `npm run build`
4. Create GitHub release with:
   - `main.js`
   - `manifest.json`
   - `styles.css` (if exists)

## Common Patterns

### Working with Active File

```typescript
const activeFile = this.app.workspace.getActiveFile();
if (activeFile) {
  const content = await this.app.vault.read(activeFile);
  // Work with content
}
```

### Inserting at Cursor

```typescript
const view = this.app.workspace.getActiveViewOfType(MarkdownView);
if (view) {
  const editor = view.editor;
  const cursor = editor.getCursor();
  editor.replaceRange('Inserted text', cursor);
}
```

### Opening Files

```typescript
// Open file in new leaf
const file = this.app.vault.getAbstractFileByPath('MyNote.md');
if (file instanceof TFile) {
  await this.app.workspace.openLinkText(file.path, '', true);
}
```

### Creating Folders

```typescript
await this.app.vault.createFolder('MyFolder');
```

### Reading Frontmatter

```typescript
const file = this.app.workspace.getActiveFile();
if (file) {
  const metadata = this.app.metadataCache.getFileCache(file);
  const frontmatter = metadata?.frontmatter;
  if (frontmatter) {
    console.log(frontmatter.customProperty);
  }
}
```

## Best Practices

### Code Organization

1. **Separate concerns** - Keep settings, commands, and views in separate files
2. **Use TypeScript** - Leverage type safety
3. **Handle errors** - Wrap async operations in try/catch
4. **Clean up** - Always unregister events and intervals in `onunload()`

### Performance

1. **Debounce expensive operations** - Use debouncing for search/filter
2. **Cache results** - Don't re-read files unnecessarily
3. **Lazy load** - Only initialize features when needed
4. **Use web workers** - For heavy computations

### User Experience

1. **Show progress** - Use Notices for feedback
2. **Validate input** - Check settings and user input
3. **Provide defaults** - Sensible defaults for all settings
4. **Document commands** - Clear names and descriptions

### Error Handling

```typescript
async safeOperation() {
  try {
    const file = this.app.vault.getAbstractFileByPath('MyNote.md');
    if (!file) {
      new Notice('File not found');
      return;
    }
    // Continue with operation
  } catch (error) {
    console.error('Operation failed:', error);
    new Notice('An error occurred. Check console for details.');
  }
}
```

## Resources

### Official Resources
- [Obsidian Documentation](https://docs.obsidian.md/)
- [Sample Plugin Template](https://github.com/obsidianmd/obsidian-sample-plugin)
- [API Types](https://github.com/obsidianmd/obsidian-api)

### Community Resources
- [Obsidian Developer Docs](https://docs.obsidian.md/)
- [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)

### Useful APIs
- `this.app` - Main application instance
- `this.app.vault` - File system operations
- `this.app.workspace` - Workspace and layout
- `this.app.metadataCache` - File metadata
- `this.app.fileManager` - File management utilities
- `this.app.commands` - Command registration
- `this.app.setting` - Settings management
