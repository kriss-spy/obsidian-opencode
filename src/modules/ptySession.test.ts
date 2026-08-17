import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, ChildProcess, execFileSync } from "child_process";
import { writeFileSync } from "fs";
import { EventEmitter } from "events";
import type { Terminal } from "@xterm/xterm";
import { PtySession } from "./ptySession";

/* eslint-disable obsidianmd/prefer-window-timers -- This Node-only window mock must use Vitest's dynamically patched timers. */

vi.mock("obsidian", () => ({
	Notice: class {},
}));

vi.mock("child_process", () => ({
	spawn: vi.fn(),
	execFileSync: vi.fn().mockReturnValue("x64\n"),
}));

vi.mock("fs", () => ({
	accessSync: vi.fn(),
	existsSync: vi.fn().mockReturnValue(false),
	mkdtempSync: vi.fn().mockReturnValue("C:\\temp\\obsidian-opencode-test"),
	writeFileSync: vi.fn(),
	constants: { X_OK: 1 },
}));

interface MockProcess extends EventEmitter {
	pid?: number;
	stdin: { write: ReturnType<typeof vi.fn> };
	stdout: EventEmitter;
	stderr: EventEmitter;
	stdio: Array<EventEmitter | { write: ReturnType<typeof vi.fn> }>;
	kill: ReturnType<typeof vi.fn>;
}

function createProcess(): MockProcess {
	const process = new EventEmitter() as MockProcess;
	process.stdin = { write: vi.fn() };
	process.stdout = new EventEmitter();
	process.stderr = new EventEmitter();
	process.stdio = [process.stdin, process.stdout, process.stderr, { write: vi.fn() }, { write: vi.fn() }];
	process.kill = vi.fn();
	return process;
}

