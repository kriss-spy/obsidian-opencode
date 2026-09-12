import { Notice } from "obsidian";
import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createChildEnvironment, EnvironmentVariables, flatpakEnvironmentArgs } from "./environment";
import { findExecutableOnPath, identifyOpenCodeCli, OpenCodeCliGeneration, resolveOpencodeExecutable } from "./opencodeExecutable";

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseSession(value: unknown): OpencodeSession {
	if (!isRecord(value) || typeof value.id !== "string" || typeof value.directory !== "string" || typeof value.updated !== "number") {
		throw new Error("Session entries require string id/directory fields and a numeric updated field");
	}
	if (value.title !== undefined && typeof value.title !== "string") throw new Error("Session title must be a string");
	if (value.created !== undefined && typeof value.created !== "number") throw new Error("Session created must be a number");
	const projectId = value.projectId ?? value.projectID ?? "";
	if (typeof projectId !== "string") throw new Error("Session projectId must be a string");
	return {
		id: value.id,
		title: value.title ?? "",
		updated: value.updated,
		created: value.created ?? value.updated,
		projectId,
		directory: value.directory,
	};
}

function parseV2Session(value: unknown): OpencodeSession {
	if (!isRecord(value) || !isRecord(value.location) || !isRecord(value.time)) {
		throw new Error("OpenCode v2 session entries require location and time fields");
	}
	return parseSession({
		id: value.id,
		title: value.title,
		projectID: value.projectID,
		directory: value.location.directory,
		created: value.time.created,
		updated: value.time.updated,
	});
}

function parseStableSessionList(raw: string): OpencodeSession[] {
	const payload: unknown = JSON.parse(raw);
	if (!Array.isArray(payload)) throw new Error("Expected a JSON array");
	return payload.map(parseSession);
}

function parseV2SessionPage(raw: string): { sessions: OpencodeSession[]; nextCursor?: string } {
	const payload: unknown = JSON.parse(raw);
	if (!isRecord(payload) || !Array.isArray(payload.data)) {
		throw new Error("Expected an OpenCode v2 API response with a data array");
	}
	if (payload.cursor !== undefined && !isRecord(payload.cursor)) {
		throw new Error("Expected OpenCode v2 cursor metadata to be an object");
	}
	const rawNextCursor = isRecord(payload.cursor) ? payload.cursor.next : undefined;
	if (rawNextCursor !== undefined && rawNextCursor !== null && typeof rawNextCursor !== "string") {
		throw new Error("Expected the OpenCode v2 next cursor to be a string");
	}
	const nextCursor = typeof rawNextCursor === "string" ? rawNextCursor : undefined;
	const sessions = payload.data.flatMap((value) => {
		const session = parseV2Session(value);
		const parentID = (value as Record<string, unknown>).parentID;
		if (parentID !== undefined && parentID !== null && typeof parentID !== "string") {
			throw new Error("OpenCode v2 session parentID must be a string");
		}
		return parentID === undefined || parentID === null ? [session] : [];
	});
	return { sessions, nextCursor };
}

interface ExecResult {
	stdout: string;
	stderr: string;
}

