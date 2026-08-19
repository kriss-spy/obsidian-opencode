import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChildProcess, spawn } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { clearTimeout as nodeClearTimeout, setTimeout as nodeSetTimeout } from "node:timers";
import { WINDOWS_PTY_JOB_HOST_BASE64 } from "./windowsPtyJobHost";
import { PtySession } from "../modules/ptySession";
import type { Terminal } from "@xterm/xterm";

const windowsIt = process.platform === "win32" ? it : it.skip;
const cleanupProcesses = new Set<ChildProcess>();
const cleanupDirectories = new Set<string>();

beforeEach(() => {
	vi.stubGlobal("window", { setTimeout: nodeSetTimeout, clearTimeout: nodeClearTimeout });
});

afterEach(() => {
	vi.unstubAllGlobals();
	for (const child of cleanupProcesses) child.kill();
	cleanupProcesses.clear();
	for (const directory of cleanupDirectories) rmSync(directory, { recursive: true, force: true });
	cleanupDirectories.clear();
});

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		const timeout = nodeSetTimeout(() => reject(new Error(`Process ${child.pid} did not exit`)), timeoutMs);
		child.once("exit", () => {
			nodeClearTimeout(timeout);
			resolve();
		});
	});
}

function parseProcessTree(value: string): { child: number; grandchild: number } {
	const parsed: unknown = JSON.parse(value);
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error(`Invalid process tree: ${value}`);
	}
	const processTree = parsed as Record<string, unknown>;
	if (
		typeof processTree.child === "number" &&
		typeof processTree.grandchild === "number"
	) {
		return { child: processTree.child, grandchild: processTree.grandchild };
	}
	throw new Error(`Invalid process tree: ${value}`);
}

async function waitForProcessToDisappear(pid: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch {
			return;
		}
		await new Promise((resolve) => nodeSetTimeout(resolve, 50));
	}
	throw new Error(`Process ${pid} remained alive`);
}

