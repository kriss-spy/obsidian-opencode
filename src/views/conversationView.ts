import { ItemView, WorkspaceLeaf, Notice, moment as obsidianMoment, Modal, App, setIcon } from "obsidian";
import OpencodePlugin from "../main";
import { OpencodeClient, OpencodeSession, OpencodeExport, ExportTooLargeError } from "../utils/opencode";
import { SessionExporter } from "../modules/sessionExporter";

const moment: (input: number) => { format: (fmt: string) => string } = obsidianMoment;

export const OPENCODE_CONVERSATION_VIEW_TYPE = "opencode-conversations";

export class OpencodeConversationView extends ItemView {
	client: OpencodeClient;
	sessions: OpencodeSession[] = [];
	listContainer: HTMLElement | null = null;
	detailContainer: HTMLElement | null = null;
	private exporter: SessionExporter;

	constructor(leaf: WorkspaceLeaf, private plugin: OpencodePlugin) {
		super(leaf);
		const cwd = this.plugin.settings.defaultWorkingDirectory || this.plugin.vaultRoot;
		this.client = new OpencodeClient(plugin.settings.opencodePath, cwd);
		this.exporter = new SessionExporter(this.app);
	}

	getViewType() {
		return OPENCODE_CONVERSATION_VIEW_TYPE;
	}

	getDisplayText() {
		return "Opencode conversations";
	}

