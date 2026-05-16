import { Notice } from "obsidian";
import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface OpencodeSession {
	id: string;
	title: string;
	updated: number;
	created: number;
	projectId: string;
	directory: string;
}

export interface OpencodeMessage {
	info: {
		role: string;
		id: string;
		sessionID: string;
		parentID?: string;
		agent?: string;
		model?: {
			id: string;
			providerID: string;
		};
		time: {
			created: number;
			completed?: number;
		};
	};
	parts: Array<{
		type: string;
		text?: string;
		id: string;
		sessionID: string;
		messageID: string;
	}>;
}

export interface OpencodeExport {
	info: {
		id: string;
		slug: string;
		projectID: string;
		directory: string;
		path: string;
		title: string;
		agent: string;
		model: {
			id: string;
			providerID: string;
		};
		version: string;
		summary: {
			additions: number;
			deletions: number;
			files: number;
		};
		cost: number;
		tokens: {
			input: number;
			output: number;
			reasoning: number;
		};
		time: {
			created: number;
			updated: number;
		};
	};
	messages: OpencodeMessage[];
}

export class OpencodeClient {
	constructor(private opencodePath: string, private cwd: string) {}

	private resolvePath(): string {
		return this.opencodePath || "opencode";
	}

	async listSessions(): Promise<OpencodeSession[]> {
		try {
			const { stdout } = await execFileAsync(this.resolvePath(), ["session", "list", "--format", "json"], { cwd: this.cwd });
			return JSON.parse(stdout) as OpencodeSession[];
		} catch (error) {
			console.error("Failed to list sessions:", error);
			new Notice("Failed to list OpenCode sessions. Check your OpenCode path in settings.");
			return [];
		}
	}

	async exportSession(sessionId: string): Promise<OpencodeExport | null> {
		try {
			const { stdout } = await execFileAsync(this.resolvePath(), ["export", sessionId], { cwd: this.cwd, maxBuffer: 100 * 1024 * 1024 });
			return JSON.parse(stdout) as OpencodeExport;
		} catch (error) {
			console.error("Failed to export session:", error);
			new Notice(`Failed to export session ${sessionId}`);
			return null;
		}
	}

	async deleteSession(sessionId: string): Promise<boolean> {
		try {
			await execFileAsync(this.resolvePath(), ["session", "delete", sessionId], { cwd: this.cwd });
			return true;
		} catch (error) {
			console.error("Failed to delete session:", error);
			return false;
		}

	}

	spawnTerminal(cwd: string, extraArgs: string[] = []): ReturnType<typeof spawn> {
		const args = extraArgs.length > 0 ? extraArgs : [];
		return spawn(this.resolvePath(), args, {
			cwd,
			env: process.env as NodeJS.ProcessEnv,
		});
	}
}
