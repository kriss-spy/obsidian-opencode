import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, ChildProcess, execFileSync } from "child_process";
import { writeFileSync } from "fs";
import { EventEmitter } from "events";
import type { Terminal } from "@xterm/xterm";
import { PtySession } from "./ptySession";

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
	process.stdio = [process.stdin, process.stdout, process.stderr, { write: vi.fn() }];
	process.kill = vi.fn();
	return process;
}

describe("PtySession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("window", { setTimeout: vi.fn(), clearTimeout: vi.fn() });
	});

	it("keeps the replacement PTY active when the killed PTY exits", () => {
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

		session.spawn(terminal as unknown as Terminal, options);
		session.kill();
		session.spawn(terminal as unknown as Terminal, options);
		oldProcess.emit("exit", 0, null);
		session.writeStdin("hello");

		expect(replacementProcess.stdin.write).toHaveBeenCalledWith("hello");
		expect(terminal.writeln).not.toHaveBeenCalled();
	});

	it("passes the private editor server port to OpenCode", () => {
		const child = createProcess();
		vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);

		const session = new PtySession();
		const terminal = {
			rows: 24,
			cols: 80,
			write: vi.fn(),
			writeln: vi.fn(),
		};

		session.spawn(terminal as unknown as Terminal, {
			opencodePath: "opencode",
			cwd: "/tmp",
			args: [],
			editorPort: 43210,
		});

		expect(vi.mocked(spawn).mock.calls[0][2]?.env).toMatchObject({
			OPENCODE_EDITOR_SSE_PORT: "43210",
		});
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

	it("runs OpenCode in the Windows headless ConPTY host", () => {
		const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		const inheritedTerm = process.env.TERM;
		process.env.TERM = "dumb";
		const child = createProcess();
		vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
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
				stdio: ["pipe", "pipe", "pipe", "pipe"],
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

			child.pid = 1234;
			session.kill();
			expect(spawn).toHaveBeenLastCalledWith("taskkill.exe", ["/pid", "1234", "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
			});
		} finally {
			if (inheritedTerm === undefined) delete process.env.TERM;
			else process.env.TERM = inheritedTerm;
			platform.mockRestore();
		}
	});
});