const WINDOWS_EXEC_HOST_JS = String.raw`
const { spawn } = require("child_process");
let [cwd, file, ...args] = process.argv.slice(1);
let options = { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true };
if (/\.ps1$/i.test(file)) {
  args = ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args];
  file = "powershell.exe";
} else if (/\.(cmd|bat)$/i.test(file)) {
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

function runExecFile(executable: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		let file = process.platform === "win32"
			? findExecutableOnPath(executable, { platform: "win32", environment: opts.env }) ?? executable
			: executable;
		let fileArgs = args;
		let execOptions: Parameters<typeof execFile>[2] = opts;
		if (process.platform === "win32") {
			const target = file;
			file = findExecutableOnPath("node.exe", { platform: "win32", environment: opts.env }) ?? "node.exe";
			fileArgs = ["-e", WINDOWS_EXEC_HOST_JS, opts.cwd, target, ...args];
			execOptions = { ...opts, windowsHide: true };
		}

		execFile(file, fileArgs, execOptions, (err, stdout, stderr) => {
			if (err) {
				const failure = err instanceof Error
					? err
					: new Error(typeof err === "string" ? err : "exec failed");
				if (stderr) (failure as Error & { stderr?: string }).stderr = stderr.toString();
				reject(failure);
			} else {
				resolve({ stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" });
			}
		});
	});
}

export class OpencodeError extends Error {
	readonly cause: unknown;

	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = new.target.name;
		this.cause = cause;
	}
}

export class CliNotFoundError extends OpencodeError {
	constructor(executable: string, cause?: unknown) {
		super(`OpenCode executable was not found: ${executable}`, cause);
	}
}

export class CliPermissionError extends OpencodeError {
	constructor(executable: string, cause?: unknown) {
		super(`OpenCode executable could not be run due to a permission error: ${executable}`, cause);
	}
}

export class UnsupportedCliError extends OpencodeError {
	constructor(cause?: unknown) {
		super("This OpenCode CLI does not support session listing.", cause);
	}
}

export class IncompatibleCliError extends OpencodeError {
	constructor(readonly detectedCli: string, cause?: unknown) {
		super(`The configured executable is ${detectedCli}. This plugin requires OpenCode.`, cause);
	}
}

export class CliCommandError extends OpencodeError {
	constructor(message: string, cause?: unknown) {
		super(message, cause);
	}
}

export class MalformedCliOutputError extends OpencodeError {
	constructor(cause?: unknown) {
		super("OpenCode returned malformed session data.", cause);
	}
}

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

function errorDetails(error: unknown): string {
	if (typeof error !== "object" || error === null) return String(error);
	const stderr = "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
	const message = error instanceof Error ? error.message : String(error);
	return `${message}\n${stderr}`.trim();
}

type OpenCodeOperation = "session-list" | "compatibility-check";

const OPERATION_LABELS: Record<OpenCodeOperation, string> = {
	"session-list": "session listing",
	"compatibility-check": "compatibility check",
};

function classifyOperationError(error: unknown, executable: string, operation: OpenCodeOperation): OpencodeError {
	const code = errorCode(error);
	const details = errorDetails(error);
	if (code === "ENOENT" || /\bENOENT\b|(?:command |executable )?not found/i.test(details)) {
		return new CliNotFoundError(executable, error);
	}
	if (code === "EACCES" || code === "EPERM" || /\bEACCES\b|\bEPERM\b|permission denied/i.test(details) || details.includes("org.freedesktop.DBus.Error.ServiceUnknown")) {
		return new CliPermissionError(executable, error);
	}
	if (/unrecognized flag|unknown (?:option|command)|no such command/i.test(details)) {
		return operation === "session-list"
			? new UnsupportedCliError(error)
			: new IncompatibleCliError("an unsupported CLI", error);
	}
	return new CliCommandError(`OpenCode ${OPERATION_LABELS[operation]} failed: ${details || "unknown command error"}`, error);
}

interface SessionCommandContext {
	executable: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
	isFlatpak: boolean;
	environmentVariables: EnvironmentVariables;
}

type SessionCommandRunner = (args: string[]) => Promise<string>;

async function runSessionCommand(context: SessionCommandContext, args: string[]): Promise<string> {
	let raw = "";
	let stderrText = "";
	try {
		if (context.isFlatpak) {
			// flatpak-spawn's stdout forwarding can drop/truncate the captured
			// output (see issue #25: empty stdout -> JSON.parse("") crash).
			// Route through a host-side temp file, matching the export path.
			const tmpFile = path.join(os.tmpdir(), `opencode-sessions-${Date.now()}.json`);
			const shellCmd = `${[context.executable, ...args].map(quoteShell).join(" ")} > ${quoteShell(tmpFile)}`;
			const result = await runExecFile("flatpak-spawn", [
				"--host",
				...flatpakEnvironmentArgs(context.environmentVariables),
				"sh",
				"-c",
				shellCmd,
			], { cwd: context.cwd, env: context.env });
			stderrText = result.stderr;
			try {
				raw = fs.readFileSync(tmpFile, "utf-8");
			} finally {
				safeUnlinkSync(tmpFile);
			}
		} else {
			const result = await runExecFile(context.executable, args, { cwd: context.cwd, env: context.env });
			raw = result.stdout || "";
			stderrText = result.stderr || "";
			// Some setups route the JSON payload to stderr; fall back to it
			// only when it actually looks like JSON to avoid parsing log noise.
			if (!raw.trim() && looksLikeJson(stderrText)) {
				raw = stderrText;
				stderrText = "";
			}
		}
	} catch (error) {
		console.error("Failed to list sessions:", error);
		throw classifyOperationError(error, context.executable, "session-list");
	}

	const trimmed = raw.trim();
	if (trimmed) return trimmed;
	if (stderrText.trim()) {
		throw classifyOperationError(new Error(stderrText.trim()), context.executable, "session-list");
	}
	throw new MalformedCliOutputError(new Error("OpenCode returned no JSON output"));
}

async function listStableSessions(run: SessionCommandRunner): Promise<OpencodeSession[]> {
	return parseStableSessionList(await run(["session", "list", "--format", "json"]));
}

async function listV2Sessions(run: SessionCommandRunner, directory: string): Promise<OpencodeSession[]> {
	const sessions: OpencodeSession[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | undefined;
	do {
		const query = `/api/session?directory=${encodeURIComponent(directory)}&roots=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
		const page = parseV2SessionPage(await run(["api", "get", query]));
		sessions.push(...page.sessions);
		cursor = page.nextCursor;
		if (cursor && seenCursors.has(cursor)) {
			throw new Error("OpenCode v2 returned a repeated session cursor");
		}
		if (cursor) seenCursors.add(cursor);
	} while (cursor);
	return sessions;
}

