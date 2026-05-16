import { ItemView, WorkspaceLeaf, Notice, TFile, moment } from "obsidian";
import OpencodePlugin from "../main";
import { OpencodeClient, OpencodeSession, OpencodeExport } from "../utils/opencode";

export const OPENCODE_CONVERSATION_VIEW_TYPE = "opencode-conversations";

export class OpencodeConversationView extends ItemView {
	client: OpencodeClient;
	sessions: OpencodeSession[] = [];
	listContainer: HTMLElement | null = null;
	detailContainer: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: OpencodePlugin) {
		super(leaf);
		const cwd = this.plugin.settings.defaultWorkingDirectory || this.plugin.vaultRoot;
		this.client = new OpencodeClient(plugin.settings.opencodePath, cwd);
	}

	getViewType() {
		return OPENCODE_CONVERSATION_VIEW_TYPE;
	}

	getDisplayText() {
		return "OpenCode Conversations";
	}

	getIcon(): string {
		return "message-circle";
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("opencode-conversation-container");

		const header = container.createEl("div", { cls: "opencode-conversation-header" });
		header.createEl("h3", { text: "OpenCode Sessions" });
		const refreshBtn = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Refresh sessions" } });
		refreshBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`;
		refreshBtn.addEventListener("click", () => this.loadSessions());

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

			item.addEventListener("click", async () => {
				// Highlight selected
				this.listContainer?.querySelectorAll(".opencode-session-item").forEach((el) => el.removeClass("is-active"));
				item.addClass("is-active");
				await this.showSessionDetail(session);
			});
		}
	}

	async showSessionDetail(session: OpencodeSession) {
		if (!this.detailContainer) return;
		this.detailContainer.empty();

		this.detailContainer.createEl("h4", { text: session.title || "Untitled" });

		const actions = this.detailContainer.createEl("div", { cls: "opencode-session-actions" });

		const restoreBtn = actions.createEl("button", { text: "Restore in Terminal", cls: "mod-cta" });
		restoreBtn.addEventListener("click", () => {
			this.plugin.openTerminalWithSession(session.id, session.directory);
		});

		const exportBtn = actions.createEl("button", { text: "Export to Note" });
		exportBtn.addEventListener("click", () => this.exportSessionToNote(session));

		const deleteBtn = actions.createEl("button", { text: "Delete", cls: "mod-warning" });
		deleteBtn.addEventListener("click", async () => {
			if (confirm(`Delete session "${session.title}"? This cannot be undone.`)) {
				const ok = await this.client.deleteSession(session.id);
				if (ok) {
					new Notice("Session deleted");
					await this.loadSessions();
					this.detailContainer?.empty();
				}
			}
		});

		this.detailContainer.createEl("div", { cls: "opencode-loading", text: "Loading conversation..." });

		const data = await this.client.exportSession(session.id);
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
					body.createEl("div", { cls: "opencode-message-tool", text: `[tool: ${(part as any).name || part.type}]` });
				}
			}
		}
	}

	async exportSessionToNote(session: OpencodeSession) {
		const data = await this.client.exportSession(session.id);
		if (!data) {
			new Notice("Failed to export session");
			return;
		}

		const fileName = `OpenCode/${session.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5\-_ ]/g, "_")}.md`;
		const folder = "OpenCode";

		// Ensure folder exists
		try {
			await this.app.vault.createFolder(folder);
		} catch (e) {
			// Folder may already exist
		}

		let content = `---\n`;
		content += `opencode-session: ${session.id}\n`;
		content += `opencode-model: ${data.info.model?.id || "unknown"}\n`;
		content += `opencode-agent: ${data.info.agent || "default"}\n`;
		content += `opencode-cost: ${data.info.cost || 0}\n`;
		content += `opencode-created: ${moment(data.info.time.created).format("YYYY-MM-DD HH:mm:ss")}\n`;
		content += `opencode-updated: ${moment(data.info.time.updated).format("YYYY-MM-DD HH:mm:ss")}\n`;
		content += `---\n\n`;
		content += `# ${session.title}\n\n`;

		for (const msg of data.messages) {
			const role = msg.info.role === "assistant" ? "Assistant" : "User";
			content += `## ${role}\n\n`;
			for (const part of msg.parts) {
				if (part.type === "text" && part.text) {
					content += `${part.text}\n\n`;
				} else if (part.type === "step-start") {
					content += `*(thinking...)*\n\n`;
				} else if (part.type === "tool-call") {
					content += `*(tool call)*\n\n`;
				}
			}
		}

		try {
			const existing = this.app.vault.getAbstractFileByPath(fileName);
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, content);
				new Notice(`Updated ${fileName}`);
			} else {
				const file = await this.app.vault.create(fileName, content);
				new Notice(`Created ${file.name}`);
			}
		} catch (e) {
			console.error(e);
			new Notice("Failed to create note");
		}
	}

	async onClose() {
		// cleanup if needed
	}
}
