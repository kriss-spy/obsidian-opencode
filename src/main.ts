import { Plugin, WorkspaceLeaf, Notice, TFile, FileSystemAdapter } from "obsidian";
import { OpencodePluginSettings, DEFAULT_SETTINGS } from "./settings";
import { OpencodeSettingTab } from "./settingsTab";
import { OpencodeTerminalView, OPENCODE_TERMINAL_VIEW_TYPE } from "./views/opencodeTerminalView";
import { OpencodeConversationView, OPENCODE_CONVERSATION_VIEW_TYPE } from "./views/conversationView";

export default class OpencodePlugin extends Plugin {
	settings: OpencodePluginSettings;
	vaultRoot: string = "";
	vaultConfigDir: string = "";

	async onload() {
		await this.loadSettings();
		if (this.app.vault.adapter instanceof FileSystemAdapter) {
			this.vaultRoot = this.app.vault.adapter.getBasePath();
		} else {
			this.vaultRoot = "/";
		}
		this.vaultConfigDir = this.app.vault.configDir;

		this.registerView(
			OPENCODE_TERMINAL_VIEW_TYPE,
			(leaf) => new OpencodeTerminalView(leaf, this)
		);

		this.registerView(
			OPENCODE_CONVERSATION_VIEW_TYPE,
			(leaf) => new OpencodeConversationView(leaf, this)
		);

		this.addRibbonIcon("terminal", "OpenCode Terminal", (evt: MouseEvent) => {
			this.activateTerminalView();
		});

		this.addRibbonIcon("message-circle", "OpenCode Conversations", (evt: MouseEvent) => {
			this.activateConversationView();
		});

		this.addCommand({
			id: "open-opencode-terminal",
			name: "Open OpenCode Terminal",
			callback: () => this.activateTerminalView(),
		});

		this.addCommand({
			id: "toggle-opencode-terminal-sidebar",
			name: "Toggle OpenCode Terminal in Sidebar",
			callback: () => this.toggleTerminalSidebar(),
		});

		this.addCommand({
			id: "open-opencode-conversations",
			name: "Open OpenCode Conversations",
			callback: () => this.activateConversationView(),
		});

		this.addCommand({
			id: "new-opencode-session",
			name: "New OpenCode Session",
			callback: () => this.newSession(),
		});

		this.addCommand({
			id: "continue-last-opencode-session",
			name: "Continue Last OpenCode Session",
			callback: () => this.continueLastSession(),
		});

		this.addSettingTab(new OpencodeSettingTab(this.app, this));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(OPENCODE_TERMINAL_VIEW_TYPE);
		this.app.workspace.detachLeavesOfType(OPENCODE_CONVERSATION_VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateTerminalView() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(OPENCODE_TERMINAL_VIEW_TYPE)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: OPENCODE_TERMINAL_VIEW_TYPE, active: true });
			}
		}
		if (leaf) workspace.revealLeaf(leaf);
	}

	async activateConversationView() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(OPENCODE_CONVERSATION_VIEW_TYPE)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: OPENCODE_CONVERSATION_VIEW_TYPE, active: true });
			}
		}
		if (leaf) workspace.revealLeaf(leaf);
	}

	async toggleTerminalSidebar() {
		const { workspace } = this.app;
		const rightSplit = workspace.rightSplit;
		const isCollapsed = rightSplit?.collapsed ?? true;

		if (!isCollapsed) {
			// Right sidebar is visible — collapse it (leaf stays alive)
			rightSplit?.toggle();
		} else {
			// Right sidebar is collapsed — ensure leaf exists, then reveal
			let leaf = workspace.getLeavesOfType(OPENCODE_TERMINAL_VIEW_TYPE)[0];
			if (!leaf) {
				const newLeaf = workspace.getRightLeaf(false);
				if (newLeaf) {
					leaf = newLeaf;
					await leaf.setViewState({ type: OPENCODE_TERMINAL_VIEW_TYPE, active: true });
				}
			}
			if (leaf) workspace.revealLeaf(leaf);
		}
	}

	sessionArgs: string[] | null = null;
	sessionCwd: string | null = null;

	async newSession() {
		this.sessionArgs = [];
		this.sessionCwd = null;
		await this.openOrRestartTerminal();
	}

	async continueLastSession() {
		this.sessionArgs = ["-c"];
		this.sessionCwd = null;
		await this.openOrRestartTerminal();
	}

	async openTerminalWithSession(sessionId: string, directory: string) {
		this.sessionArgs = ["-s", sessionId];
		this.sessionCwd = directory;
		await this.openOrRestartTerminal();
	}

	private async openOrRestartTerminal() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(OPENCODE_TERMINAL_VIEW_TYPE)[0];
		if (leaf) {
			const view = leaf.view as any;
			if (view && typeof view.restartPty === "function") {
				view.restartPty();
			}
			workspace.revealLeaf(leaf);
		} else {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({ type: OPENCODE_TERMINAL_VIEW_TYPE, active: true });
				workspace.revealLeaf(rightLeaf);
			}
		}
	}
}