describe("Windows PTY Job Object host", () => {
	windowsIt("terminates the complete descendant tree when its owner exits", async () => {
		const directory = mkdtempSync(join(tmpdir(), "obsidian-opencode-job-test-"));
		cleanupDirectories.add(directory);
		const jobHostPath = join(directory, "windows-pty-job-host.exe");
		writeFileSync(jobHostPath, Buffer.from(WINDOWS_PTY_JOB_HOST_BASE64, "base64"));

		const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true });
		cleanupProcesses.add(owner);
		expect(owner.pid).toBeTypeOf("number");

		const targetScript = [
			'const { spawn } = require("child_process")',
			'const fs = require("fs")',
			'fs.createReadStream(null, { fd: 3 }).once("data", () => { const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true }); console.log(JSON.stringify({ child: process.pid, grandchild: grandchild.pid })) })',
			'setInterval(() => {}, 1000)',
		].join(";");
		const target = spawn(process.execPath, ["-e", targetScript], {
			stdio: ["ignore", "pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		cleanupProcesses.add(target);
		expect(target.pid).toBeTypeOf("number");
		const jobHost = spawn(jobHostPath, [String(owner.pid), String(target.pid)], {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		cleanupProcesses.add(jobHost);
		await new Promise<void>((resolve, reject) => {
			const timeout = nodeSetTimeout(() => reject(new Error("PTY job host did not become ready")), 5000);
			jobHost.stdout.once("data", () => {
				nodeClearTimeout(timeout);
				resolve();
			});
			jobHost.stderr.once("data", (data: Buffer) => {
				nodeClearTimeout(timeout);
				reject(new Error(data.toString()));
			});
		});
		(target.stdio[3] as NodeJS.WritableStream).write("start\n");

		const processTree = await new Promise<{ child: number; grandchild: number }>((resolve, reject) => {
			const timeout = nodeSetTimeout(() => reject(new Error("PTY child did not become ready")), 5000);
			target.stdout!.once("data", (data: Buffer) => {
				nodeClearTimeout(timeout);
				resolve(parseProcessTree(data.toString()));
			});
			jobHost.once("exit", (code) => {
				nodeClearTimeout(timeout);
				reject(new Error(`PTY job host exited with code ${code}`));
			});
		});

		owner.kill();
		await waitForExit(owner, 5000);
		await waitForExit(jobHost, 5000);
		await Promise.all([
			waitForProcessToDisappear(processTree.child, 5000),
			waitForProcessToDisappear(processTree.grandchild, 5000),
		]);
	}, 20000);

	windowsIt("stops a real zigpty descendant tree through PtySession", async () => {
		const output: string[] = [];
		const terminal = {
			rows: 24,
			cols: 80,
			write: (data: string | Uint8Array) => output.push(data.toString()),
			writeln: (data: string) => output.push(data),
		};
		const childScript = [
			'const { spawn } = require("child_process")',
			'const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true })',
			'console.log("TREE:" + JSON.stringify({ child: process.pid, grandchild: grandchild.pid }))',
			'setInterval(() => {}, 1000)',
		].join(";");
		const session = new PtySession();
		session.spawn(terminal as unknown as Terminal, {
			opencodePath: process.execPath,
			cwd: process.cwd(),
			args: ["-e", childScript],
		});

		const processTree = await new Promise<{ child: number; grandchild: number }>((resolve, reject) => {
			const deadline = Date.now() + 5000;
			const inspect = () => {
				const match = output.join("").match(/TREE:(\{[^\r\n]+\})/);
				if (match) {
					resolve(parseProcessTree(match[1]));
				} else if (Date.now() >= deadline) {
					reject(new Error(`zigpty child did not become ready: ${output.join("")}`));
				} else {
					nodeSetTimeout(inspect, 25);
				}
			};
			inspect();
		});

		await session.kill();
		await Promise.all([
			waitForProcessToDisappear(processTree.child, 5000),
			waitForProcessToDisappear(processTree.grandchild, 5000),
		]);
	}, 20000);

	windowsIt("launches a configured PowerShell script through ConPTY", async () => {
		const directory = mkdtempSync(join(tmpdir(), "obsidian-opencode-ps1-test-"));
		cleanupDirectories.add(directory);
		const scriptPath = join(directory, "opencode.ps1");
		writeFileSync(scriptPath, 'Write-Output "PS1_OK:$($args -join \",\")"');
		const output: string[] = [];
		const terminal = {
			rows: 24,
			cols: 80,
			write: (data: string | Uint8Array) => output.push(data.toString()),
			writeln: (data: string) => output.push(data),
		};
		const session = new PtySession();
		session.spawn(terminal as unknown as Terminal, {
			opencodePath: scriptPath,
			cwd: directory,
			args: ["one", "two"],
		});

		try {
			await new Promise<void>((resolve, reject) => {
				const deadline = Date.now() + 5000;
				const inspect = () => {
					if (output.join("").includes("PS1_OK:one,two")) resolve();
					else if (Date.now() >= deadline) reject(new Error(`PowerShell script did not run: ${output.join("")}`));
					else nodeSetTimeout(inspect, 25);
				};
				inspect();
			});
		} finally {
			await session.kill();
		}
	}, 10000);

	windowsIt("launches an npm command shim through ConPTY", async () => {
		const output: string[] = [];
		const terminal = {
			rows: 24,
			cols: 80,
			write: (data: string | Uint8Array) => output.push(data.toString()),
			writeln: (data: string) => output.push(data),
		};
		const session = new PtySession();
		session.spawn(terminal as unknown as Terminal, {
			opencodePath: join(process.cwd(), "test", "fixtures", "opencode-stub.cmd"),
			cwd: process.cwd(),
			args: ["one", "two"],
		});

		try {
			await new Promise<void>((resolve, reject) => {
				const deadline = Date.now() + 5000;
				const inspect = () => {
					if (output.join("").includes('ARGS:["one","two"]')) resolve();
					else if (Date.now() >= deadline) reject(new Error(`npm command shim did not run: ${output.join("")}`));
					else nodeSetTimeout(inspect, 25);
				};
				inspect();
			});
		} finally {
			await session.kill();
		}
	}, 10000);

	windowsIt("hides terminal capability probes mangled by ConPTY", async () => {
		const output: string[] = [];
		const terminal = {
			rows: 24,
			cols: 80,
			write: (data: string | Uint8Array) => output.push(data.toString()),
			writeln: (data: string) => output.push(data),
		};
		const probe = "\x1bP+q4d73\x1b\\\x1b_Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\";
		const session = new PtySession();
		session.spawn(terminal as unknown as Terminal, {
			opencodePath: process.execPath,
			cwd: process.cwd(),
			args: ["-e", `process.stdout.write(${JSON.stringify(`before${probe}after`)})`],
		});

		try {
			await new Promise<void>((resolve, reject) => {
				const deadline = Date.now() + 5000;
				const inspect = () => {
					if (output.join("").includes("after")) resolve();
					else if (Date.now() >= deadline) reject(new Error(`ConPTY probe fixture did not run: ${output.join("")}`));
					else nodeSetTimeout(inspect, 25);
				};
				inspect();
			});
			expect(output.join("")).toContain("beforeafter");
			expect(output.join("")).not.toContain("+q4d73Gi=31337");
		} finally {
			await session.kill();
		}
	}, 10000);

});
