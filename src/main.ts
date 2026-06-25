import { Plugin, FileSystemAdapter } from "obsidian";
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

		this.addRibbonIcon("terminal", "Opencode terminal", (evt: MouseEvent) => {
			void this.activateTerminalView();
		});

		this.addRibbonIcon("message-circle", "Opencode conversations", (evt: MouseEvent) => {
			void this.activateConversationView();
		});

		this.addCommand({
			id: "open-terminal",
			name: "Open terminal",
			callback: () => this.activateTerminalView(),
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

		this.addCommand({
			id: "restart-terminal",
			name: "Restart terminal (reset size)",
			callback: () => this.openOrRestartTerminal(),
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
				const view = leaf.view;
				if (view && 'restartPty' in view && typeof (view as unknown as Record<string, unknown>).restartPty === 'function') {
					(view as unknown as Record<string, () => void>).restartPty();
				}
			}
		});
	}
}
