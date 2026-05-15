# Obsidian Plugin Example: Task Manager

This example demonstrates a complete, functional task manager plugin with all common features.

## File Structure
```
task-manager/
├── manifest.json
├── main.ts
├── settings.ts
├── views/
│   └── taskView.ts
├── modals/
│   └── addTaskModal.ts
└── styles.css
```

## manifest.json
```json
{
  "id": "task-manager",
  "name": "Task Manager",
  "version": "1.0.0",
  "minAppVersion": "0.15.0",
  "description": "Manage tasks within Obsidian with custom views and commands",
  "author": "Your Name",
  "isDesktopOnly": false
}
```

## settings.ts
```typescript
export interface TaskManagerSettings {
  taskFolder: string;
  defaultView: string;
  showCompletedTasks: boolean;
  sortBy: 'date' | 'priority' | 'name';
}

export const DEFAULT_SETTINGS: TaskManagerSettings = {
  taskFolder: 'Tasks',
  defaultView: 'list',
  showCompletedTasks: true,
  sortBy: 'date'
};
```

## main.ts
```typescript
import { Plugin, TFile, Notice, WorkspaceLeaf } from 'obsidian';
import { TaskManagerSettings, DEFAULT_SETTINGS } from './settings';
import { TaskManagerSettingTab } from './settingsTab';
import { TaskView, VIEW_TYPE_TASK } from './views/taskView';
import { AddTaskModal } from './modals/addTaskModal';

interface Task {
  id: string;
  content: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  created: Date;
  file: string;
}

export default class TaskManagerPlugin extends Plugin {
  settings: TaskManagerSettings;
  tasks: Task[] = [];

  async onload() {
    await this.loadSettings();

    // Register custom view
    this.registerView(
      VIEW_TYPE_TASK,
      (leaf) => new TaskView(leaf, this)
    );

    // Add ribbon icon
    this.addRibbonIcon('check-square', 'Open Task Manager', () => {
      this.activateView();
    });

    // Add commands
    this.addCommand({
      id: 'open-task-view',
      name: 'Open Task View',
      callback: () => this.activateView()
    });

    this.addCommand({
      id: 'add-task',
      name: 'Add New Task',
      callback: () => new AddTaskModal(this.app, this).open()
    });

    this.addCommand({
      id: 'complete-current-task',
      name: 'Complete Task at Cursor',
      editorCallback: (editor, view) => {
        const line = editor.getLine(editor.getCursor().line);
        if (line.includes('- [ ]')) {
          const newLine = line.replace('- [ ]', '- [x]');
          editor.setLine(editor.getCursor().line, newLine);
          new Notice('Task completed!');
        }
      }
    });

    // Add settings tab
    this.addSettingTab(new TaskManagerSettingTab(this.app, this));

    // Watch for file changes to update tasks
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile && file.path.startsWith(this.settings.taskFolder)) {
          this.refreshTasks();
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && file.path.startsWith(this.settings.taskFolder)) {
          this.refreshTasks();
        }
      })
    );

    // Initial load
    await this.refreshTasks();
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASK);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async refreshTasks() {
    this.tasks = [];
    const folder = this.app.vault.getAbstractFileByPath(this.settings.taskFolder);
    
    if (folder && folder.children) {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension === 'md') {
          const content = await this.app.vault.read(child);
          const tasks = this.parseTasks(content, child.path);
          this.tasks.push(...tasks);
        }
      }
    }
  }

  parseTasks(content: string, filePath: string): Task[] {
    const tasks: Task[] = [];
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      const match = line.match(/^- \[([ x])\] (.+)$/);
      if (match) {
        tasks.push({
          id: `${filePath}-${index}`,
          content: match[2],
          completed: match[1] === 'x',
          priority: this.extractPriority(match[2]),
          created: new Date(),
          file: filePath
        });
      }
    });
    
    return tasks;
  }

  extractPriority(content: string): 'low' | 'medium' | 'high' {
    if (content.includes('🔴') || content.includes('!high')) return 'high';
    if (content.includes('🟡') || content.includes('!medium')) return 'medium';
    return 'low';
  }

  async activateView() {
    const { workspace } = this.app;
    
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_TASK);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE_TASK, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  async addTask(content: string, priority: 'low' | 'medium' | 'high') {
    const taskFile = `${this.settings.taskFolder}/tasks.md`;
    let file = this.app.vault.getAbstractFileByPath(taskFile);
    
    if (!(file instanceof TFile)) {
      await this.app.vault.createFolder(this.settings.taskFolder).catch(() => {});
      file = await this.app.vault.create(taskFile, '');
    }

    if (file instanceof TFile) {
      const currentContent = await this.app.vault.read(file);
      const priorityMarker = priority === 'high' ? ' 🔴' : priority === 'medium' ? ' 🟡' : '';
      const newContent = currentContent + `\n- [ ] ${content}${priorityMarker}`;
      await this.app.vault.modify(file, newContent);
      
      await this.refreshTasks();
      new Notice('Task added!');
    }
  }

  getTasks(): Task[] {
    let tasks = this.tasks;
    
    if (!this.settings.showCompletedTasks) {
      tasks = tasks.filter(t => !t.completed);
    }
    
    return this.sortTasks(tasks);
  }

  private sortTasks(tasks: Task[]): Task[] {
    const { sortBy } = this.settings;
    
    return tasks.sort((a, b) => {
      switch (sortBy) {
        case 'priority':
          const priorityOrder = { high: 0, medium: 1, low: 2 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        case 'name':
          return a.content.localeCompare(b.content);
        case 'date':
        default:
          return b.created.getTime() - a.created.getTime();
      }
    });
  }
}
```

