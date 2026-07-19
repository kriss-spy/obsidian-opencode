import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type { Terminal } from "@xterm/xterm";
import { PtySession } from "./ptySession";

vi.mock("obsidian", () => ({
	Notice: class {},
}));

vi.mock("child_process", () => ({
	spawn: vi.fn(),
}));

vi.mock("fs", () => ({
	accessSync: vi.fn(),
	existsSync: vi.fn().mockReturnValue(false),
	constants: { X_OK: 1 },
}));

interface MockProcess extends EventEmitter {
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
		vi.stubGlobal("window", { setTimeout: vi.fn() });
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
});
