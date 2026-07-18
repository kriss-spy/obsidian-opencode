import * as path from "node:path";
import { mkdirSync } from "node:fs";
import { browser, expect } from "@wdio/globals";
import { WebSocket, RawData } from "ws";

const artifactsDir = path.resolve("test-results/obsidian");
const opencodeStub = path.resolve("test/fixtures/opencode-stub");

function nextMessage(socket: WebSocket): Promise<string> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message")), 5_000);
		socket.once("message", (data) => {
			clearTimeout(timer);
			resolve(data.toString());
		});
	});
}

function collectMessages(socket: WebSocket, count: number): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const messages: string[] = [];
		const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${count} WebSocket messages`)), 5_000);
		const onMessage = (data: RawData) => {
			messages.push(data.toString());
			if (messages.length === count) {
				clearTimeout(timer);
				socket.off("message", onMessage);
				resolve(messages);
			}
		};
		socket.on("message", onMessage);
	});
}

async function terminalBuffer(): Promise<string> {
	return browser.execute(() => {
		const leaf = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0];
		const buffer = leaf?.view?.terminal?.buffer?.active;
		if (!buffer) return "";
		return Array.from({ length: buffer.length }, (_, index) =>
			buffer.getLine(index)?.translateToString(true) ?? ""
		).join("");
	});
}

async function waitForTerminalText(text: string): Promise<void> {
	await browser.waitUntil(async () => (await terminalBuffer()).includes(text), {
		timeoutMsg: `Terminal did not render ${JSON.stringify(text)}`,
	});
}

describe("OpenCode plugin in a fresh vault", function () {
	before(async function () {
		mkdirSync(artifactsDir, { recursive: true });
		const loaded = await browser.execute(() => Boolean((window as any).app.plugins.plugins.opencode));
		expect(loaded).toBe(true);

		await browser.execute(async (stubPath: string) => {
			const plugin = (window as any).app.plugins.plugins.opencode;
			plugin.settings.opencodePath = stubPath;
			plugin.settings.defaultWorkingDirectory = plugin.vaultRoot;
			await plugin.saveSettings();
		}, opencodeStub);
	});

	it("[smoke] registers its commands", async function () {
		const commandIds = await browser.execute(() => (
			(window as any).app.commands.listCommands()
				.map((command: { id: string }) => command.id)
				.filter((id: string) => id.startsWith("opencode:"))
		));

		expect(commandIds).toEqual(expect.arrayContaining([
			"opencode:open-terminal",
			"opencode:open-conversations",
			"opencode:new-session",
		]));
	});

	it("[smoke] opens the conversations view", async function () {
		await browser.executeObsidianCommand("opencode:open-conversations");

		const view = browser.$(".opencode-conversation-container");
		await expect(view).toExist();
		await expect(view.$("h3")).toHaveText("Opencode sessions");
		await expect(view.$('button[aria-label="Refresh sessions"]')).toExist();
		await expect(view.$(".opencode-session-title")).toHaveText("Fixture session");
		await browser.saveScreenshot(path.join(artifactsDir, "conversations.png"));
	});

	it("[smoke] previews and exports a session", async function () {
		const view = browser.$(".opencode-conversation-container");
		await view.$(".opencode-session-item").click();
		await expect(view.$(".opencode-session-detail h4")).toHaveText("Fixture session");
		await expect(view.$(".opencode-session-info")).toHaveText(expect.stringContaining("fixture-model"));
		await expect(view.$(".opencode-message-text")).toHaveText("Fixture conversation message");

		await view.$("button=Export to note").click();
		await browser.waitUntil(() => browser.execute(() => Boolean(
			(window as any).app.vault.getAbstractFileByPath("OpenCode/Fixture session.md")
		)), { timeoutMsg: "Exported session note was not created" });
		const exported = await browser.execute(async () => {
			const app = (window as any).app;
			return app.vault.read(app.vault.getAbstractFileByPath("OpenCode/Fixture session.md"));
		});
		expect(exported).toContain("opencode-session: fixture-session");
		expect(exported).toContain("Fixture conversation message");
	});

	it("[smoke] restores the selected session in a terminal", async function () {
		await browser.$(".opencode-session-detail").$("button=Restore in terminal").click();

		const terminal = browser.$(".opencode-terminal-container .xterm");
		await expect(terminal).toExist();
		await waitForTerminalText('ARGS:["-s","fixture-session"]');
	});

	it("[issue #27] accepts input after New Session replaces an existing PTY", async function () {
		await browser.executeObsidianCommand("opencode:new-session");
		await waitForTerminalText("ARGS:[]");

		const textarea = browser.$(".opencode-terminal-container .xterm-helper-textarea");
		await textarea.click();
		await browser.keys(["h", "e", "l", "l", "o", "Enter"]);
		await waitForTerminalText("hello");
	});

	it("[issue #27] continues the last session and remains responsive", async function () {
		await browser.executeObsidianCommand("opencode:continue-last-session");
		await waitForTerminalText('ARGS:["-c"]');

		const textarea = browser.$(".opencode-terminal-container .xterm-helper-textarea");
		await textarea.click();
		await browser.keys(["a", "g", "a", "i", "n", "Enter"]);
		await waitForTerminalText("again");
	});

	it("[issue #26] sends only committed Chinese text during IME composition", async function () {
		await browser.execute(async () => {
			const app = (window as any).app;
			for (const leaf of app.workspace.getLeavesOfType("opencode-terminal")) {
				await leaf.detach();
			}
			await app.plugins.plugins.opencode.activateTerminalView();
		});
		await expect(browser.$(".opencode-terminal-container .xterm-helper-textarea")).toExist();
		await waitForTerminalText("OpenCode isolated test stub");

		await browser.execute(() => {
			const app = (window as any).app;
			const view = app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			const textarea = view.terminal.textarea as HTMLTextAreaElement;
			view.terminal.clear();
			textarea.focus();
			textarea.dispatchEvent(new CompositionEvent("compositionstart", {
				bubbles: true,
				data: "",
			}));
			for (const key of "nihao") {
				textarea.dispatchEvent(new KeyboardEvent("keydown", {
					key,
					bubbles: true,
					cancelable: true,
					isComposing: true,
				}));
			}
			textarea.dispatchEvent(new CompositionEvent("compositionupdate", {
				bubbles: true,
				data: "你好",
			}));
			textarea.dispatchEvent(new CompositionEvent("compositionend", {
				bubbles: true,
				data: "你好",
			}));
			// xterm's composition helper emits the committed value through this input seam.
			view.terminal.input("你好", true);
			view.terminal.input("\r", true);
		});

		await waitForTerminalText("INPUT:");
		const output = await terminalBuffer();
		await browser.saveScreenshot(path.join(artifactsDir, "macos-ime.png"));
		expect(output).toContain('INPUT:"你好\\n"');
		expect(output).not.toContain("nihao你好");
	});

	it("[smoke] keeps a usable, singleton terminal view", async function () {
		const geometry = await browser.execute(() => {
			const app = (window as any).app;
			const element = document.querySelector(".opencode-terminal-container .xterm") as HTMLElement;
			const terminal = app.workspace.getLeavesOfType("opencode-terminal")[0]?.view?.terminal;
			return {
				leaves: app.workspace.getLeavesOfType("opencode-terminal").length,
				width: element?.clientWidth ?? 0,
				height: element?.clientHeight ?? 0,
				cols: terminal?.cols ?? 0,
				rows: terminal?.rows ?? 0,
			};
		});
		expect(geometry.leaves).toBe(1);
		expect(geometry.width).toBeGreaterThan(200);
		expect(geometry.height).toBeGreaterThan(100);
		expect(geometry.cols).toBeGreaterThan(20);
		expect(geometry.rows).toBeGreaterThan(5);

		await browser.executeObsidianCommand("opencode:open-terminal");
		const leafCount = await browser.execute(() => (
			(window as any).app.workspace.getLeavesOfType("opencode-terminal").length
		));
		expect(leafCount).toBe(1);

		await browser.executeObsidianCommand("opencode:toggle-terminal-sidebar");
		await browser.waitUntil(() => browser.execute(() => Boolean((window as any).app.workspace.rightSplit.collapsed)), {
			timeoutMsg: "Terminal sidebar did not collapse",
		});
		await browser.executeObsidianCommand("opencode:toggle-terminal-sidebar");
		await browser.waitUntil(() => browser.execute(() => !(window as any).app.workspace.rightSplit.collapsed), {
			timeoutMsg: "Terminal sidebar did not reveal",
		});
	});

	it("[smoke] implements the editor protocol and file-drop delivery", async function () {
		const serverState = await browser.execute(() => {
			const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			return {
				port: view.editorServer.port,
				lockFilePath: view.editorServer.lockFilePath,
			};
		});
		expect(serverState.lockFilePath).toBe("");

		const socket = new WebSocket(`ws://127.0.0.1:${serverState.port}`);
		await new Promise<void>((resolve, reject) => {
			socket.once("open", resolve);
			socket.once("error", reject);
		});
		const initializeResponse = nextMessage(socket);
		socket.send(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "initialize", params: {} }));
		expect(JSON.parse(await initializeResponse)).toMatchObject({
			jsonrpc: "2.0",
			id: 7,
			result: { serverInfo: { name: "obsidian-opencode" } },
		});

		const singleMention = nextMessage(socket);
		await browser.execute(() => {
			const app = (window as any).app;
			const original = app.dragManager.draggable;
			app.dragManager.draggable = { type: "file", file: { path: "Smoke.md" } };
			document.querySelector(".opencode-terminal-container")?.dispatchEvent(
				new DragEvent("drop", { bubbles: true, cancelable: true })
			);
			app.dragManager.draggable = original;
		});
		expect(JSON.parse(await singleMention)).toMatchObject({
			method: "at_mentioned",
			params: { filePath: "Smoke.md", lineStart: 1, lineEnd: 1 },
		});

		const multipleMentions = collectMessages(socket, 2);
		await browser.execute(() => {
			const app = (window as any).app;
			const original = app.dragManager.draggable;
			app.dragManager.draggable = {
				type: "files",
				files: [{ path: "Smoke.md" }, { path: "Folder/Second.md" }],
			};
			document.querySelector(".opencode-terminal-container")?.dispatchEvent(
				new DragEvent("drop", { bubbles: true, cancelable: true })
			);
			app.dragManager.draggable = original;
		});
		expect((await multipleMentions).map((message) => JSON.parse(message).params.filePath))
			.toEqual(["Smoke.md", "Folder/Second.md"]);

		await browser.saveScreenshot(path.join(artifactsDir, "terminal.png"));

		const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
		await browser.execute(async () => {
			const leaf = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0];
			await leaf.detach();
		});
		await closed;
	});

	it("[issue #28] keeps the embedded editor server out of global discovery", async function () {
		await browser.execute(async () => {
			await (window as any).app.plugins.plugins.opencode.activateTerminalView();
		});
		await expect(browser.$(".opencode-terminal-container .xterm")).toExist();
		await browser.waitUntil(() => browser.execute(() => {
			const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view;
			return (view?.editorServer?.port ?? 0) > 0;
		}), { timeoutMsg: "Editor server did not start" });
		const serverState = await browser.execute(() => {
			const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			return {
				port: view.editorServer.port,
				lockFilePath: view.editorServer.lockFilePath,
			};
		});
		expect(serverState.port).toBeGreaterThan(0);
		expect(serverState.lockFilePath).toBe("");
	});
});
