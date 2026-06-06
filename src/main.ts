import { Plugin, FileSystemAdapter } from "obsidian";
import { OpencodePluginSettings, DEFAULT_SETTINGS, PanelMode } from "./settings";
import { OpencodeSettingTab } from "./settingsTab";
import { OpencodeTerminalView } from "./views/opencodeTerminalView";
import {
	OPENCODE_TERMINAL_VIEW_TYPE,
	OPENCODE_TERMINAL_BOTTOM_VIEW_TYPE,
} from "./views/viewTypes";
import { OpencodeConversationView, OPENCODE_CONVERSATION_VIEW_TYPE } from "./views/conversationView";
import { OpencodeEditorSuggest } from "./opencodeEditorSuggest";
import { SessionState } from "./modules/sessionState";
import { ViewCoordinator } from "./modules/viewCoordinator";
import { PanelMigrator } from "./modules/panelMigrator";

export default class OpencodePlugin extends Plugin {
	settings: OpencodePluginSettings;
	vaultRoot: string = "";
	vaultConfigDir: string = "";
	private sessionState: SessionState;
	private viewCoordinator: ViewCoordinator;
	private panelMigrator: PanelMigrator;

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
			bottomViewType: OPENCODE_TERMINAL_BOTTOM_VIEW_TYPE,
			conversationViewType: OPENCODE_CONVERSATION_VIEW_TYPE,
			getPanelMode: () => this.settings.panelMode,
		});
		this.panelMigrator = new PanelMigrator({
			sessionState: this.sessionState,
			viewCoordinator: this.viewCoordinator,
			terminalViewType: OPENCODE_TERMINAL_VIEW_TYPE,
			bottomViewType: OPENCODE_TERMINAL_BOTTOM_VIEW_TYPE,
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
			OPENCODE_TERMINAL_BOTTOM_VIEW_TYPE,
			(leaf) => new OpencodeTerminalView(leaf, this)
		);

		this.registerView(
			OPENCODE_CONVERSATION_VIEW_TYPE,
			(leaf) => new OpencodeConversationView(leaf, this)
		);

		this.addCommand({
			id: "open-terminal-sidebar",
			name: "Open terminal in sidebar",
			callback: () => this.activateTerminalInMode("sidebar"),
		});

		this.addCommand({
			id: "open-terminal-bottom",
			name: "Open terminal in bottom panel",
			callback: () => this.activateTerminalInMode("bottom"),
		});

		this.addCommand({
			id: "toggle-terminal-sidebar",
			name: "Toggle terminal in sidebar",
			callback: () => this.toggleTerminalSidebar(),
		});

		this.addCommand({
			id: "open-conversations",
			name: "Open conversations",
			callback: () => this.activateConversationView(),
		});

		this.addCommand({
			id: "new-session",
			name: "New session",
			callback: () => this.newSession(),
		});

		this.addCommand({
			id: "continue-last-session",
			name: "Continue last session",
			callback: () => this.continueLastSession(),
		});

		this.addSettingTab(new OpencodeSettingTab(this.app, this));

		this.registerEditorSuggest(new OpencodeEditorSuggest(this));
	}

	async loadSettings() {
		const data = (await this.loadData()) as Partial<OpencodePluginSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateTerminalView() {
		await this.viewCoordinator.activateTerminalView();
	}

	async activateTerminalInMode(mode: PanelMode) {
		await this.viewCoordinator.activateInMode(mode);
	}

	async handlePanelModeChange(newMode: PanelMode) {
		await this.panelMigrator.migrateTo(newMode);
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
		const active = this.viewCoordinator.getActiveTerminalLeaf();
		await this.viewCoordinator.openOrRestartTerminal(() => {
			if (active) {
				const view = active.view;
				if (view && 'restartPty' in view && typeof (view as unknown as Record<string, unknown>).restartPty === 'function') {
					(view as unknown as Record<string, () => void>).restartPty();
				}
			}
		});
	}
}