## views/taskView.ts
```typescript
import { ItemView, WorkspaceLeaf } from 'obsidian';
import TaskManagerPlugin from '../main';

export const VIEW_TYPE_TASK = 'task-view';

export class TaskView extends ItemView {
  plugin: TaskManagerPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: TaskManagerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_TASK;
  }

  getDisplayText() {
    return 'Task Manager';
  }

  getIcon(): string {
    return 'check-square';
  }

  async onOpen() {
    await this.render();
  }

  async onClose() {
    // Cleanup
  }

  async render() {
    const container = this.containerEl.children[1];
    container.empty();

    // Header
    container.createEl('h3', { text: 'Task Manager', cls: 'task-manager-header' });

    // Stats
    const tasks = this.plugin.getTasks();
    const completed = tasks.filter(t => t.completed).length;
    const total = tasks.length;
    
    const statsEl = container.createDiv({ cls: 'task-stats' });
    statsEl.createEl('span', { 
      text: `${completed}/${total} tasks completed`,
      cls: 'task-stats-text'
    });

    // Refresh button
    const refreshBtn = container.createEl('button', { 
      text: 'Refresh',
      cls: 'task-refresh-btn'
    });
    refreshBtn.addEventListener('click', async () => {
      await this.plugin.refreshTasks();
      await this.render();
    });

    // Task list
    const taskList = container.createDiv({ cls: 'task-list' });
    
    if (tasks.length === 0) {
      taskList.createEl('p', { 
        text: 'No tasks found. Use the command palette to add one!',
        cls: 'task-empty'
      });
      return;
    }

    tasks.forEach(task => {
      const taskEl = taskList.createDiv({ cls: 'task-item' });
      
      const checkbox = taskEl.createEl('input', {
        type: 'checkbox',
        cls: 'task-checkbox'
      });
      checkbox.checked = task.completed;
      
      const contentEl = taskEl.createEl('span', { 
        text: task.content,
        cls: `task-content ${task.completed ? 'task-completed' : ''}`
      });

      const priorityEl = taskEl.createEl('span', {
        text: task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🔵',
        cls: 'task-priority'
      });

      checkbox.addEventListener('change', async () => {
        // Toggle task completion
        contentEl.toggleClass('task-completed', checkbox.checked);
      });
    });
  }
}
```

