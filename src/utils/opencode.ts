import { Notice } from "obsidian";
import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EnvironmentVariables, flatpakEnvironmentArgs, mergeEnvironmentVariables } from "./environment";

const COMMON_BIN_DIRS = [
	".opencode/bin",
	".local/bin",
	"bin",
] as const;

const FLATPAK_OVERRIDE_COMMAND = "flatpak override --user --talk-name=org.freedesktop.flatpak md.obsidian.Obsidian";

function augmentPath(originalPath?: string): string {
	const homeDir = os.homedir();
	const userDirs = COMMON_BIN_DIRS.map((sub) => path.join(homeDir, sub));
	const delimiter = process.platform === "win32" ? path.win32.delimiter : path.delimiter;
	return [...userDirs, ...(originalPath || "").split(delimiter)].filter(Boolean).join(delimiter);
}

function createChildEnv(configured: EnvironmentVariables): NodeJS.ProcessEnv {
	const env = mergeEnvironmentVariables(process.env, configured);
	const inheritedPath = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1];
	for (const key of Object.keys(env)) {
		if (key.toLowerCase() === "path") delete env[key];
	}
	env.PATH = augmentPath(inheritedPath);
	return env;
}

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

const SAFE_ID_RE = /^[a-zA-Z0-9._:-]+$/;

function safeUnlinkSync(filePath: string): void {
	try {
		fs.unlinkSync(filePath);
	} catch {
		// File may already be deleted; ignore
	}
}

