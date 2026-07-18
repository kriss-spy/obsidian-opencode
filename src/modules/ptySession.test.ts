import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "child_process";
import { EventEmitter } from "events";
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

function createProcess() {
	const process = new EventEmitter() as EventEmitter & Record<string, any>;
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
			.mockReturnValueOnce(oldProcess as any)
			.mockReturnValueOnce(replacementProcess as any);

		const session = new PtySession();
		const terminal = {
			rows: 24,
			cols: 80,
			write: vi.fn(),
			writeln: vi.fn(),
		};
		const options = { opencodePath: "opencode", cwd: "/tmp", args: [] };

		session.spawn(terminal as any, options);
		session.kill();
		session.spawn(terminal as any, options);
		oldProcess.emit("exit", 0, null);
		session.writeStdin("hello");

		expect(replacementProcess.stdin.write).toHaveBeenCalledWith("hello");
	});
});