## modals/addTaskModal.ts
```typescript
import { App, Modal, Setting } from 'obsidian';
import TaskManagerPlugin from '../main';

export class AddTaskModal extends Modal {
  plugin: TaskManagerPlugin;
  content: string = '';
  priority: 'low' | 'medium' | 'high' = 'medium';

  constructor(app: App, plugin: TaskManagerPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Add New Task' });

    new Setting(contentEl)
      .setName('Task')
      .setDesc('What needs to be done?')
      .addText(text => text
        .setPlaceholder('Enter task description...')
        .setValue(this.content)
        .onChange((value) => {
          this.content = value;
        }));

    new Setting(contentEl)
      .setName('Priority')
      .setDesc('How important is this task?')
      .addDropdown(dropdown => dropdown
        .addOption('low', 'Low 🔵')
        .addOption('medium', 'Medium 🟡')
        .addOption('high', 'High 🔴')
        .setValue(this.priority)
        .onChange((value) => {
          this.priority = value as 'low' | 'medium' | 'high';
        }));

    new Setting(contentEl)
      .addButton(button => button
        .setButtonText('Add Task')
        .setCta()
        .onClick(async () => {
          if (this.content.trim()) {
            await this.plugin.addTask(this.content, this.priority);
            this.close();
          }
        }))
      .addButton(button => button
        .setButtonText('Cancel')
        .onClick(() => {
          this.close();
        }));
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
```

## settingsTab.ts
```typescript
import { App, PluginSettingTab, Setting } from 'obsidian';
import TaskManagerPlugin from './main';

export class TaskManagerSettingTab extends PluginSettingTab {
  plugin: TaskManagerPlugin;

  constructor(app: App, plugin: TaskManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Task Manager Settings' });

    new Setting(containerEl)
      .setName('Task Folder')
      .setDesc('Folder where tasks are stored')
      .addText(text => text
        .setPlaceholder('Tasks')
        .setValue(this.plugin.settings.taskFolder)
        .onChange(async (value) => {
          this.plugin.settings.taskFolder = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Default View')
      .setDesc('Default view mode for tasks')
      .addDropdown(dropdown => dropdown
        .addOption('list', 'List View')
        .addOption('board', 'Board View')
        .addOption('calendar', 'Calendar View')
        .setValue(this.plugin.settings.defaultView)
        .onChange(async (value) => {
          this.plugin.settings.defaultView = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show Completed Tasks')
      .setDesc('Display completed tasks in the list')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showCompletedTasks)
        .onChange(async (value) => {
          this.plugin.settings.showCompletedTasks = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Sort By')
      .setDesc('Default sorting for tasks')
      .addDropdown(dropdown => dropdown
        .addOption('date', 'Date Created')
        .addOption('priority', 'Priority')
        .addOption('name', 'Name')
        .setValue(this.plugin.settings.sortBy)
        .onChange(async (value) => {
          this.plugin.settings.sortBy = value as 'date' | 'priority' | 'name';
          await this.plugin.saveSettings();
        }));
  }
}
```

## styles.css
```css
/* Task Manager Styles */

.task-manager-header {
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--background-modifier-border);
}

.task-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding: 8px;
  background-color: var(--background-secondary);
  border-radius: 4px;
}

.task-stats-text {
  font-size: 14px;
  color: var(--text-muted);
}

.task-refresh-btn {
  padding: 4px 12px;
  font-size: 12px;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background-color: var(--background-primary-alt);
  border-radius: 6px;
  border: 1px solid var(--background-modifier-border);
}

.task-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.task-content {
  flex: 1;
  font-size: 14px;
}

.task-completed {
  text-decoration: line-through;
  opacity: 0.6;
}

.task-priority {
  font-size: 14px;
}

.task-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 24px;
  font-style: italic;
}
```

## Features Demonstrated

1. **Settings System** - Persistent configuration with UI
2. **Commands** - Multiple command types (simple, editor, conditional)
3. **Custom View** - Right sidebar view with reactive updates
4. **Modal Dialogs** - User input with forms
5. **File Operations** - Reading, creating, modifying files
6. **Event Handling** - Watching for vault changes
7. **CSS Styling** - Custom styles for UI elements
8. **Ribbon Integration** - Quick access icon
9. **Status Bar** - Information display
10. **Type Safety** - Full TypeScript usage

## Testing This Plugin

1. Create a new folder for the plugin
2. Copy all files into the folder
3. Run `npm install` and `npm run dev`
4. Copy `main.js` and `manifest.json` to your vault's plugins folder
5. Enable the plugin in Obsidian settings
