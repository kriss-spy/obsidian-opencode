import { App, TFile, Notice, moment } from "obsidian";
import { OpencodeSession, OpencodeExport } from "../utils/opencode";

export class SessionExporter {
	constructor(private app: App) {}

	async exportToNote(session: OpencodeSession, data: OpencodeExport): Promise<void> {
		const fileName = `OpenCode/${session.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5\-_ ]/g, "_")}.md`;
		const folder = "OpenCode";

		try {
			await this.app.vault.createFolder(folder);
		} catch {
			// Folder may already exist
		}

		let content = this.buildMarkdown(session, data);

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

	private buildMarkdown(session: OpencodeSession, data: OpencodeExport): string {
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

		return content;
	}
}
