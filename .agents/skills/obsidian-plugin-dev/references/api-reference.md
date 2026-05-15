# Obsidian Plugin Reference

## Complete Sample Plugin

This is a complete, working plugin that demonstrates most common features:

### manifest.json
```json
{
  "id": "sample-plugin",
  "name": "Sample Plugin",
  "version": "1.0.0",
  "minAppVersion": "0.15.0",
  "description": "A sample plugin demonstrating Obsidian plugin development",
  "author": "Your Name",
  "authorUrl": "https://yourwebsite.com",
  "isDesktopOnly": false
}
```

### main.ts
```typescript
import { Plugin, TFile, Notice, MarkdownView } from 'obsidian';
import { SampleSettingTab } from './settings';

interface SamplePluginSettings {
  mySetting: string;
  enableFeature: boolean;
}

const DEFAULT_SETTINGS: SamplePluginSettings = {
  mySetting: 'default',
  enableFeature: false
};

export default class SamplePlugin extends Plugin {
  settings: SamplePluginSettings;

  async onload() {
    await this.loadSettings();

    // Add ribbon icon
    this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
      new Notice('Hello from Sample Plugin!');
    });

    // Add status bar item
    const statusBarItemEl = this.addStatusBarItem();
    statusBarItemEl.setText('Status Bar Text');

    // Add simple command
    this.addCommand({
      id: 'open-sample-modal-simple',
      name: 'Open sample modal (simple)',
      callback: () => {
        new Notice('Simple modal opened');
      }
    });

    // Add editor command
    this.addCommand({
      id: 'sample-editor-command',
      name: 'Sample editor command',
      editorCallback: (editor, view) => {
        console.log(editor.getSelection());
        editor.replaceSelection('Sample Editor Command');
      }
    });

    // Add complex command
    this.addCommand({
      id: 'open-sample-modal-complex',
      name: 'Open sample modal (complex)',
      checkCallback: (checking: boolean) => {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (markdownView) {
          if (!checking) {
            new SampleModal(this.app).open();
          }
          return true;
        }
        return false;
      }
    });

    // Add settings tab
    this.addSettingTab(new SampleSettingTab(this.app, this));

    // Register events
    this.registerEvent(
      this.app.workspace.on('file-open', (file: TFile) => {
        console.log('File opened:', file?.path);
      })
    );

    // Register interval
    this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
  }

  onunload() {
    console.log('Unloading plugin');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class SampleModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const {contentEl} = this;
    contentEl.setText('Woah!');
  }

  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}
```

### settings.ts
```typescript
import { App, PluginSettingTab, Setting } from 'obsidian';
import SamplePlugin from './main';

export class SampleSettingTab extends PluginSettingTab {
  plugin: SamplePlugin;

  constructor(app: App, plugin: SamplePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const {containerEl} = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('Setting #1')
      .setDesc('It\'s a secret')
      .addText(text => text
        .setPlaceholder('Enter your secret')
        .setValue(this.plugin.settings.mySetting)
        .onChange(async (value) => {
          this.plugin.settings.mySetting = value;
          await this.plugin.saveSettings();
        }));
  }
}
```

## package.json Template

```json
{
  "name": "obsidian-sample-plugin",
  "version": "1.0.0",
  "description": "This is a sample plugin for Obsidian (https://obsidian.md)",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "version": "node version-bump.mjs && git add manifest.json versions.json"
  },
  "keywords": [
    "obsidian",
    "plugin"
  ],
  "author": "Your Name",
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^16.11.6",
    "@typescript-eslint/eslint-plugin": "5.29.0",
    "@typescript-eslint/parser": "5.29.0",
    "builtin-modules": "3.3.0",
    "esbuild": "0.17.3",
    "obsidian": "latest",
    "tslib": "2.4.0",
    "typescript": "4.7.4"
  }
}
```

## tsconfig.json Template

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES6",
    "allowJs": true,
    "noImplicitAny": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "isolatedModules": true,
    "strictNullChecks": true
  },
  "include": [
    "**/*.ts"
  ]
}
```

## esbuild.config.mjs Template

```javascript
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner =
`/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const prod = (process.argv[2] === 'production');

const context = await esbuild.context({
	banner: {
		js: banner,
	},
	entryPoints: ['main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/*',
		'lezer',
		...builtins],
	format: 'cjs',
	target: 'es2018',
	logLevel: "info",
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
```

## versions.json Template

```json
{
  "1.0.0": "0.15.0"
}
```

## Key API Classes

### Plugin
Base class for all plugins.

**Properties:**
- `app: App` - Reference to the Obsidian application
- `manifest: PluginManifest` - Plugin metadata

