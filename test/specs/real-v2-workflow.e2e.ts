import * as path from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { browser, expect } from "@wdio/globals";
import { resolveOpencodeExecutable } from "../../src/utils/opencodeExecutable";

describe("Installed OpenCode V2 in an isolated vault", function () {
	it("[real V2] focuses a revealed terminal and remains responsive after Ctrl+Z", async function () {
		if (process.platform !== "linux" || process.env.OPENCODE_REAL_E2E !== "1") this.skip();
		const executable = resolveOpencodeExecutable("opencode");
		const previous = await browser.execute(() => {
			const settings = (window as any).app.plugins.plugins.opencode.settings;
			return { ...settings, environmentVariables: { ...settings.environmentVariables } };
		});
		const profile = mkdtempSync(path.join(tmpdir(), "obsidian-opencode-real-v2-"));
		try {
			await browser.execute(async (opencodePath: string, profilePath: string) => {
				const plugin = (window as any).app.plugins.plugins.opencode;
				await plugin.viewCoordinator.closeTerminal();
				plugin.settings.opencodePath = opencodePath;
				plugin.settings.defaultWorkingDirectory = "";
				plugin.settings.newSessionArgs = "--standalone";
				plugin.settings.environmentVariables = {
					XDG_CONFIG_HOME: `${profilePath}/config`,
					XDG_DATA_HOME: `${profilePath}/data`,
					XDG_CACHE_HOME: `${profilePath}/cache`,
					XDG_STATE_HOME: `${profilePath}/state`,
					OPENCODE_CONFIG_DIR: `${profilePath}/config/opencode`,
				};
				await plugin.saveSettings();
				// New session intentionally supplies an empty argv; use Open terminal
				// so the configured --standalone isolation flag reaches the CLI.
				plugin.sessionArgs = null;
				await plugin.activateTerminalView();
			}, executable, profile);
			const buffer = () => browser.execute(() => {
				const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view.terminal;
				if (!terminal) return "";
				return Array.from({ length: terminal.buffer.active.length }, (_, i) =>
					terminal.buffer.active.getLine(i)?.translateToString(true) ?? ""
				).join("\n");
			});
			try {
				await browser.waitUntil(async () => (await buffer()).includes("Ask anything"), {
					timeout: 30_000,
					timeoutMsg: "Installed OpenCode V2 did not render its prompt",
				});
			} catch (error) {
				throw new Error(`${String(error)}\nIsolated terminal buffer:\n${await buffer()}`);
			}
			await browser.execute(async () => {
				const app = (window as any).app;
				const file = app.vault.getAbstractFileByPath("Smoke.md");
				const leaf = app.workspace.getLeaf("tab");
				await leaf.openFile(file);
				leaf.view.editor.focus();
			});
			await browser.executeObsidianCommand("opencode:open-terminal");
			await browser.waitUntil(() => browser.execute(() => {
				const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view.terminal;
				return terminal?.textarea === document.activeElement;
			}), { timeoutMsg: "Revealed OpenCode V2 input did not receive focus" });
			await browser.keys("isolated-v2-focus-check");
			await browser.waitUntil(async () => (await buffer()).includes("isolated-v2-focus-check"), {
				timeoutMsg: "Focused installed OpenCode V2 did not receive keyboard input",
			});
			await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				(window as any).__suspendInput = [];
				(window as any).__suspendSubscription = view.terminal.onData((data: string) => (window as any).__suspendInput.push(data));
			});
			await browser.keys(["Control", "z"]);
			await browser.keys("NULL");
			await browser.keys("-ok");
			try {
				await browser.waitUntil(async () => (await buffer()).includes("isolated-v2-focus-check-ok"), {
					timeout: 5000,
					timeoutMsg: "Installed OpenCode V2 stopped accepting input after Ctrl+Z",
				});
			} catch (error) {
				const trace = await browser.execute(() => ({ input: (window as any).__suspendInput }));
				throw new Error(`${String(error)}\n${JSON.stringify(trace)}\n${await buffer()}`);
			}
			const input = await browser.execute(() => (window as any).__suspendInput.join(""));
			expect(input).toBe("-ok");
			await expect(browser.$(".opencode-terminal-container .xterm")).toExist();
			mkdirSync(path.resolve("test-results/obsidian"), { recursive: true });
			await browser.saveScreenshot(path.resolve("test-results/obsidian/real-v2-workflow.png"));
		} finally {
			await browser.execute(async (settings: typeof previous) => {
				const plugin = (window as any).app.plugins.plugins.opencode;
				(window as any).__suspendSubscription?.dispose();
				delete (window as any).__suspendSubscription;
				delete (window as any).__suspendInput;
				await plugin.viewCoordinator.closeTerminal();
				plugin.settings = settings;
				await plugin.saveSettings();
			}, previous);
			rmSync(profile, { recursive: true, force: true });
		}
	});
});
