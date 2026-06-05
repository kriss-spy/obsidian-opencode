import { Plugin, WorkspaceLeaf, Notice, TFile, FileSystemAdapter } from "obsidian";
import { OpencodePluginSettings, DEFAULT_SETTINGS } from "./settings";
import { OpencodeSettingTab } from "./settingsTab";
import { OpencodeTerminalView, OPENCODE_TERMINAL_VIEW_TYPE } from "./views/opencodeTerminalView";
import { OpencodeConversationView, OPENCODE_CONVERSATION_VIEW_TYPE } from "./views/conversationView";
import { OpencodeEditorSuggest } from "./opencodeEditorSuggest";
import { SessionState } from "./modules/sessionState";
import { ViewCoordinator } from "./modules/viewCoordinator";

export default class OpencodePlugin extends Plugin {
	settings: OpencodePluginSettings;
	vaultRoot: string = "";
	vaultConfigDir: string = "";
	private sessionState: SessionState;
	private viewCoordinator: ViewCoordinator;

	get pendingPrompt(): string | null {
		return this.sessionState.pendingPrompt;
	}

	set pendingPrompt(value: string | null) {
		this.sessionState.pendingPrompt = value;
	}

	get sessionArgs(): string[] | null {
		return this.sessionState.sessionArgs;
	}

	set sessionArgs(value: string[] | null) {
		this.sessionState.sessionArgs = value;
	}

	get sessionCwd(): string | null {
		return this.sessionState.sessionCwd;
	}

	set sessionCwd(value: string | null) {
		this.sessionState.sessionCwd = value;
	}

	async onload() {
		this.sessionState = new SessionState();
		this.viewCoordinator = new ViewCoordinator(this.app.workspace, {
			terminalViewType: OPENCODE_TERMINAL_VIEW_TYPE,
			conversationViewType: OPENCODE_CONVERSATION_VIEW_TYPE,
		});

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

		this.registerEditorSuggest(new OpencodeEditorSuggest(this));
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
		await this.viewCoordinator.activateTerminalView();
	}

	async activateConversationView() {
		await this.viewCoordinator.activateConversationView();
	}

	async toggleTerminalSidebar() {
		await this.viewCoordinator.toggleTerminalSidebar();
	}

	async newSession() {
		this.sessionState.setNewSession();
		await this.openOrRestartTerminal();
	}

	async continueLastSession() {
		this.sessionState.setContinueLastSession();
		await this.openOrRestartTerminal();
	}

	async openTerminalWithSession(sessionId: string, directory: string) {
		this.sessionState.setOpenSession(sessionId, directory);
		await this.openOrRestartTerminal();
	}

	private async openOrRestartTerminal() {
		await this.viewCoordinator.openOrRestartTerminal(() => {
			const leaf = this.app.workspace.getLeavesOfType(OPENCODE_TERMINAL_VIEW_TYPE)[0];
			if (leaf) {
				const view = leaf.view as any;
				if (view && typeof view.restartPty === "function") {
					view.restartPty();
				}
			}
		});
	}
}