**Methods:**
- `onload()` - Called when plugin is loaded
- `onunload()` - Called when plugin is unloaded
- `addCommand(command: Command)` - Register a command
- `addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any)` - Add ribbon icon
- `addStatusBarItem()` - Add status bar item
- `addSettingTab(tab: PluginSettingTab)` - Add settings tab
- `registerEvent(event: EventRef)` - Register an event
- `registerInterval(interval: number)` - Register an interval
- `registerEditorExtension(extension: Extension)` - Register CodeMirror extension
- `loadData(): Promise<any>` - Load plugin data
- `saveData(data: any): Promise<void>` - Save plugin data

### App
Main application instance.

**Properties:**
- `vault: Vault` - File system access
- `workspace: Workspace` - Workspace management
- `metadataCache: MetadataCache` - File metadata cache
- `fileManager: FileManager` - File operations
- `setting: Setting` - Settings

### Vault
File system operations.

**Methods:**
- `getAbstractFileByPath(path: string): TAbstractFile | null`
- `getMarkdownFiles(): TFile[]`
- `getFiles(): TFile[]`
- `read(file: TFile): Promise<string>`
- `readBinary(file: TFile): Promise<ArrayBuffer>`
- `create(path: string, data: string): Promise<TFile>`
- `createBinary(path: string, data: ArrayBuffer): Promise<TFile>`
- `modify(file: TFile, data: string): Promise<void>`
- `delete(file: TAbstractFile, force?: boolean): Promise<void>`
- `rename(file: TAbstractFile, newPath: string): Promise<void>`
- `createFolder(path: string): Promise<void>`
- `adapter: DataAdapter` - Low-level file system access

### Workspace
Workspace and layout management.

**Methods:**
- `getActiveFile(): TFile | null`
- `getActiveViewOfType<T extends View>(type: Constructor<T>): T | null`
- `getRightLeaf(split?: boolean): WorkspaceLeaf`
- `getLeftLeaf(split?: boolean): WorkspaceLeaf`
- `openLinkText(linktext: string, sourcePath: string, newLeaf?: boolean): Promise<void>`
- `setActiveLeaf(leaf: WorkspaceLeaf, pushHistory?: boolean): void`
- `on(name: 'file-open', callback: (file: TFile) => any): EventRef`
- `on(name: 'active-leaf-change', callback: (leaf: WorkspaceLeaf) => any): EventRef`

### MetadataCache
File metadata cache.

**Methods:**
- `getFileCache(file: TFile): CachedMetadata | null`
- `getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null`
- `resolvedLinks: Record<string, Record<string, number>>`
- `unresolvedLinks: Record<string, Record<string, number>>`
- `on(name: 'changed', callback: (file: TFile) => any): EventRef`
- `on(name: 'resolve', callback: (file: TFile) => any): EventRef`

## Useful Icons

Obsidian uses Lucide icons. Common icons:
- `dice` - Random/feature
- `search` - Search
- `settings` - Settings
- `trash` - Delete
- `edit` - Edit
- `plus` - Add
- `minus` - Remove
- `check` - Checkmark
- `x` - Close/X
- `folder` - Folder
- `file` - File
- `star` - Star
- `heart` - Heart
- `bookmark` - Bookmark
- `tag` - Tag
- `link` - Link
- `image` - Image
- `code` - Code
- `terminal` - Terminal
- `command` - Command
- `keyboard` - Keyboard

## Debugging Tips

### Console Logging
```typescript
// Basic logging
console.log('Debug message');
console.log('Settings:', this.settings);

// Inspect objects
console.dir(this.app);

// Group logs
console.group('Plugin Init');
console.log('Loading settings...');
console.log('Registering commands...');
console.groupEnd();
```

### Error Handling
```typescript
try {
  const content = await this.app.vault.read(file);
} catch (error) {
  console.error('Failed to read file:', error);
  new Notice('Failed to read file: ' + error.message);
}
```

### Using Developer Tools
1. Enable Developer Tools: Settings → Community Plugins → Developer Tools
2. Or use hotkey: Ctrl/Cmd + Shift + I
3. Check Console tab for logs and errors
4. Use Sources tab to set breakpoints

## Testing Checklist

### Before Release
- [ ] Test on desktop (Windows/Mac/Linux)
- [ ] Test on mobile (if `isDesktopOnly: false`)
- [ ] Test with different vault sizes
- [ ] Verify settings persist
- [ ] Check for console errors
- [ ] Test command palette integration
- [ ] Verify ribbon icon works
- [ ] Test settings UI
- [ ] Check performance with large files
- [ ] Validate manifest.json
- [ ] Update versions.json

### Common Issues
1. **Plugin doesn't load** - Check main.js exists and manifest.json is valid
2. **Settings not saving** - Ensure `saveSettings()` is called after changes
3. **Events firing multiple times** - Make sure to register events, not just add listeners
4. **Memory leaks** - Clean up intervals and events in `onunload()`
5. **Type errors** - Ensure TypeScript is properly configured