describe("PtySession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("window", {
			setTimeout: (callback: () => void, delay?: number) => setTimeout(callback, delay),
			clearTimeout: (timeout: ReturnType<typeof setTimeout>) => clearTimeout(timeout),
		});
	});

	afterEach(() => vi.unstubAllGlobals());

	it("keeps the replacement PTY active when the killed PTY exits", () => {
		const platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
		const oldProcess = createProcess();
		const replacementProcess = createProcess();
		vi.mocked(spawn)
			.mockReturnValueOnce(oldProcess as unknown as ChildProcess)
			.mockReturnValueOnce(replacementProcess as unknown as ChildProcess);

		const session = new PtySession();
		const terminal = {
			rows: 24,
			cols: 80,
			write: vi.fn(),
			writeln: vi.fn(),
		};
		const options = { opencodePath: "opencode", cwd: "/tmp", args: [] };

		try {
			session.spawn(terminal as unknown as Terminal, options);
			void session.kill();
			session.spawn(terminal as unknown as Terminal, options);
			oldProcess.emit("exit", 0, null);
			oldProcess.emit("close", 0, null);
			session.writeStdin("hello");

			expect(replacementProcess.stdin.write).toHaveBeenCalledWith("hello");
			expect(terminal.writeln).not.toHaveBeenCalled();
		} finally {
			platform.mockRestore();
		}
	});

	it("waits for Unix PTY output to close before completing shutdown", async () => {
		const platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
		const child = createProcess();
		child.pid = 1234;
		vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
		const terminal = { rows: 24, cols: 80, write: vi.fn(), writeln: vi.fn() };

		try {
			const session = new PtySession();
			session.spawn(terminal as unknown as Terminal, { opencodePath: "opencode", cwd: "/tmp", args: [] });
			let stopped = false;
			const stopping = session.kill().then(() => { stopped = true; });
			await Promise.resolve();
			expect(stopped).toBe(false);
			child.emit("exit", 0, null);
			await Promise.resolve();
			expect(stopped).toBe(false);
			child.emit("close", 0, null);
			await stopping;
			expect(stopped).toBe(true);
		} finally {
			platform.mockRestore();
		}
	});

	it("passes the private editor server port to OpenCode", () => {
		const platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
		const child = createProcess();
		vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);

		const session = new PtySession();
		const terminal = {
			rows: 24,
			cols: 80,
			write: vi.fn(),
			writeln: vi.fn(),
		};

		try {
			session.spawn(terminal as unknown as Terminal, {
				opencodePath: "opencode",
				cwd: "/tmp",
				args: [],
				editorPort: 43210,
			});

			expect(vi.mocked(spawn).mock.calls[0][2]?.env).toMatchObject({
				OPENCODE_EDITOR_SSE_PORT: "43210",
			});
		} finally {
			platform.mockRestore();
		}
	});

	it("merges configured environment variables into the inherited environment", () => {
		const platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
		const child = createProcess();
		vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
		const terminal = { rows: 24, cols: 80, write: vi.fn(), writeln: vi.fn() };

		try {
			new PtySession().spawn(terminal as unknown as Terminal, {
				opencodePath: "opencode",
				cwd: "/tmp",
				args: [],
				editorPort: 43210,
				environmentVariables: {
					OPENCODE_CONFIG_DIR: "/tmp/vault",
					EMPTY: "",
					PATH: "/configured/bin",
					TERM: "configured-term",
					OPENCODE_EDITOR_SSE_PORT: "configured-port",
				},
			});

			expect(vi.mocked(spawn).mock.calls[0][2]?.env).toMatchObject({
				OPENCODE_CONFIG_DIR: "/tmp/vault",
				EMPTY: "",
				PATH: "/configured/bin",
				TERM: "xterm-256color",
				OPENCODE_EDITOR_SSE_PORT: "43210",
			});
			expect(vi.mocked(spawn).mock.calls[0][0]).not.toBe("python3");
			expect(vi.mocked(spawn).mock.calls[0][2]?.env?.HOME).toBe(process.env.HOME);
		} finally {
			platform.mockRestore();
		}
	});

	it("reports Windows native PTY setup failures in the terminal", () => {
		const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		vi.mocked(execFileSync).mockReturnValueOnce("arm64\n");
		vi.mocked(writeFileSync).mockImplementationOnce(() => {
			throw new Error("access denied");
		});
		const terminal = {
			rows: 30,
			cols: 100,
			write: vi.fn(),
			writeln: vi.fn(),
		};

		try {
			new PtySession().spawn(terminal as unknown as Terminal, {
				opencodePath: "opencode",
				cwd: "C:\\vault",
				args: [],
			});

			expect(terminal.writeln).toHaveBeenCalledWith(expect.stringContaining("access denied"));
			expect(spawn).not.toHaveBeenCalled();
		} finally {
			platform.mockRestore();
		}
	});

	it("launches the Windows ConPTY host inside a kill-on-close job owner", () => {
		const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		const child = createProcess();
		child.pid = 1234;
		const job = createProcess();
		job.pid = 5678;
		vi.mocked(spawn)
			.mockReturnValueOnce(child as unknown as ChildProcess)
			.mockReturnValueOnce(job as unknown as ChildProcess);
		const terminal = {
			rows: 30,
			cols: 100,
			write: vi.fn(),
			writeln: vi.fn(),
		};

		try {
			new PtySession().spawn(terminal as unknown as Terminal, {
				opencodePath: "opencode",
				cwd: "C:\\vault",
				args: [],
			});

			expect(spawn).toHaveBeenNthCalledWith(1, expect.stringMatching(/node\.exe$/i), [
				"-e",
				expect.any(String),
				expect.stringMatching(/[\\/]zigpty-x64\.node$/i),
				"100",
				"30",
				expect.stringMatching(/opencode(?:\.[A-Z]+)?$/i),
			], expect.objectContaining({
				cwd: "C:\\vault",
				stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
				windowsHide: true,
			}));
			expect(spawn).toHaveBeenNthCalledWith(2, expect.stringMatching(/[\\/]windows-pty-job-host\.exe$/i), [
				String(process.pid),
				"1234",
			], expect.objectContaining({
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			}));
			job.stdout.emit("data", Buffer.from("ready\n"));
			expect((child.stdio[4] as { write: ReturnType<typeof vi.fn> }).write).toHaveBeenCalledWith("start\n");
		} finally {
			platform.mockRestore();
		}
	});

	it("waits for the Windows process tree to stop", async () => {
		const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		const inheritedTerm = process.env.TERM;
		process.env.TERM = "dumb";
		const child = createProcess();
		child.pid = 1234;
		const job = createProcess();
		job.pid = 5678;
		const taskkill = createProcess();
		vi.mocked(spawn)
			.mockReturnValueOnce(child as unknown as ChildProcess)
			.mockReturnValueOnce(job as unknown as ChildProcess)
			.mockReturnValueOnce(taskkill as unknown as ChildProcess);
		const terminal = {
			rows: 30,
			cols: 100,
			write: vi.fn(),
			writeln: vi.fn(),
		};

		try {
			const session = new PtySession();
			session.spawn(terminal as unknown as Terminal, {
				opencodePath: "opencode",
				cwd: "C:\\vault",
				args: ["--help"],
				editorPort: 43210,
			});

			expect(spawn).toHaveBeenCalledWith(expect.stringMatching(/node\.exe$/i), [
				"-e",
				expect.stringMatching(/pendingWrites[\s\S]*native\.resize\(handle, cols, rows\)/),
				expect.stringMatching(/[\\/]zigpty-x64\.node$/i),
				"100",
				"30",
				expect.stringMatching(/opencode(?:\.[A-Z]+)?$/i),
				"--help",
			], expect.objectContaining({
				cwd: "C:\\vault",
				stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
				windowsHide: true,
			}));
			expect(vi.mocked(spawn).mock.calls[0][2]?.env).toMatchObject({
				OPENCODE_EDITOR_SSE_PORT: "43210",
				TERM: "xterm-256color",
			});

			session.sendResize(terminal as unknown as Terminal);
			expect((child.stdio[3] as { write: ReturnType<typeof vi.fn> }).write).toHaveBeenLastCalledWith("100x30\n");
			session.writeStdin("hello");
			expect(child.stdin.write).toHaveBeenCalledWith("hello");

			let stopped = false;
			const stopping = session.kill().then(() => { stopped = true; });
			expect(spawn).toHaveBeenLastCalledWith("taskkill.exe", ["/pid", "1234", "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
			});
			await Promise.resolve();
			expect(stopped).toBe(false);
			taskkill.emit("exit", 0, null);
			await Promise.resolve();
			expect(stopped).toBe(false);
			child.emit("exit", 0, null);
			job.emit("exit", 0, null);
			await stopping;
			expect(stopped).toBe(true);
		} finally {
			if (inheritedTerm === undefined) delete process.env.TERM;
			else process.env.TERM = inheritedTerm;
			platform.mockRestore();
		}
	});

	it("force-kills a Windows PTY host when taskkill does not finish", async () => {
		vi.useFakeTimers();
		const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		const child = createProcess();
		child.pid = 1234;
		const job = createProcess();
		job.pid = 5678;
		const taskkill = createProcess();
		vi.mocked(spawn)
			.mockReturnValueOnce(child as unknown as ChildProcess)
			.mockReturnValueOnce(job as unknown as ChildProcess)
			.mockReturnValueOnce(taskkill as unknown as ChildProcess);
		const terminal = { rows: 24, cols: 80, write: vi.fn(), writeln: vi.fn() };

		try {
			const session = new PtySession();
			session.spawn(terminal as unknown as Terminal, {
				opencodePath: "opencode",
				cwd: "C:\\vault",
				args: [],
			});
			const stopping = session.kill();
			let stopped = false;
			void stopping.then(() => { stopped = true; });

			await vi.advanceTimersByTimeAsync(5000);
			expect(stopped).toBe(false);
			expect(child.kill).toHaveBeenCalled();
			expect(job.kill).toHaveBeenCalled();
			child.emit("exit", null, "SIGTERM");
			job.emit("exit", null, "SIGTERM");
			await stopping;
			expect(stopped).toBe(true);
		} finally {
			vi.useRealTimers();
			platform.mockRestore();
		}
	});
});
