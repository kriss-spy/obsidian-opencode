import { Notice } from "obsidian";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
		name?: string;
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

export class ExportTooLargeError extends Error {
	constructor(sessionId: string) {
		super(`Session ${sessionId} is too large to export`);
		this.name = "ExportTooLargeError";
	}
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
			return await this.exportSessionStreamed(sessionId);
		} catch (error) {
			if (error instanceof ExportTooLargeError) {
				console.warn("Session too large to preview:", sessionId);
				throw error;
			}
			console.error("Failed to export session:", error);
			new Notice(`Failed to export session ${sessionId}`);
			return null;
		}
	}

	private exportSessionStreamed(sessionId: string, maxBytes = 200 * 1024 * 1024): Promise<OpencodeExport> {
		return new Promise((resolve, reject) => {
			const tmpFile = path.join(os.tmpdir(), `opencode-export-${sessionId}-${Date.now()}.json`);

			const child = spawn(
				`${this.resolvePath()} export ${sessionId} > "${tmpFile}" 2>/dev/null`,
				[],
				{
					cwd: this.cwd,
					env: process.env,
					shell: true,
				}
			);

			child.on("error", (err) => {
				fs.unlinkSync(tmpFile);
				reject(err);
			});

			child.on("close", (code) => {
				if (code !== 0) {
					fs.unlinkSync(tmpFile);
					reject(new Error(`Export exited with code ${code}`));
					return;
				}
				try {
					const stats = fs.statSync(tmpFile);
					if (stats.size > maxBytes) {
						fs.unlinkSync(tmpFile);
						reject(new ExportTooLargeError(sessionId));
						return;
					}
					const stdout = fs.readFileSync(tmpFile, "utf-8");
					fs.unlinkSync(tmpFile);
					const data = JSON.parse(stdout) as OpencodeExport;
					resolve(data);
				} catch (parseError) {
					fs.unlinkSync(tmpFile);
					reject(parseError instanceof Error ? parseError : new Error(String(parseError)));
				}
			});
		});
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
			env: process.env,
		});
	}
}