function quoteShell(token: string): string {
	return `'${String(token).replace(/'/g, `'\\''`)}'`;
}

function looksLikeJson(text: string): boolean {
	const ch = text.trimStart().charCodeAt(0);
	return ch === 0x5b /* [ */ || ch === 0x7b /* { */;
}

interface ExecResult {
	stdout: string;
	stderr: string;
}

const WINDOWS_EXEC_HOST_JS = String.raw`
const { spawn } = require("child_process");
let [cwd, file, ...args] = process.argv.slice(1);
let options = { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true };
if (/\.(cmd|bat)$/i.test(file)) {
  const env = { ...process.env };
  const tokens = [file, ...args];
  const references = tokens.map((token, index) => {
    const name = "OPENCODE_PLUGIN_CMD_" + index;
    env[name] = token;
    return '"%' + name + '%"';
  });
  file = process.env.ComSpec || "cmd.exe";
  args = ["/d", "/s", "/c", '"' + references.join(" ") + '"'];
  options = { ...options, env, windowsVerbatimArguments: true };
}
const child = spawn(file, args, options);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on("error", (error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exitCode = 1;
});
child.on("close", (code) => { process.exitCode = code == null ? 1 : code; });
`;

function windowsCommandReferences(tokens: string[], env: NodeJS.ProcessEnv): { env: NodeJS.ProcessEnv; references: string[] } {
	const commandEnv = { ...env };
	const references = tokens.map((token, index) => {
		const name = `OPENCODE_PLUGIN_CMD_${index}`;
		commandEnv[name] = token;
		return `"%${name}%"`;
	});
	return { env: commandEnv, references };
}

function resolveWindowsExecutable(executable: string, env: NodeJS.ProcessEnv): string {
	if (path.win32.isAbsolute(executable)) return executable;
	const extensions = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
	const names = path.win32.extname(executable) ? [executable] : extensions.map((extension) => `${executable}${extension}`);
	for (const directory of (env.PATH || "").split(path.win32.delimiter)) {
		if (!directory) continue;
		for (const name of names) {
			const candidate = path.win32.join(directory, name);
			try {
				fs.accessSync(candidate, fs.constants.X_OK);
				return candidate;
			} catch {
				continue;
			}
		}
	}
	return executable;
}

function runExecFile(executable: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		let file = process.platform === "win32" ? resolveWindowsExecutable(executable, opts.env) : executable;
		let fileArgs = args;
		let execOptions: Parameters<typeof execFile>[2] = opts;
		if (process.platform === "win32") {
			const target = file;
			file = resolveWindowsExecutable("node.exe", opts.env);
			fileArgs = ["-e", WINDOWS_EXEC_HOST_JS, opts.cwd, target, ...args];
			execOptions = { ...opts, windowsHide: true };
		}

		execFile(file, fileArgs, execOptions, (err, stdout, stderr) => {
			if (err) {
				const message = err instanceof Error ? err.message : typeof err === "string" ? err : "exec failed";
				reject(new Error(message));
			} else {
				resolve({ stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" });
			}
		});
	});
}

export class ExportTooLargeError extends Error {
	constructor(sessionId: string) {
		super(`Session ${sessionId} is too large to export`);
		this.name = "ExportTooLargeError";
	}
}

export class OpencodeClient {
	constructor(
		private opencodePath: string,
		private cwd: string,
		private environmentVariables: EnvironmentVariables = {}
	) {}

	private resolvePath(): string {
		return this.opencodePath || "opencode";
	}

	async listSessions(): Promise<OpencodeSession[]> {
		const isFlatpak = fs.existsSync("/.flatpak-info") || !!process.env.FLATPAK_ID;
		const executable = this.resolvePath();
		const env = createChildEnv(this.environmentVariables);

		let raw = "";
		let stderrText = "";
		try {
			if (isFlatpak) {
				// flatpak-spawn's stdout forwarding can drop/truncate the captured
				// output (see issue #25: empty stdout -> JSON.parse("") crash).
				// Route through a host-side temp file, matching the export path.
				const tmpFile = path.join(os.tmpdir(), `opencode-sessions-${Date.now()}.json`);
				const shellCmd = `${quoteShell(executable)} session list --format json > ${quoteShell(tmpFile)} 2>/dev/null`;
				await runExecFile("flatpak-spawn", ["--host", ...flatpakEnvironmentArgs(this.environmentVariables), "sh", "-c", shellCmd], { cwd: this.cwd, env });
				try {
					raw = fs.readFileSync(tmpFile, "utf-8");
				} finally {
					safeUnlinkSync(tmpFile);
				}
			} else {
				const result = await runExecFile(executable, ["session", "list", "--format", "json"], { cwd: this.cwd, env });
				raw = result.stdout || "";
				stderrText = result.stderr || "";
				// Some setups route the JSON payload to stderr; fall back to it
				// only when it actually looks like JSON to avoid parsing log noise.
				if (!raw.trim() && looksLikeJson(stderrText)) {
					raw = stderrText;
					stderrText = "";
				}
			}

			const trimmed = raw.trim();
			if (!trimmed) {
				// No sessions or the CLI emitted nothing on stdout/stderr. Surface
				// any stderr so the user can diagnose (e.g. unsupported --format).
				if (stderrText.trim()) console.warn("opencode session list stderr:", stderrText.trim());
				return [];
			}
			return JSON.parse(trimmed) as OpencodeSession[];
		} catch (error) {
			console.error("Failed to list sessions:", error);
			if (stderrText.trim()) console.warn("opencode session list stderr:", stderrText.trim());
			const errStr = String(error);
			if (errStr.includes("org.freedesktop.DBus.Error.ServiceUnknown") || errStr.includes("flatpak-spawn")) {
				new Notice(`Additional sandbox permissions are required. Run '${FLATPAK_OVERRIDE_COMMAND}' on your host system.`, 15000);
			} else if (errStr.includes("Unexpected end of JSON input") || errStr.includes("JSON")) {
				new Notice("Opencode: session list returned no JSON. Check the dev console for details and ensure opencode is up to date.", 15000);
			} else {
				new Notice("Failed to list opencode sessions. Check your opencode path in settings.");
			}
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
			if (!SAFE_ID_RE.test(sessionId)) {
				reject(new Error(`Invalid session ID: ${sessionId}`));
				return;
			}

			const tmpFile = path.join(os.tmpdir(), `opencode-export-${sessionId}-${Date.now()}.json`);
			let cleanedUp = false;

			const cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				safeUnlinkSync(tmpFile);
			};

			const isFlatpak = fs.existsSync("/.flatpak-info") || process.env.FLATPAK_ID;
			let command = `${quoteShell(this.resolvePath())} export ${quoteShell(sessionId)} > ${quoteShell(tmpFile)} 2>/dev/null`;
			if (isFlatpak) {
				const environmentArgs = flatpakEnvironmentArgs(this.environmentVariables).map(quoteShell).join(" ");
				command = `flatpak-spawn --host${environmentArgs ? ` ${environmentArgs}` : ""} ${command}`;
			}

			const exportEnv = createChildEnv(this.environmentVariables);
			let child: import("child_process").ChildProcess;
			if (process.platform === "win32") {
				const windowsCommand = windowsCommandReferences([this.resolvePath(), sessionId, tmpFile], exportEnv);
				const [executableRef, sessionRef, tmpFileRef] = windowsCommand.references;
				const commandLine = `${executableRef} export ${sessionRef} > ${tmpFileRef} 2>NUL`;
				child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${commandLine}"`], {
					cwd: this.cwd,
					env: windowsCommand.env,
					windowsHide: true,
					windowsVerbatimArguments: true,
				});
			} else {
				child = spawn(command, [], {
					cwd: this.cwd,
					env: exportEnv,
					shell: true,
				});
			}

			child.on("error", (err) => {
				cleanup();
				reject(err);
			});

			child.on("close", (code) => {
				if (code !== 0) {
					cleanup();
					reject(new Error(`Export exited with code ${code}`));
					return;
				}
				try {
					const stats = fs.statSync(tmpFile);
					if (stats.size > maxBytes) {
						cleanup();
						reject(new ExportTooLargeError(sessionId));
						return;
					}
					const stdout = fs.readFileSync(tmpFile, "utf-8");
					cleanup();
					const data = JSON.parse(stdout) as OpencodeExport;
					resolve(data);
				} catch (parseError) {
					cleanup();
					reject(parseError instanceof Error ? parseError : new Error(String(parseError)));
				}
			});
		});
	}

	async deleteSession(sessionId: string): Promise<boolean> {
		if (!SAFE_ID_RE.test(sessionId)) {
			console.error("Refusing to delete invalid session ID:", sessionId);
			return false;
		}
		try {
			const isFlatpak = fs.existsSync("/.flatpak-info") || process.env.FLATPAK_ID;
			let executable = this.resolvePath();
			let args = ["session", "delete", sessionId];
			if (isFlatpak) {
				args = ["--host", ...flatpakEnvironmentArgs(this.environmentVariables), executable, ...args];
				executable = "flatpak-spawn";
			}
			const env = createChildEnv(this.environmentVariables);
			await runExecFile(executable, args, { cwd: this.cwd, env });
			return true;
		} catch (error) {
			console.error("Failed to delete session:", error);
			return false;
		}

	}

}