export interface OpenCodeCompatibility {
	generation: OpenCodeCliGeneration;
	executable: string;
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

	private resolvePath(environment: NodeJS.ProcessEnv = process.env): string {
		return resolveOpencodeExecutable(this.opencodePath, { environment });
	}

	async checkCompatibility(): Promise<OpenCodeCompatibility> {
		const isFlatpak = fs.existsSync("/.flatpak-info") || !!process.env.FLATPAK_ID;
		const env = createChildEnvironment(process.env, isFlatpak ? {} : this.environmentVariables);
		const executable = this.resolvePath(env);
		let command = executable;
		let args = ["--help"];
		if (isFlatpak) {
			command = "flatpak-spawn";
			args = ["--host", ...flatpakEnvironmentArgs(this.environmentVariables), executable, ...args];
		}

		let result: ExecResult;
		try {
			result = await runExecFile(command, args, { cwd: this.cwd, env });
		} catch (error) {
			throw classifyOperationError(error, executable, "compatibility-check");
		}
		const output = `${result.stdout}\n${result.stderr}`;
		const generation = identifyOpenCodeCli(output);
		if (generation) return { generation, executable };
		const detectedCli = /\bCodex CLI\b/i.test(output) ? "Codex CLI" : "an unsupported CLI";
		throw new IncompatibleCliError(detectedCli);
	}

	async listSessions(generation: OpenCodeCliGeneration = "stable"): Promise<OpencodeSession[]> {
		const isFlatpak = fs.existsSync("/.flatpak-info") || !!process.env.FLATPAK_ID;
		const env = createChildEnvironment(process.env, isFlatpak ? {} : this.environmentVariables);
		const executable = this.resolvePath(env);
		const run = (args: string[]) => runSessionCommand({
			executable,
			cwd: this.cwd,
			env,
			isFlatpak,
			environmentVariables: this.environmentVariables,
		}, args);

		try {
			return generation === "stable"
				? await listStableSessions(run)
				: await listV2Sessions(run, this.cwd);
		} catch (error) {
			if (error instanceof OpencodeError) throw error;
			throw new MalformedCliOutputError(error);
		}
	}

	async exportSession(
		sessionId: string,
		generation: OpenCodeCliGeneration = "stable"
	): Promise<OpencodeExport | null> {
		try {
			return await this.exportSessionStreamed(sessionId, generation);
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

	private exportSessionStreamed(
		sessionId: string,
		generation: OpenCodeCliGeneration,
		maxBytes = 200 * 1024 * 1024
	): Promise<OpencodeExport> {
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
			const exportEnv = createChildEnvironment(process.env, isFlatpak ? {} : this.environmentVariables);
			const exportArgs = generation === "v2"
				? ["session", "export", sessionId]
				: ["export", sessionId];
			let command = [this.resolvePath(exportEnv), ...exportArgs].map(quoteShell).join(" ")
				+ ` > ${quoteShell(tmpFile)} 2>/dev/null`;
			if (isFlatpak) {
				const environmentArgs = flatpakEnvironmentArgs(this.environmentVariables).map(quoteShell).join(" ");
				command = `flatpak-spawn --host${environmentArgs ? ` ${environmentArgs}` : ""} ${command}`;
			}

			let child: import("child_process").ChildProcess;
			if (process.platform === "win32") {
				const configuredExecutable = this.resolvePath(exportEnv);
				const commandTokens = /\.ps1$/i.test(configuredExecutable)
					? ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", configuredExecutable, ...exportArgs]
					: [configuredExecutable, ...exportArgs];
				const windowsCommand = windowsCommandReferences([...commandTokens, tmpFile], exportEnv);
				const tmpFileRef = windowsCommand.references.at(-1)!;
				const commandLine = `${windowsCommand.references.slice(0, -1).join(" ")} > ${tmpFileRef} 2>NUL`;
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
			const env = createChildEnvironment(process.env, isFlatpak ? {} : this.environmentVariables);
			let executable = this.resolvePath(env);
			let args = ["session", "delete", sessionId];
			if (isFlatpak) {
				args = ["--host", ...flatpakEnvironmentArgs(this.environmentVariables), executable, ...args];
				executable = "flatpak-spawn";
			}
			await runExecFile(executable, args, { cwd: this.cwd, env });
			return true;
		} catch (error) {
			console.error("Failed to delete session:", error);
			return false;
		}

	}

}
