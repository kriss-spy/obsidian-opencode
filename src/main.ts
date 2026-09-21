import { Plugin, FileSystemAdapter, Platform, setIcon, TFile } from "obsidian";
import * as path from "node:path";
import { OpencodePluginSettings, DEFAULT_SETTINGS } from "./settings";
import { OpencodeSettingTab } from "./settingsTab";
import { OpencodeTerminalView, OPENCODE_TERMINAL_VIEW_TYPE } from "./views/opencodeTerminalView";
import { OpencodeConversationView, OPENCODE_CONVERSATION_VIEW_TYPE } from "./views/conversationView";
import { OpencodeEditorSuggest } from "./opencodeEditorSuggest";
import { SessionState } from "./modules/sessionState";
import { ViewCoordinator } from "./modules/viewCoordinator";
import { PtySession } from "./modules/ptySession";
import { PtySessionRegistry } from "./modules/ptySessionRegistry";
import { OpencodeActivitySource, OpencodeStatus, OpencodeStatusTracker } from "./modules/opencodeStatus";
import { OpencodeClient } from "./utils/opencode";

export default class OpencodePlugin extends Plugin {
	settings: OpencodePluginSettings;
	vaultRoot: string = "";
	vaultConfigDir: string = "";
	private sessionState: SessionState;
	private viewCoordinator: ViewCoordinator;
	private readonly ptySessions = new PtySessionRegistry();
	private statusTracker: OpencodeStatusTracker | null = null;
	private statusSource: OpencodeActivitySource | null = null;
	private statusButton: HTMLButtonElement | null = null;
	private statusBadge: HTMLSpanElement | null = null;
	private statusRefreshPending = false;
	private unloading = false;

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
		this.setupStatusBar();

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
			callback: () => { void this.activateTerminalView(); },
		});

		this.addCommand({
			id: "toggle-terminal-sidebar",
			name: "Toggle terminal in sidebar",
			callback: () => { void this.toggleTerminalSidebar(); },
		});

		this.addCommand({
			id: "open-conversations",
			name: "Open conversations",
			callback: () => { void this.activateConversationView(); },
		});

		this.addCommand({
			id: "new-session",
			name: "New session",
			callback: () => { void this.newSession(); },
		});

		this.addCommand({
			id: "continue-last-session",
			name: "Continue last session",
			callback: () => { void this.continueLastSession(); },
		});

		this.addCommand({
			id: "close-terminal",
			name: "Close terminal",
			checkCallback: (checking) => {
				const hasTerminal = this.app.workspace.getLeavesOfType(OPENCODE_TERMINAL_VIEW_TYPE).length > 0;
				if (hasTerminal && !checking) void this.viewCoordinator.closeTerminal();
				return hasTerminal;
			},
		});

		this.addCommand({
			id: "restart-terminal",
			name: "Restart terminal (reset size)",
			callback: () => { void this.openOrRestartTerminal(); },
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
		for (const leaf of this.app.workspace.getLeavesOfType(OPENCODE_TERMINAL_VIEW_TYPE)) {
			if (leaf.view instanceof OpencodeTerminalView) {
				leaf.view.setShiftEnterNewline(this.settings.shiftEnterNewline);
			}
		}
	}

	openSettings(): void {
		const settings = (this.app as typeof this.app & {
			setting?: { open(): void; openTabById(id: string): void };
		}).setting;
		settings?.open();
		settings?.openTabById(this.manifest.id);
	}

	createPtySession(): PtySession {
		return this.ptySessions.register(new PtySession());
	}

	async closePtySession(session: PtySession): Promise<void> {
		await this.ptySessions.close(session);
	}

	onunload(): void {
		this.unloading = true;
		void this.ptySessions.closeAll().catch((error) => {
			console.error("Unable to stop every OpenCode PTY during plugin unload", error);
		});
	}

	private setupStatusBar(): void {
		if (!Platform.isDesktopApp) return;

		const item = this.addStatusBarItem();
		item.addClass("opencode-status-bar-item");
		this.statusButton = item.createEl("button", {
			cls: ["opencode-status", "clickable-icon", "is-idle"],
			attr: { type: "button" },
		});
		const icon = this.statusButton.createSpan({ cls: "opencode-status-icon", attr: { "aria-hidden": "true" } });
		setIcon(icon, "terminal");
		this.statusBadge = this.statusButton.createSpan({
			cls: "opencode-status-badge",
			attr: { "aria-hidden": "true" },
		});
		this.registerDomEvent(this.statusButton, "click", () => { void this.activateTerminalView(); });

		this.statusTracker = new OpencodeStatusTracker();
		this.updateStatusActiveFile(this.app.workspace.getActiveFile());
		this.registerEvent(this.app.workspace.on("file-open", (file) => this.updateStatusActiveFile(file)));

		void this.startStatusTracking();
	}

	private async startStatusTracking(): Promise<void> {
		const client = new OpencodeClient(
			this.settings.opencodePath || "opencode",
			this.vaultRoot,
			this.settings.environmentVariables,
		);
		try {
			const compatibility = await client.checkCompatibility();
			if (this.unloading || compatibility.generation === "stable") return;
			this.statusSource = new OpencodeActivitySource(client, this.vaultRoot);
			await this.refreshStatus();
			if (this.unloading) return;
			this.registerInterval(window.setInterval(() => { void this.refreshStatus(); }, 1_500));
		} catch (error) {
			console.debug("OpenCode status tracking is unavailable", error);
		}
	}

	private async refreshStatus(): Promise<void> {
		if (!this.statusSource || !this.statusTracker || this.statusRefreshPending) return;
		this.statusRefreshPending = true;
		try {
			this.statusTracker.updateSessions(await this.statusSource.read());
			this.renderStatus(this.statusTracker.status);
		} catch (error) {
			console.debug("Unable to refresh OpenCode status", error);
		} finally {
			this.statusRefreshPending = false;
		}
	}

	private updateStatusActiveFile(file: TFile | null): void {
		if (!this.statusTracker) return;
		this.statusTracker.updateActiveFile(file ? path.join(this.vaultRoot, file.path) : null);
		this.renderStatus(this.statusTracker.status);
	}

	private renderStatus(status: OpencodeStatus): void {
		if (!this.statusButton || !this.statusBadge) return;
		this.statusButton.removeClass("is-idle", "is-running", "is-touched");
		this.statusButton.addClass(`is-${status.kind}`);
		this.statusButton.setAttribute("aria-label", status.tooltip);
		this.statusButton.setAttribute("title", status.tooltip);
		this.statusBadge.setText(status.kind === "touched" ? "!" : "");
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
		await this.viewCoordinator.openOrRestartTerminal(async () => {
			const leaf = this.app.workspace.getLeavesOfType(OPENCODE_TERMINAL_VIEW_TYPE)[0];
			if (leaf?.view instanceof OpencodeTerminalView) {
				await leaf.view.restartPty();
			}
		});
	}
}