	getIcon(): string {
		return "message-circle";
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("opencode-conversation-container");

		const header = container.createEl("div", { cls: "opencode-conversation-header" });
		header.createEl("h3", { text: "Opencode sessions" });
		const headerActions = header.createEl("div", { cls: "opencode-conversation-header-actions" });
		const newSessionBtn = headerActions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "New session" } });
		setIcon(newSessionBtn, "plus");
		newSessionBtn.addEventListener("click", () => { void this.plugin.newSession(); });
		const refreshBtn = headerActions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Refresh sessions" } });
		const svg = refreshBtn.createSvg("svg", { attr: { xmlns: "http://www.w3.org/2000/svg", width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" } });
		svg.createSvg("path", { attr: { d: "M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" } });
		svg.createSvg("path", { attr: { d: "M3 3v5h5" } });
		svg.createSvg("path", { attr: { d: "M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" } });
		svg.createSvg("path", { attr: { d: "M16 16h5v5" } });
		refreshBtn.addEventListener("click", () => { void this.loadSessions(); });

		const main = container.createEl("div", { cls: "opencode-conversation-main" });
		this.listContainer = main.createEl("div", { cls: "opencode-session-list" });
		this.detailContainer = main.createEl("div", { cls: "opencode-session-detail" });

		await this.loadSessions();
	}

	async loadSessions() {
		if (!this.listContainer) return;
		this.listContainer.empty();
		this.listContainer.createEl("div", { cls: "opencode-loading", text: "Loading sessions..." });

		const cwd = this.plugin.settings.defaultWorkingDirectory || this.plugin.vaultRoot;
		this.client = new OpencodeClient(this.plugin.settings.opencodePath, cwd);
		this.sessions = await this.client.listSessions();

		this.listContainer.empty();

		if (this.sessions.length === 0) {
			this.listContainer.createEl("div", { cls: "opencode-empty", text: "No sessions found." });
			return;
		}

		// Sort by updated desc
		const sorted = [...this.sessions].sort((a, b) => b.updated - a.updated);

		for (const session of sorted) {
			const item = this.listContainer.createEl("div", { cls: "opencode-session-item" });
			item.createEl("div", { cls: "opencode-session-title", text: session.title || "Untitled" });
			const meta = item.createEl("div", { cls: "opencode-session-meta" });
			meta.createEl("span", { text: moment(session.updated).format("YYYY-MM-DD HH:mm") });
			meta.createEl("span", { cls: "opencode-session-dir", text: session.directory });

			item.addEventListener("click", () => {
				// Highlight selected
				this.listContainer?.querySelectorAll(".opencode-session-item").forEach((el) => el.removeClass("is-active"));
				item.addClass("is-active");
				void this.showSessionDetail(session);
			});
		}
	}

	async showSessionDetail(session: OpencodeSession) {
		if (!this.detailContainer) return;
		this.detailContainer.empty();

		this.detailContainer.createEl("h4", { text: session.title || "Untitled" });

		const actions = this.detailContainer.createEl("div", { cls: "opencode-session-actions" });

		const restoreBtn = actions.createEl("button", { text: "Restore in terminal", cls: "mod-cta" });
		restoreBtn.addEventListener("click", () => {
			void this.plugin.openTerminalWithSession(session.id, session.directory);
		});

		const exportBtn = actions.createEl("button", { text: "Export to note" });
		exportBtn.addEventListener("click", () => {
			void this.exportSessionToNote(session);
		});

		const deleteBtn = actions.createEl("button", { text: "Delete", cls: "mod-warning" });
		deleteBtn.addEventListener("click", () => {
			new ConfirmDeleteModal(this.app, session.title, async () => {
				const ok = await this.client.deleteSession(session.id);
				if (ok) {
					new Notice("Session deleted");
					void this.loadSessions();
					this.detailContainer?.empty();
				}
			}).open();
		});

		this.detailContainer.createEl("div", { cls: "opencode-loading", text: "Loading conversation..." });

		let data: OpencodeExport | null;
		try {
			data = await this.client.exportSession(session.id);
		} catch (error) {
			this.detailContainer.querySelector(".opencode-loading")?.remove();
			if (error instanceof ExportTooLargeError) {
				this.detailContainer.createEl("div", { cls: "opencode-warning", text: "Session too large to preview." });
			} else {
				this.detailContainer.createEl("div", { cls: "opencode-error", text: "Failed to load conversation." });
			}
			return;
		}
		this.detailContainer.querySelector(".opencode-loading")?.remove();

		if (!data) {
			this.detailContainer.createEl("div", { cls: "opencode-error", text: "Failed to load conversation." });
			return;
		}

		const info = this.detailContainer.createEl("div", { cls: "opencode-session-info" });
		info.createEl("div", { text: `Model: ${data.info.model?.id || "unknown"}` });
		info.createEl("div", { text: `Agent: ${data.info.agent || "default"}` });
		info.createEl("div", { text: `Tokens: ${data.info.tokens?.input || 0} in / ${data.info.tokens?.output || 0} out` });
		info.createEl("div", { text: `Cost: $${(data.info.cost || 0).toFixed(4)}` });

		const messages = this.detailContainer.createEl("div", { cls: "opencode-messages" });
		for (const msg of data.messages) {
			const msgEl = messages.createEl("div", { cls: `opencode-message opencode-message-${msg.info.role}` });
			const header = msgEl.createEl("div", { cls: "opencode-message-header" });
			header.createEl("span", { cls: "opencode-message-role", text: msg.info.role });
			header.createEl("span", { cls: "opencode-message-time", text: moment(msg.info.time.created).format("HH:mm:ss") });

			const body = msgEl.createEl("div", { cls: "opencode-message-body" });
			for (const part of msg.parts) {
				if (part.type === "text" && part.text) {
					const p = body.createEl("div", { cls: "opencode-message-text" });
					p.innerText = part.text;
				} else if (part.type === "step-start") {
					body.createEl("div", { cls: "opencode-message-step", text: "[thinking...]" });
				} else if (part.type === "tool-call") {
					body.createEl("div", { cls: "opencode-message-tool", text: `[tool: ${part.name || part.type}]` });
				}
			}
		}
	}

	async exportSessionToNote(session: OpencodeSession) {
		try {
			const data = await this.client.exportSession(session.id);
			if (!data) {
				new Notice("Failed to export session");
				return;
			}
			await this.exporter.exportToNote(session, data);
		} catch (error) {
			if (error instanceof ExportTooLargeError) {
				new Notice("Session too large to export to note.");
			} else {
				new Notice("Failed to export session.");
			}
		}
	}

	async onClose() {
		// cleanup if needed
	}
}

class ConfirmDeleteModal extends Modal {
	private title: string;
	private onConfirm: () => void | Promise<void>;

	constructor(app: App, title: string, onConfirm: () => void | Promise<void>) {
		super(app);
		this.title = title;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("p", {
			text: `Delete session "${this.title}"? This cannot be undone.`,
		});

		const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
		const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		const confirmBtn = buttonRow.createEl("button", { text: "Delete", cls: "mod-warning" });
		confirmBtn.addEventListener("click", () => {
			void this.onConfirm();
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
