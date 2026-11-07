import { WebSocket, WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as scheduleTimeout, clearTimeout as cancelTimeout } from "node:timers";
import { parseJsonc } from "./openCodeKeymap";
import { SessionLink, validateSessionLink } from "./sessionLinks";

// Runs inside OpenCode, with its own runtime-provided plugin SDK. Query the
// route on demand; session activity or launch arguments cannot identify a tab.
export const CURRENT_SESSION_PLUGIN = `import { Plugin } from "@opencode/plugin/tui";
export default Plugin.define({
  id: "obsidian.session-link",
  setup(context) {
    const socket = new WebSocket(context.options.url);
    socket.onmessage = (event) => {
      const request = JSON.parse(event.data);
      const route = context.ui.router.current();
      const session = route.type === "session" ? context.data.session.get(route.sessionID) : undefined;
      socket.send(JSON.stringify({ id: request.id, session: session ? {
        id: session.id, directory: session.location.directory
      } : null }));
    };
    socket.onerror = () => {};
    return () => socket.close();
  }
});
`;

export class CurrentSessionBridge {
	private server: WebSocketServer | null = null;
	private socket: WebSocket | null = null;
	private directory: string | null = null;
	private counter = 0;
	private pending = new Map<number, (session: SessionLink | null) => void>();

	constructor(private readonly tempRoot = tmpdir()) {}

	async start(environment: NodeJS.ProcessEnv): Promise<string> {
		const token = randomBytes(24).toString("hex");
		const server = new WebSocketServer({ host: "127.0.0.1", port: 0, path: `/${token}`, maxPayload: 16_384 });
		this.server = server;
		server.on("connection", (socket) => {
			this.socket?.terminate();
			this.socket = socket;
			socket.on("error", () => {});
			socket.on("close", () => {
				if (this.socket === socket) {
					this.socket = null;
					this.clearPending();
				}
			});
			socket.on("message", (raw) => {
				if (this.socket !== socket) return;
				try {
					const text = Array.isArray(raw) ? Buffer.concat(raw).toString("utf8")
						: raw instanceof ArrayBuffer ? new TextDecoder().decode(raw) : raw.toString("utf8");
					const message = JSON.parse(text) as { id: number; session: SessionLink | null };
					const session = message.session === null ? null : validateSessionLink(message.session);
					this.pending.get(message.id)?.(session);
				} catch { /* Reject malformed responses by timing out. */ }
			});
		});
		await new Promise<void>((resolve, reject) => {
			server.once("listening", resolve);
			server.once("error", reject);
		});
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Session bridge did not start");
		this.directory = mkdtempSync(join(this.tempRoot, "obsidian-opencode-session-"));
		writeFileSync(join(this.directory, "tui.js"), CURRENT_SESSION_PLUGIN, { mode: 0o600 });
		const inline = parseJsonc(environment.OPENCODE_CLI_CONFIG_CONTENT || "{}") as Record<string, unknown>;
		let global: Record<string, unknown> = {};
		const configHome = environment.XDG_CONFIG_HOME || join(homedir(), ".config");
		for (const filename of ["cli.jsonc", "cli.json"]) {
			try { global = parseJsonc(readFileSync(join(configHome, "opencode", filename), "utf8")) as Record<string, unknown>; }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
		}
		const plugins = inline.plugins ?? global.plugins ?? [];
		if (!Array.isArray(plugins)) throw new Error("OpenCode CLI plugins must be an array");
		const entries: unknown[] = plugins;
		const configured = inline.plugins ? entries : entries.map((entry: unknown) => {
			const resolve = (spec: string) => /^\.\.?[/\\]/.test(spec)
				? pathToFileURL(join(configHome, "opencode", spec)).href : spec;
			if (typeof entry === "string") return resolve(entry);
			if (entry && typeof entry === "object" && "package" in entry) {
				const plugin = entry as { package: string };
				return { ...plugin, package: resolve(plugin.package) };
			}
			return entry;
		});
		return JSON.stringify({ ...inline, plugins: [...configured, {
			package: pathToFileURL(this.directory).href,
			options: { url: `ws://127.0.0.1:${address.port}/${token}` },
		}] });
	}

	read(): Promise<SessionLink | null> {
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.resolve(null);
		const id = ++this.counter;
		return new Promise((resolve) => {
			const timer = scheduleTimeout(() => finish(null), 2_000);
			const finish = (session: SessionLink | null) => {
				cancelTimeout(timer);
				this.pending.delete(id);
				resolve(session);
			};
			this.pending.set(id, finish);
			socket.send(JSON.stringify({ id }), (error) => { if (error) finish(null); });
		});
	}

	private clearPending(): void {
		for (const finish of this.pending.values()) finish(null);
	}

	async stop(): Promise<void> {
		this.clearPending();
		this.socket = null;
		const server = this.server;
		this.server = null;
		if (server) {
			for (const client of server.clients) client.terminate();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
		if (this.directory) rmSync(this.directory, { recursive: true, force: true });
		this.directory = null;
	}
}
