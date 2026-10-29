import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { browser, expect } from "@wdio/globals";
import { resolveOpencodeExecutable } from "../../src/utils/opencodeExecutable";

describe("[issue #69] session links", function () {
	it("copies from conversations without restoring, handles missing targets, and never falls back to a previous opened session", async function () {
		const stub = path.resolve(`test/fixtures/opencode-stub${process.platform === "win32" ? ".cmd" : ""}`);
		const previous = await browser.execute(() => ({ ...(window as any).app.plugins.plugins.opencode.settings }));
		try {
			await browser.execute(async (executable: string) => {
				const app = (window as any).app, plugin = app.plugins.plugins.opencode;
				await plugin.viewCoordinator.closeTerminal();
				plugin.settings.opencodePath = executable;
				plugin.settings.environmentVariables = { OBSIDIAN_OPENCODE_SESSION_LINKS: "1" };
				plugin.settings.defaultWorkingDirectory = "";
				(window as any).__sessionLinkWrites = [];
				(window as any).__originalClipboardWrite = navigator.clipboard.writeText;
				navigator.clipboard.writeText = async (text: string) => { (window as any).__sessionLinkWrites.push(text); };
				await plugin.activateConversationView();
				await app.workspace.getLeavesOfType("opencode-conversations")[0].view.showSessionDetail({ id: "ses_fixture", directory: plugin.vaultRoot, title: "Fixture" });
			}, stub);
			await browser.$('button[aria-label="Copy session link"]').click();
			await browser.waitUntil(() => browser.execute(() => (window as any).__sessionLinkWrites.length === 1));
			expect(await browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal").length)).toBe(0);
			await browser.executeObsidianCommand("opencode:copy-session-link");
			expect(await browser.execute(() => (window as any).__sessionLinkWrites.length)).toBe(1);
			const targets: Record<string, string>[] = [
				{ session: "bad id" }, { session: "ses_missing" }, { directory: path.join(tmpdir(), "nonexistent-issue69-directory") },
			];
			for (const override of targets) {
				await browser.execute(async (changes: Record<string, string>) => {
					const plugin = (window as any).app.plugins.plugins.opencode;
					const params = Object.fromEntries(new URL((window as any).__sessionLinkWrites[0]).searchParams);
					await plugin.openSessionLink({ ...params, ...changes });
				}, override);
				expect(await browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal").length)).toBe(0);
			}
			await browser.execute(async () => {
				const app = (window as any).app;
				const params = Object.fromEntries(new URL((window as any).__sessionLinkWrites[0]).searchParams);
				delete params.vault; // Consumed by Obsidian's desktop URI routing.
				app.workspace.protocolHandler.dispatch({ action: "opencode", ...params });
			});
			await browser.waitUntil(() => browser.execute(() => !!(window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view.ptySession.getStdin()));
			await browser.execute(async () => {
				const app = (window as any).app, plugin = app.plugins.plugins.opencode;
				const view = app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				view.getCurrentSession = async () => ({ id: "ses_switched", directory: plugin.vaultRoot });
				await plugin.copyCurrentSessionLink();
				view.getCurrentSession = async () => null;
				await plugin.copyCurrentSessionLink();
				delete view.getCurrentSession;
			});
			const writes: string[] = await browser.execute(() => (window as any).__sessionLinkWrites);
			expect(writes).toHaveLength(2);
			expect(new URL(writes[1]).searchParams.get("session")).toBe("ses_switched");
		} finally {
			await browser.execute(async (settings: any) => {
				const plugin = (window as any).app.plugins.plugins.opencode;
				await plugin.viewCoordinator.closeTerminal();
				plugin.settings = settings;
				navigator.clipboard.writeText = (window as any).__originalClipboardWrite;
			}, previous);
		}
	});

	it("[real V2] resolves the displayed session after terminal-side switching and resumes a link", async function () {
		if (process.env.OPENCODE_REAL_E2E !== "1") this.skip();
		this.timeout(120_000);
		const executable = resolveOpencodeExecutable(process.env.OPENCODE_REAL_EXECUTABLE ?? "opencode");
		const profile = mkdtempSync(path.join(tmpdir(), "obsidian-session-links-"));
		const directory = path.join(profile, "Project 空格");
		mkdirSync(directory);
		const environment = {
			XDG_CONFIG_HOME: path.join(profile, "config"), XDG_DATA_HOME: path.join(profile, "data"),
			XDG_CACHE_HOME: path.join(profile, "cache"), XDG_STATE_HOME: path.join(profile, "state"),
			OPENCODE_CONFIG_DIR: path.join(profile, "config", "opencode"),
		};
		const port = await new Promise<number>((resolve, reject) => {
			const server = createServer();
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (!address || typeof address === "string") { server.close(); reject(new Error("No test port")); return; }
				server.close(() => resolve(address.port));
			});
		});
		execFileSync(executable, ["service", "set", "port", String(port)], { env: { ...process.env, ...environment }, stdio: "ignore" });
		const create = (title: string) => JSON.parse(execFileSync(executable, ["api", "--standalone", "post", "/api/session", "--data",
			JSON.stringify({ title, location: { directory } })], { cwd: directory, env: { ...process.env, ...environment }, encoding: "utf8" })).data;
		const first: { id: string } = create("Issue69 first"), second: { id: string } = create("Issue69 second");
		const previous = await browser.execute(() => {
			const plugin = (window as any).app.plugins.plugins.opencode;
			return { ...plugin.settings, environmentVariables: { ...plugin.settings.environmentVariables } };
		});
		try {
			await browser.execute(async (settings: { opencodePath: string; environmentVariables: Record<string, string> }, id: string, cwd: string) => {
				const plugin = (window as any).app.plugins.plugins.opencode;
				await plugin.viewCoordinator.closeTerminal();
				Object.assign(plugin.settings, settings);
				plugin.sessionArgs = ["--standalone", "-s", id];
				plugin.sessionCwd = cwd;
				await plugin.activateTerminalView();
				(window as any).__sessionLinkWrites = [];
				(window as any).__originalClipboardWrite = navigator.clipboard.writeText;
				navigator.clipboard.writeText = async (text: string) => { (window as any).__sessionLinkWrites.push(text); };
			}, { opencodePath: executable, environmentVariables: environment }, first.id, directory);
			const current = () => browser.execute(async () => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view.getCurrentSession());
			await browser.waitUntil(async () => (await current())?.id === first.id, { timeout: 30_000, timeoutMsg: "Real OpenCode did not report its displayed session" });
			await browser.executeObsidianCommand("opencode:copy-session-link");
			await browser.waitUntil(() => browser.execute(() => (window as any).__sessionLinkWrites.length === 1));
			await browser.keys(["Control", "x"]); await browser.keys("NULL"); await browser.keys("l");
			await browser.keys("Issue69 second");
			await browser.keys("Enter");
			await browser.waitUntil(async () => (await current())?.id === second.id, { timeout: 15_000, timeoutMsg: "Terminal-side session switch did not reach the bridge" });
			await browser.executeObsidianCommand("opencode:copy-session-link");
			await browser.waitUntil(() => browser.execute(() => (window as any).__sessionLinkWrites.length === 2));
			const urls: string[] = await browser.execute(() => (window as any).__sessionLinkWrites);
			expect(new URL(urls[0]).searchParams.get("session")).toBe(first.id);
			expect(new URL(urls[1]).searchParams.get("session")).toBe(second.id);
			expect(new URL(urls[1]).searchParams.get("directory")).toBe(directory);
			await browser.execute(async (id: string, cwd: string) => {
				const plugin = (window as any).app.plugins.plugins.opencode;
				await plugin.activateConversationView();
				const view = (window as any).app.workspace.getLeavesOfType("opencode-conversations")[0].view;
				void view.showSessionDetail({ id, directory: cwd, title: "First" });
			}, first.id, directory);
			const copyButton = browser.$('button[aria-label="Copy session link"]');
			await copyButton.scrollIntoView();
			await copyButton.waitForClickable();
			await copyButton.click();
			await browser.waitUntil(() => browser.execute(() => (window as any).__sessionLinkWrites.length === 3));
			expect((await current())?.id).toBe(second.id);
			expect(await browser.execute(() => (window as any).__sessionLinkWrites[2])).toBe(urls[0]);
			await browser.execute(async (url: string) => {
				const app = (window as any).app;
				const plugin = app.plugins.plugins.opencode;
				await plugin.viewCoordinator.closeTerminal();
				const params = Object.fromEntries(new URL(url).searchParams);
				delete params.vault;
				app.workspace.protocolHandler.dispatch({ action: "opencode", ...params });
			}, urls[0]);
			try {
				await browser.waitUntil(async () => (await current())?.id === first.id, { timeout: 30_000, timeoutMsg: "Session link did not resume its session" });
			} catch (error) {
				const details = await browser.execute(() => {
					const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view;
					const buffer = view?.terminal?.buffer.active;
					return { notices: Array.from(document.querySelectorAll(".notice")).map((notice) => notice.textContent),
						terminal: buffer ? Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? "").join("\n") : "No terminal" };
				});
				throw new Error(`${String(error)}\n${JSON.stringify(details)}`);
			}
			// Also resume while another session is active, then repeat with the
			// referenced session already open. Desktop routing omits vault in both.
			for (const id of [second.id, second.id]) {
				await browser.execute(async (sessionId: string, cwd: string) => {
					await (window as any).app.plugins.plugins.opencode.openSessionLink({ action: "opencode", session: sessionId, directory: cwd });
				}, id, directory);
				await browser.waitUntil(async () => (await current())?.id === id, { timeout: 30_000 });
				expect(await browser.execute(() => Array.from(document.querySelectorAll(".notice"), (notice) => notice.textContent)
					.some((message) => message?.includes("Unable to open session link")))).toBe(false);
			}
		} finally {
			await browser.execute(async (settings: any) => {
				const plugin = (window as any).app.plugins.plugins.opencode;
				await plugin.viewCoordinator.closeTerminal();
				plugin.settings = settings;
				if ((window as any).__originalClipboardWrite) navigator.clipboard.writeText = (window as any).__originalClipboardWrite;
			}, previous);
			execFileSync(executable, ["service", "stop"], { env: { ...process.env, ...environment }, stdio: "ignore" });
			rmSync(profile, { recursive: true, force: true });
		}
	});
});
