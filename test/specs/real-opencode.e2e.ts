import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { browser, expect } from "@wdio/globals";
import { resolveOpencodeExecutable } from "../../src/utils/opencodeExecutable";
import { inspectArtifact, verifyArtifact } from "../../scripts/release-artifact.mjs";

type ProcessRow = { pid: number; parent: number; name: string; state?: string };
function processes(): ProcessRow[] {
	if (process.platform === "win32") {
		const rows = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
			"@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name) | ConvertTo-Json -Compress"],
		{ encoding: "utf8", timeout: 15_000 }));
		return rows.map((row: { ProcessId: number; ParentProcessId: number; Name: string }) => ({
			pid: row.ProcessId, parent: row.ParentProcessId, name: row.Name,
		}));
	}
	return execFileSync("ps", ["-axo", "pid=,ppid=,stat=,comm="], { encoding: "utf8" }).trim().split("\n").map(line => {
		const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
		if (!match) throw new Error(`Cannot parse process row: ${line}`);
		return { pid: Number(match[1]), parent: Number(match[2]), state: match[3], name: match[4] };
	});
}
function tree(roots: number[]): ProcessRow[] {
	const rows = processes(), owned = new Set(roots);
	let previousSize = -1;
	while (previousSize !== owned.size) {
		previousSize = owned.size;
		for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid);
	}
	const result = rows.filter(row => owned.has(row.pid));
	if (!result.some(row => /opencode/i.test(row.name))) throw new Error("PTY did not own a real OpenCode process");
	return result;
}
async function waitForExit(owned: ProcessRow[]): Promise<void> {
	await browser.waitUntil(() => {
		const running = new Set(processes().filter(row => !row.state?.startsWith("Z")).map(row => row.pid));
		return owned.every(row => !running.has(row.pid));
	}, { timeout: 15_000, interval: 250, timeoutMsg: `OpenCode processes survived terminal close: ${JSON.stringify(owned)}` });
}
async function bufferText(): Promise<string> {
	return browser.execute(() => {
		const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view.terminal;
		const buffer = terminal?.buffer.active;
		return buffer ? Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? "").join("\n") : "";
	});
}
async function waitForText(text: string): Promise<void> {
	try {
		await browser.waitUntil(async () => (await bufferText()).includes(text), {
			timeout: 30_000, timeoutMsg: `Real OpenCode did not render ${text}`,
		});
	} catch (error) {
		throw new Error(`${String(error)}\n${await bufferText()}`);
	}
}
async function roots(): Promise<number[]> {
	return browser.execute(() => {
		const session = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view.ptySession;
		const ids = [session?.ptyProcess?.pid, session?.windowsJobProcess?.pid].filter((id): id is number => typeof id === "number");
		if (!ids.length) throw new Error("Missing live PTY process");
		return ids;
	});
}
async function closeTerminal(): Promise<void> {
	await browser.execute(async () => {
		const app = (window as any).app;
		const views = app.workspace.getLeavesOfType("opencode-terminal").map((leaf: any) => leaf.view);
		await app.plugins.plugins.opencode.viewCoordinator.closeTerminal();
		await Promise.all(views.map((view: any) => view.lifecycle.enqueue(() => {})));
	});
}

