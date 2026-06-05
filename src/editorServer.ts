import { WebSocketServer, WebSocket } from "ws";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface EditorServerOptions {
	lockDir?: string;
}

export class EditorServer {
	private wss: WebSocketServer | null = null;
	private clients: Set<WebSocket> = new Set();
	private port: number = 0;
	private lockFilePath: string = "";
	private readonly lockDir: string;

	constructor(options: EditorServerOptions = {}) {
		this.lockDir = options.lockDir || path.join(os.homedir(), ".claude", "ide");
	}

	async start(vaultRoot: string): Promise<number> {
		return new Promise((resolve, reject) => {
			this.wss = new WebSocketServer({ port: 0 }, () => {
				const address = this.wss!.address();
				if (typeof address === "object" && address !== null) {
					this.port = address.port;
				} else {
					this.port = 0;
				}

				// Ensure lock directory exists
				if (!fs.existsSync(this.lockDir)) {
					fs.mkdirSync(this.lockDir, { recursive: true });
				}

				this.lockFilePath = path.join(this.lockDir, `${this.port}.lock`);
				const lockContent = {
					transport: "ws",
					workspaceFolders: [vaultRoot],
				};
				fs.writeFileSync(this.lockFilePath, JSON.stringify(lockContent, null, 2));

				resolve(this.port);
			});

			this.wss.on("error", (err: Error) => {
				reject(err);
			});

			this.wss.on("connection", (ws: WebSocket) => {
				this.clients.add(ws);
				ws.on("close", () => {
					this.clients.delete(ws);
				});
				ws.on("message", (rawData) => {
					this.handleMessage(ws, rawData.toString());
				});
			});
		});
	}

	private handleMessage(ws: WebSocket, rawData: string): void {
		try {
			const msg: { method?: string; id?: number | string } = JSON.parse(rawData) as { method?: string; id?: number | string };
			if (msg.method === "initialize" && msg.id !== undefined) {
				const response = {
					jsonrpc: "2.0",
					id: msg.id,
					result: {
						protocolVersion: "2025-11-25",
						serverInfo: {
							name: "obsidian-opencode",
							version: "1.1.1",
						},
					},
				};
				ws.send(JSON.stringify(response));
			}
		} catch {
			// Ignore malformed JSON
		}
	}

	async stop(): Promise<void> {
		return new Promise((resolve) => {
			if (this.lockFilePath && fs.existsSync(this.lockFilePath)) {
				fs.unlinkSync(this.lockFilePath);
			}
			this.lockFilePath = "";

			for (const client of this.clients) {
				client.terminate();
			}
			this.clients.clear();

			if (this.wss) {
				this.wss.close(() => {
					this.wss = null;
					resolve();
				});
			} else {
				resolve();
			}
		});
	}

	isRunning(): boolean {
		return this.wss !== null;
	}

	notifyAtMentioned(filePath: string, lineStart?: number, lineEnd?: number): void {
		const msg = {
			jsonrpc: "2.0",
			method: "at_mentioned",
			params: {
				filePath,
				lineStart: lineStart ?? 1,
				lineEnd: lineEnd ?? 1,
			},
		};
		const payload = JSON.stringify(msg);
		for (const client of this.clients) {
			if (client.readyState === 1) { // OPEN
				client.send(payload);
			}
		}
	}
}
