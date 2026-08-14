import * as path from "node:path";
import { mkdirSync } from "node:fs";
import { release } from "node:os";
import { browser, expect } from "@wdio/globals";
import { WebSocket, RawData } from "ws";

const artifactsDir = path.resolve("test-results/obsidian");
const opencodeStub = path.resolve(`test/fixtures/opencode-stub${process.platform === "win32" ? ".cmd" : ""}`);

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
	try {
		await browser.waitUntil(async () => (await terminalBuffer()).includes(text), {
			timeoutMsg: `Terminal did not render ${JSON.stringify(text)}`,
		});
	} catch (error) {
		throw new Error(`${String(error)}\nTerminal buffer:\n${await terminalBuffer()}`);
	}
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

		await expect(view.$("button=Export to note")).toExist();
		await browser.execute(() => {
			const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".opencode-session-detail button"));
			buttons.find((button) => button.textContent === "Export to note")?.click();
		});
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
		await expect(browser.$(".opencode-session-detail").$("button=Restore in terminal")).toExist();
		await browser.execute(() => {
			const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".opencode-session-detail button"));
			buttons.find((button) => button.textContent === "Restore in terminal")?.click();
		});

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
		const newline = process.platform === "win32" ? "\\r\\n" : "\\n";
		expect(output).toContain(`INPUT:"你好${newline}"`);
		expect(output).not.toContain("nihao你好");
	});

	it("[issue #22] resizes the running Windows ConPTY", async function () {
		if (process.platform !== "win32") this.skip();
		await browser.execute(async () => {
			const app = (window as any).app;
			const plugin = app.plugins.plugins.opencode;
			plugin.settings.opencodePath = "cmd.exe";
			await plugin.saveSettings();
			await plugin.newSession();
		});
		await waitForTerminalText(">");

		await browser.execute(() => {
			const app = (window as any).app;
			const view = app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			view.terminal.resize(90, 30);
			view.ptySession.sendResize(view.terminal);
			view.ptySession.writeStdin("mode con\r");
		});
		await waitForTerminalText("Columns:        90");

		await browser.execute(async (stubPath: string) => {
			const app = (window as any).app;
			const plugin = app.plugins.plugins.opencode;
			plugin.settings.opencodePath = stubPath;
			await plugin.saveSettings();
			await plugin.newSession();
		}, opencodeStub);
		await waitForTerminalText("OpenCode isolated test stub");
	});

	it("[issue #22] keeps the real OpenCode model picker layout coherent", async function () {
		if (process.platform !== "win32" || process.env.OPENCODE_REAL_E2E !== "1") this.skip();
		await browser.execute(async () => {
			const app = (window as any).app;
			const plugin = app.plugins.plugins.opencode;
			plugin.settings.opencodePath = "opencode";
			await plugin.saveSettings();
			const existing = app.workspace.getLeavesOfType("opencode-terminal")[0]?.view;
			existing?.terminal.reset();
			existing?.fitAddon.fit();
			await plugin.newSession();
		});
		await waitForTerminalText("Ask anything");

		const textarea = browser.$(".opencode-terminal-container .xterm-helper-textarea");
		await textarea.click();
		await browser.execute(() => {
			const app = (window as any).app;
			app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.paste("/model");
		});
		await browser.keys("Enter");
		await waitForTerminalText("Select model");
		await browser.keys(["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown"]);
		const originalWidth = await browser.execute(() => {
			const container = document.querySelector<HTMLElement>(".opencode-terminal");
			if (!container) throw new Error("Terminal container not found");
			const width = container.style.width;
			container.style.width = `${Math.max(320, container.clientWidth - 200)}px`;
			return width;
		});
		await browser.pause(300);
		await browser.execute((width) => {
			const app = (window as any).app;
			const container = document.querySelector<HTMLElement>(".opencode-terminal");
			if (!container) throw new Error("Terminal container not found");
			container.style.width = width;
			const view = app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			view.fitAddon.fit();
			view.ptySession.sendResize(view.terminal);
		}, originalWidth);
		await browser.pause(300);
		await waitForTerminalText("Select model");

		const lines = await browser.execute(() => {
			const app = (window as any).app;
			const buffer = app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.buffer.active;
			const result: string[] = [];
			for (let index = 0; index < buffer.length; index++) {
				result.push(buffer.getLine(index)?.translateToString(true) ?? "");
			}
			return result;
		});
		await browser.saveScreenshot(path.join(artifactsDir, "windows-model-picker.png"));
		expect(lines.filter((line) => line.includes("Select model"))).toHaveLength(1);
		expect(lines.filter((line) => line.trim() === "Recent").length).toBeLessThanOrEqual(1);
		expect(lines.filter((line) => line.trim() === "OpenCode Zen").length).toBeLessThanOrEqual(1);
		const terminalOptions = await browser.execute(() => {
			const app = (window as any).app;
			const terminal = app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
			return { convertEol: terminal.options.convertEol, windowsPty: terminal.options.windowsPty };
		});
		expect(terminalOptions.convertEol).toBe(false);
		expect(terminalOptions.windowsPty).toEqual({
			backend: "conpty",
			buildNumber: Number.parseInt(release().split(".")[2], 10),
		});
	});

	it("[issue #22] shows real OpenCode shell command output", async function () {
		if (process.platform !== "win32" || process.env.OPENCODE_REAL_E2E !== "1") this.skip();
		await browser.execute(async () => {
			const app = (window as any).app;
			const plugin = app.plugins.plugins.opencode;
			plugin.settings.opencodePath = "opencode";
			await plugin.saveSettings();
			const existing = app.workspace.getLeavesOfType("opencode-terminal")[0]?.view;
			existing?.terminal.reset();
			existing?.fitAddon.fit();
			await plugin.newSession();
		});
		await waitForTerminalText("Ask anything");

		const vaultName = await browser.execute(() => {
			const app = (window as any).app;
			app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.paste("!pwd");
			return app.vault.getName();
		});
		await browser.keys("Enter");
		await browser.waitUntil(async () => {
			return browser.execute((name) => {
				const app = (window as any).app;
				const buffer = app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.buffer.active;
				let count = 0;
				for (let index = 0; index < buffer.length; index++) {
					if (buffer.getLine(index)?.translateToString(true).includes(name)) count++;
				}
				return count >= 2;
			}, vaultName);
		}, { timeout: 5_000, timeoutMsg: `Terminal did not render pwd output for ${vaultName}` });
		await browser.saveScreenshot(path.join(artifactsDir, "windows-shell-output.png"));
	});

	it("[issue #22] forwards mouse clicks to real OpenCode", async function () {
		if (process.platform !== "win32" || process.env.OPENCODE_REAL_E2E !== "1") this.skip();
		await browser.execute(async () => {
			const app = (window as any).app;
			await app.plugins.plugins.opencode.newSession();
		});
		await waitForTerminalText("Ask anything");
		await browser.execute(() => {
			const app = (window as any).app;
			app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.paste("/sessions");
		});
		await browser.pause(100);
		await browser.keys("Enter");
		await waitForTerminalText("Sessions");

		const target = await browser.execute(() => {
			const app = (window as any).app;
			const terminal = app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
			const buffer = terminal.buffer.active;
			let row = -1;
			for (let index = 0; index < buffer.length; index++) {
				if (buffer.getLine(index)?.translateToString(true).includes("New session")) {
					row = index - buffer.viewportY;
					break;
				}
			}
			if (row < 0) throw new Error("No visible session row found");
			const screen = terminal.element.querySelector(".xterm-screen");
			const rect = screen.getBoundingClientRect();
			return {
				x: Math.round(rect.left + 15.5 * rect.width / terminal.cols),
				y: Math.round(rect.top + (row + 0.5) * rect.height / terminal.rows),
			};
		});

		await browser.action("pointer")
			.move({ x: target.x, y: target.y, origin: "viewport" })
			.down({ button: 0 })
			.up({ button: 0 })
			.perform();
		await browser.waitUntil(async () => {
			return browser.execute(() => {
				const app = (window as any).app;
				const buffer = app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.buffer.active;
				for (let index = 0; index < buffer.length; index++) {
					if (buffer.getLine(index)?.translateToString(true).trim().startsWith("Sessions")) return false;
				}
				return true;
			});
		}, { timeout: 3_000, timeoutMsg: "Clicking a session did not activate it" });
	});

	it("[issue #22] selects a real OpenCode model with a click", async function () {
		if (process.platform !== "win32" || process.env.OPENCODE_REAL_E2E !== "1") this.skip();
		await browser.execute(async () => {
			const app = (window as any).app;
			const plugin = app.plugins.plugins.opencode;
			const view = app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			view.terminal.reset();
			view.fitAddon.fit();
			await plugin.newSession();
		});
		await waitForTerminalText("Ask anything");
		await browser.execute(() => {
			const app = (window as any).app;
			app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.paste("/model");
		});
		await browser.keys("Enter");
		await waitForTerminalText("Switch model");
		await browser.keys("Terra");
		await waitForTerminalText("GPT-5.6 Terra");
		const target = await browser.execute(() => {
			const app = (window as any).app;
			const terminal = app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
			const buffer = terminal.buffer.active;
			let row = -1;
			for (let index = buffer.viewportY; index < buffer.viewportY + terminal.rows; index++) {
				if (buffer.getLine(index)?.translateToString(true).includes("GPT-5.6 Terra")) {
					row = index - buffer.viewportY;
					break;
				}
			}
			if (row < 0) throw new Error("Model row not found");
			const screen = terminal.element.querySelector(".xterm-screen");
			const rect = screen.getBoundingClientRect();
			return {
				x: Math.round(rect.left + 15.5 * rect.width / terminal.cols),
				y: Math.round(rect.top + (row + 0.5) * rect.height / terminal.rows),
			};
		});
		await browser.action("pointer")
			.move({ x: target.x, y: target.y, origin: "viewport" })
			.down({ button: 0 })
			.up({ button: 0 })
			.perform();
		await browser.waitUntil(async () => {
			return browser.execute(() => {
				const app = (window as any).app;
				const buffer = app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.buffer.active;
				for (let index = 0; index < buffer.length; index++) {
					if (buffer.getLine(index)?.translateToString(true).includes("Switch model")) return false;
				}
				return true;
			});
		}, { timeout: 5_000, timeoutMsg: "Clicking a model did not close the picker" });
		await browser.saveScreenshot(path.join(artifactsDir, "windows-model-picker.png"));
		expect(await terminalBuffer()).toContain("GPT-5.6 Terra");
	});

	it("[issue #22] moves the real OpenCode prompt cursor on click", async function () {
		if (process.platform !== "win32" || process.env.OPENCODE_REAL_E2E !== "1") this.skip();
		await browser.execute(async () => {
			const app = (window as any).app;
			const plugin = app.plugins.plugins.opencode;
			const view = app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			view.terminal.reset();
			view.fitAddon.fit();
			await plugin.newSession();
		});
		await waitForTerminalText("Ask anything");
		const textarea = browser.$(".opencode-terminal-container .xterm-helper-textarea");
		await textarea.click();
		await browser.keys(["a", "b", "c", "d"]);
		await waitForTerminalText("abcd");

		const target = await browser.execute(() => {
			const app = (window as any).app;
			const terminal = app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
			const buffer = terminal.buffer.active;
			const screen = terminal.element.querySelector(".xterm-screen");
			const rect = screen.getBoundingClientRect();
			return {
				x: Math.round(rect.left + (buffer.cursorX - 1.5) * rect.width / terminal.cols),
				y: Math.round(rect.top + (buffer.cursorY + 0.5) * rect.height / terminal.rows),
			};
		});
		await browser.action("pointer")
			.move({ x: target.x, y: target.y, origin: "viewport" })
			.down({ button: 0 })
			.up({ button: 0 })
			.perform();
		await browser.keys("X");
		await waitForTerminalText("abXcd");
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