// This spec has no optional enable flag and no platform skips. Only the dedicated
// runner selects it, and that runner also rejects zero/skipped/stale results.
describe("Mandatory real OpenCode compatibility", function () {
	it("launches, types, resizes, closes, reopens and cleans up the native CLI", async function () {
		this.timeout(180_000);
		if (!["linux", "darwin", "win32"].includes(process.platform)) throw new Error("Unsupported platform");
		const executable = resolveOpencodeExecutable(process.env.OPENCODE_REAL_EXECUTABLE ?? "opencode");
		const cliVersion = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 30_000 }).trim();
		if (!/\bv?2\./.test(cliVersion)) throw new Error(`Real OpenCode V2 required: ${cliVersion}`);
		const environment = await browser.executeObsidian(({ obsidian }) => ({
			appVersion: obsidian.apiVersion, userAgent: navigator.userAgent,
		}));
		let artifactSha256: Record<string, string> | undefined;
		if (process.env.OPENCODE_TEST_PLUGIN_DIR) {
			const candidate = verifyArtifact(process.env.OPENCODE_TEST_PLUGIN_DIR, process.env.CI_EXPECTED_SHA);
			const installed = await browser.execute(() => {
				const app = (window as any).app;
				return { vault: app.vault.adapter.basePath, directory: app.plugins.plugins.opencode.manifest.dir };
			});
			artifactSha256 = inspectArtifact(path.resolve(installed.vault, installed.directory));
			expect(artifactSha256).toEqual(candidate.sha256);
		}
		const profile = mkdtempSync(path.join(tmpdir(), "obsidian-real-compatibility-"));
		const artifacts = path.resolve("test-results/obsidian/real-opencode");
		mkdirSync(artifacts, { recursive: true });
		const checks: string[] = [], owned: ProcessRow[][] = [];
		const previous = await browser.execute(() => {
			const settings = (window as any).app.plugins.plugins.opencode.settings;
			return { ...settings, environmentVariables: { ...settings.environmentVariables } };
		});
		try {
			await browser.execute(async (opencodePath: string, profilePath: string) => {
				const plugin = (window as any).app.plugins.plugins.opencode;
				await plugin.viewCoordinator.closeTerminal();
				plugin.settings.opencodePath = opencodePath;
				plugin.settings.defaultWorkingDirectory = "";
				plugin.settings.newSessionArgs = "--standalone";
				plugin.settings.environmentVariables = {
					XDG_CONFIG_HOME: `${profilePath}/config`, XDG_DATA_HOME: `${profilePath}/data`,
					XDG_CACHE_HOME: `${profilePath}/cache`, XDG_STATE_HOME: `${profilePath}/state`,
					OPENCODE_CONFIG_DIR: `${profilePath}/config/opencode`,
				};
				await plugin.saveSettings();
				plugin.sessionArgs = null;
				await plugin.activateTerminalView();
			}, executable, profile);
			await waitForText("Ask anything");
			await browser.execute(() => {
				const app = (window as any).app;
				app.workspace.rightSplit.containerEl.style.width = "640px";
				app.workspace.trigger("resize");
			});
			await browser.waitUntil(() => browser.execute(() => {
				return (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.cols >= 64;
			}), { timeoutMsg: "Terminal sidebar did not expand for the resize test" });
			const firstRoots = await roots();
			owned.push(tree(firstRoots));
			if (process.platform === "win32") {
				expect(await browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]
					.view.terminal.options.windowsPty?.backend)).toBe("conpty");
			}
			checks.push("launch");

			// Exercise the public reveal command after focus moves into a note.
			await browser.execute(async () => {
				const app = (window as any).app;
				const leaf = app.workspace.getLeaf("tab");
				await leaf.openFile(app.vault.getAbstractFileByPath("Smoke.md"));
				leaf.view.editor.focus();
			});
			await browser.executeObsidianCommand("opencode:open-terminal");
			await browser.waitUntil(() => browser.execute(() => {
				const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
				return document.activeElement === terminal.textarea;
			}), { timeoutMsg: "Revealed terminal did not focus its input" });
			await browser.keys("compatibility-input");
			await waitForText("compatibility-input");
			checks.push("input");

			const geometry = await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				const container = (window as any).app.workspace.rightSplit.containerEl as HTMLElement;
				const previous = { width: container.style.width, cols: Number(view.terminal.cols) };
				container.style.width = "480px";
				view.fitAddon.fit();
				view.ptySession.sendResize(view.terminal);
				return previous;
			});
			await browser.waitUntil(() => browser.execute((before: number) => {
				return (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.cols < before;
			}, geometry.cols), { timeoutMsg: "Pane resize did not change the terminal columns" });
			await browser.keys("-resized");
			await waitForText("compatibility-input-resized");
			expect(await roots()).toEqual(firstRoots);
			await browser.execute((width: string) => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				(window as any).app.workspace.rightSplit.containerEl.style.width = width;
				view.fitAddon.fit();
				view.ptySession.sendResize(view.terminal);
			}, geometry.width);
			checks.push("resize");

			owned[0] = tree(firstRoots);
			await closeTerminal();
			await waitForExit(owned[0]);
			checks.push("close");
			await browser.executeObsidianCommand("opencode:open-terminal");
			await waitForText("Ask anything");
			const secondRoots = await roots();
			expect(secondRoots[0]).not.toBe(firstRoots[0]);
			owned.push(tree(secondRoots));
			await browser.keys("compatibility-reopened");
			await waitForText("compatibility-reopened");
			checks.push("reopen");
			await browser.saveScreenshot(path.join(artifacts, "reopened.png"));
			owned[1] = tree(secondRoots);
			await closeTerminal();
			await waitForExit(owned[1]);
			checks.push("cleanup");
			writeFileSync(path.join(artifacts, "passed.json"), JSON.stringify({
				status: "passed", platform: process.platform, arch: process.arch,
				commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
				...environment, cliVersion, checks, processes: owned, artifactSha256,
			}, null, 2));
		} finally {
			try {
				writeFileSync(path.join(artifacts, "last-buffer.txt"), await bufferText());
			} finally {
				await closeTerminal();
				await browser.execute(async (settings: typeof previous) => {
					const plugin = (window as any).app.plugins.plugins.opencode;
					plugin.settings = settings;
					await plugin.saveSettings();
				}, previous);
				rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
			}
		}
	});
});
