import * as path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { release, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import { WebSocket, RawData } from "ws";
import { createWslWindowsClipboard, isWsl2 } from "../../src/modules/wslWindowsClipboard";
import { resolveOpencodeExecutable } from "../../src/utils/opencodeExecutable";

const artifactsDir = path.resolve("test-results/obsidian");
const opencodeStub = path.resolve(`test/fixtures/opencode-stub${process.platform === "win32" ? ".cmd" : ""}`);
const opencodeCmdStub = path.resolve("test/fixtures/opencode-cmd-stub.cmd");
const opentuiImageStub = path.resolve("test/fixtures/opentui-image-stub");

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
			plugin.settings.defaultWorkingDirectory = "";
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
			"opencode:close-terminal",
		]));

		const closeTerminalHotkeys = await browser.execute(() => (
			(window as any).app.hotkeyManager.defaultKeys["opencode:close-terminal"]
		));
		// WebDriver serializes an undefined browser result as null.
		expect(closeTerminalHotkeys).toBeNull();
	});

	it("[smoke] opens the conversations view", async function () {
		await browser.executeObsidianCommand("opencode:open-conversations");

		const view = browser.$(".opencode-conversation-container");
		await expect(view).toExist();
		await expect(view.$("h3")).toHaveText("Opencode sessions");
		await expect(view.$('button[aria-label="New session"]')).toExist();
		await expect(view.$('button[aria-label="Refresh sessions"]')).toExist();
		await expect(view.$(".opencode-session-title")).toHaveText("Fixture session");
		await expect(view.$(".opencode-session-dir")).not.toExist();
		const splitter = view.$('.opencode-session-splitter[role="separator"]');
		await expect(splitter).toExist();
		const initialListWidth = await view.$(".opencode-session-list").getSize("width");
		await splitter.dragAndDrop({ x: 64, y: 0 });
		expect(await view.$(".opencode-session-list").getSize("width")).toBeGreaterThan(initialListWidth);
		await browser.saveScreenshot(path.join(artifactsDir, "conversations.png"));
	});

	it("[issue #36] lists OpenCode v2 sessions through its API", async function () {
		await browser.executeObsidianCommand("opencode:open-conversations");
		const previousEnvironmentVariables = await browser.execute(() => {
			const plugin = (window as any).app.plugins.plugins.opencode;
			return { ...plugin.settings.environmentVariables };
		});

		try {
			await browser.execute(async () => {
				const app = (window as any).app;
				const plugin = app.plugins.plugins.opencode;
				plugin.settings.environmentVariables = {
					...plugin.settings.environmentVariables,
					OBSIDIAN_OPENCODE_V2: "1",
				};
				await plugin.saveSettings();
				await app.workspace.getLeavesOfType("opencode-conversations")[0].view.loadSessions();
			});

			await expect(browser.$(".opencode-session-title")).toHaveText("Fixture v2 session");
			await browser.$(".opencode-session-item").click();
			await expect(browser.$(".opencode-session-info")).toHaveText(expect.stringContaining("fixture-model"));
		} finally {
			await browser.execute(async (serializedEnvironmentVariables: string) => {
				const app = (window as any).app;
				const plugin = app.plugins.plugins.opencode;
				plugin.settings.environmentVariables = JSON.parse(serializedEnvironmentVariables);
				await plugin.saveSettings();
				await app.workspace.getLeavesOfType("opencode-conversations")[0].view.loadSessions();
			}, JSON.stringify(previousEnvironmentVariables));
		}
	});

	it("[smoke] previews and exports a session", async function () {
		const view = browser.$(".opencode-conversation-container");
		await view.$(".opencode-session-item").click();
		await expect(view.$(".opencode-session-detail h4")).toHaveText("Fixture session");
		await expect(view.$(".opencode-session-info")).toHaveText(expect.stringContaining("fixture-model"));
		await expect(view.$(".opencode-message-text")).toHaveText("Fixture conversation message");
		await expect(view.$(".opencode-message-assistant .opencode-message-role")).toHaveText("AGENT");
		await expect(view.$(".opencode-message-assistant .opencode-message-text")).toHaveText("Fixture agent response");

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

	it("[issue #32] starts a new session when session history is empty", async function () {
		await browser.executeObsidianCommand("opencode:open-conversations");
		const previousEnvironmentVariables = await browser.execute(() => {
			const plugin = (window as any).app.plugins.plugins.opencode;
			return { ...plugin.settings.environmentVariables };
		});

		try {
			await browser.execute(async () => {
				const app = (window as any).app;
				const plugin = app.plugins.plugins.opencode;
				plugin.settings.environmentVariables = {
					...plugin.settings.environmentVariables,
					OBSIDIAN_OPENCODE_EMPTY_SESSIONS: "1",
				};
				await plugin.saveSettings();
				await app.workspace.getLeavesOfType("opencode-conversations")[0].view.loadSessions();
			});

			const conversations = browser.$(".opencode-conversation-container");
			await expect(conversations.$(".opencode-empty")).toHaveText("No sessions found.");
			await expect(conversations.$(".opencode-session-item")).not.toExist();
			await conversations.$('button[aria-label="New session"]').click();
			await expect(browser.$(".opencode-terminal-container .xterm")).toExist();
			await waitForTerminalText("ARGS:[]");
			expect(await terminalBuffer()).not.toContain("STALE_RESTART_CONTENT");
		} finally {
			await browser.execute(async (serializedEnvironmentVariables: string) => {
				const app = (window as any).app;
				const plugin = app.plugins.plugins.opencode;
				plugin.settings.environmentVariables = JSON.parse(serializedEnvironmentVariables);
				await plugin.saveSettings();
				await app.workspace.getLeavesOfType("opencode-conversations")[0].view.loadSessions();
			}, JSON.stringify(previousEnvironmentVariables));
		}
	});

	it("[issue #27] accepts input after New Session replaces an existing PTY", async function () {
		await browser.executeObsidianCommand("opencode:new-session");
		await waitForTerminalText("ARGS:[]");

		await browser.execute(() => {
			const app = (window as any).app;
			app.workspace.getLeavesOfType("opencode-terminal")[0].view.ptySession.writeStdin("hello\r");
		});
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

	it("fits the replacement PTY when restarting the terminal", async function () {
		const expected = await browser.execute(async () => {
			const app = (window as any).app;
			const plugin = app.plugins.plugins.opencode;
			plugin.settings.environmentVariables = {
				...plugin.settings.environmentVariables,
				OBSIDIAN_OPENCODE_REPORT_SIZE: "1",
			};
			await plugin.saveSettings();
			const view = app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			view.terminal.resize(20, 5);
			return view.fitAddon.proposeDimensions();
		});
		expect(expected).not.toBeNull();

		try {
			await browser.executeObsidianCommand("opencode:restart-terminal");
			await waitForTerminalText(`SIZE:${expected!.cols}x${expected!.rows}`);
			const dimensions = await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				return { cols: view.terminal.cols, rows: view.terminal.rows };
			});
			expect(dimensions).toEqual(expected);
		} finally {
			await browser.execute(async () => {
				const plugin = (window as any).app.plugins.plugins.opencode;
				delete plugin.settings.environmentVariables.OBSIDIAN_OPENCODE_REPORT_SIZE;
				await plugin.saveSettings();
			});
		}
	});

	it("[issue #33] ignores Caps Lock while preserving ordinary terminal input", async function () {
		await browser.execute(async () => {
			const app = (window as any).app;
			for (const leaf of app.workspace.getLeavesOfType("opencode-terminal")) {
				await leaf.detach();
			}
			await app.plugins.plugins.opencode.activateTerminalView();
		});
		const textarea = browser.$(".opencode-terminal-container .xterm-helper-textarea");
		await expect(textarea).toExist();
		await waitForTerminalText("OpenCode isolated test stub");

		const capsLockPrevented = await browser.execute(() => {
			const app = (window as any).app;
			const view = app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			const helperTextarea = view.terminal.textarea as HTMLTextAreaElement;
			view.terminal.clear();
			helperTextarea.focus();
			const event = new KeyboardEvent("keydown", {
				key: "CapsLock",
				bubbles: true,
				cancelable: true,
			});
			helperTextarea.dispatchEvent(event);
			return event.defaultPrevented;
		});
		expect(capsLockPrevented).toBe(false);

		await textarea.click();
		await browser.keys(["i", "s", "s", "u", "e", "3", "3", "i", "n", "p", "u", "t", "Enter"]);
		const newline = process.platform === "win32" ? "\\r\\n" : "\\n";
		await waitForTerminalText(`INPUT:"issue33input${newline}"`);
		const output = await terminalBuffer();
		expect(output).toContain(`INPUT:"issue33input${newline}"`);
		expect(output).not.toContain("CapsLock");
	});

	it("[issue #37] passes configured environment variables to the terminal child", async function () {
		const variableName = "OBSIDIAN_OPENCODE_TEST_VARIABLE";
		const variableValue = 'issue #37 exact value = $HOME; "quoted"';
		const previousEnvironmentVariables = await browser.execute(async (name: string, value: string) => {
			const plugin = (window as any).app.plugins.plugins.opencode;
			const previous = { ...plugin.settings.environmentVariables };
			plugin.settings.environmentVariables = {
				...plugin.settings.environmentVariables,
				[name]: value,
			};
			await plugin.saveSettings();
			return previous;
		}, variableName, variableValue);

		try {
			await browser.executeObsidianCommand("opencode:open-conversations");
			const conversations = browser.$(".opencode-conversation-container");
			await conversations.$(".opencode-session-item").click();
			await expect(conversations.$(".opencode-session-info")).toHaveText(expect.stringContaining(variableValue));
			await browser.execute(async () => {
				await (window as any).app.plugins.plugins.opencode.newSession();
			});
			const digest = createHash("sha256").update(variableValue).digest("hex").slice(0, 16);
			await waitForTerminalText(`ENV_SHA256:${digest}`);
		} finally {
			await browser.execute(async (serializedEnvironmentVariables: string) => {
				const plugin = (window as any).app.plugins.plugins.opencode;
				plugin.settings.environmentVariables = JSON.parse(serializedEnvironmentVariables);
				await plugin.saveSettings();
			}, JSON.stringify(previousEnvironmentVariables));
		}
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

	it("[issue #44] keeps a post-composition Space after committed Korean text", async function () {
		await browser.execute(async () => {
			const app = (window as any).app;
			for (const leaf of app.workspace.getLeavesOfType("opencode-terminal")) {
				await leaf.detach();
			}
			await app.plugins.plugins.opencode.activateTerminalView();
		});
		await expect(browser.$(".opencode-terminal-container .xterm-helper-textarea")).toExist();
		await waitForTerminalText("OpenCode isolated test stub");

		await browser.execute(async () => {
			const app = (window as any).app;
			const view = app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			const textarea = view.terminal.textarea as HTMLTextAreaElement;
			view.terminal.clear();
			textarea.focus();
			textarea.dispatchEvent(new CompositionEvent("compositionstart", {
				bubbles: true,
				data: "",
			}));
			textarea.value = "안녕";
			textarea.dispatchEvent(new CompositionEvent("compositionupdate", {
				bubbles: true,
				data: "안녕",
			}));
			// Chromium updates the textarea before xterm records the end of the
			// composition range on the next task.
			await new Promise((resolve) => window.setTimeout(resolve, 0));
			textarea.dispatchEvent(new CompositionEvent("compositionend", {
				bubbles: true,
				data: "안녕",
			}));
			const space = new KeyboardEvent("keydown", {
				key: " ",
				code: "Space",
				bubbles: true,
				cancelable: true,
			});
			// Chromium reports the legacy keyCode to xterm's composition helper.
			Object.defineProperty(space, "keyCode", { value: 32 });
			textarea.dispatchEvent(space);
			// Electron does not translate an untrusted synthetic keydown into text;
			// supply the character at xterm's public input boundary instead.
			view.terminal.input(" ", true);
			await new Promise((resolve) => window.setTimeout(resolve, 20));
			view.terminal.input("\r", true);
		});

		await waitForTerminalText("INPUT:");
		const output = await terminalBuffer();
		const newline = process.platform === "win32" ? "\\r\\n" : "\\n";
		expect(output).toContain(`INPUT:"안녕 ${newline}"`);
	});

	it("[issues #50, #53] bridges text and image clipboard input under WSL2", async function () {
		if (!isWsl2()) this.skip();
		const clipboard = createWslWindowsClipboard();
		if (!clipboard) throw new Error("WSL2 was detected without a Windows clipboard bridge");
		await browser.executeObsidianCommand("opencode:open-terminal");
		await expect(browser.$(".opencode-terminal-container .xterm")).toExist();
		const originalClipboard = await clipboard.readText();
		const selectionText = "Décodage éàèêôù 中文 😀 '$HOME'";
		const pastedText = "Windows paste é中😀\r\nsecond line";
		const oscText = "OSC 52 é中😀 quotes '$HOME'";
		const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

		try {
			const selected = await browser.executeAsync((text: string, done: (value: string) => void) => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				view.terminal.write(`\r\n${text}`, () => {
					const buffer = view.terminal.buffer.active;
					view.terminal.select(0, buffer.baseY + buffer.cursorY, view.terminal.cols);
					view.terminal.textarea.dispatchEvent(new KeyboardEvent("keydown", {
						key: "c",
						code: "KeyC",
						ctrlKey: true,
						bubbles: true,
						cancelable: true,
					}));
					done(view.terminal.getSelection());
				});
			}, selectionText);
			expect(selected).toBe(selectionText);
			await browser.waitUntil(async () => (await clipboard.readText()) === selectionText, {
				timeout: 10_000,
				timeoutMsg: "Terminal selection did not reach the Windows clipboard",
			});
			await browser.waitUntil(() => browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				return !view.terminal.hasSelection();
			}), { timeoutMsg: "Successful WSL clipboard copy did not clear the selection" });
			await browser.execute(async () => {
				const app = (window as any).app;
				const file = await app.vault.create("WSL clipboard verification.md", "");
				const leaf = app.workspace.getLeaf("tab");
				await leaf.openFile(file);
				leaf.view.editor.focus();
			});
			await browser.keys([Key.Control, "v"]);
			await browser.waitUntil(async () => {
				const text = await browser.execute(async () => {
					const app = (window as any).app;
					const file = app.vault.getAbstractFileByPath("WSL clipboard verification.md");
					return file ? await app.vault.read(file) : "";
				});
				return String(text) === selectionText;
			}, {
				timeout: 10_000,
				timeoutMsg: "Windows clipboard selection did not paste into an Obsidian note through X410",
			});
			await browser.execute(async () => {
				const app = (window as any).app;
				const file = app.vault.getAbstractFileByPath("WSL clipboard verification.md");
				if (file) await app.vault.delete(file);
				await app.plugins.plugins.opencode.activateTerminalView();
			});

			await clipboard.writeText(pastedText);
			await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				view.__wslClipboardInput = [];
				view.__wslClipboardOriginalWrite = view.ptySession.writeStdin;
				view.ptySession.writeStdin = (data: string) => view.__wslClipboardInput.push(data);
				view.terminal.textarea.dispatchEvent(new KeyboardEvent("keydown", {
					key: "v",
					code: "KeyV",
					ctrlKey: true,
					bubbles: true,
					cancelable: true,
				}));
			});
			await browser.waitUntil(() => browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				return view.__wslClipboardInput.length > 0;
			}), { timeout: 10_000, timeoutMsg: "Windows clipboard text did not reach xterm input" });
			const pastedInput = await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				view.ptySession.writeStdin = view.__wslClipboardOriginalWrite;
				return view.__wslClipboardInput.join("");
			});
			expect(pastedInput).toContain("Windows paste é中😀\rsecond line");

			await clipboard.writeImagePng!(png);
			await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				view.__wslClipboardInput = [];
				view.__wslClipboardOriginalWrite = view.ptySession.writeStdin;
				view.ptySession.writeStdin = (data: string) => view.__wslClipboardInput.push(data);
				view.terminal.textarea.dispatchEvent(new KeyboardEvent("keydown", {
					key: "v",
					code: "KeyV",
					ctrlKey: true,
					bubbles: true,
					cancelable: true,
				}));
			});
			await browser.waitUntil(() => browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				return view.__wslClipboardInput.length > 0;
			}), { timeout: 10_000, timeoutMsg: "Windows clipboard image did not reach OpenCode as a path" });
			const pastedImagePath = await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				view.ptySession.writeStdin = view.__wslClipboardOriginalWrite;
				return view.__wslClipboardInput.join("");
			});
			expect(pastedImagePath).toMatch(/^\/tmp\/obsidian-opencode-clipboard-[^/]+\/clipboard-\d+\.png$/);
			expect(existsSync(pastedImagePath)).toBe(true);
			const pastedImage = readFileSync(pastedImagePath);
			expect(pastedImage.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
			expect(pastedImage.readUInt32BE(16)).toBe(1);
			expect(pastedImage.readUInt32BE(20)).toBe(1);

			await browser.executeAsync((text: string, done: () => void) => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				const encoded = Buffer.from(text, "utf8").toString("base64");
				view.terminal.write(`\x1b]52;c;${encoded}\x07`, done);
			}, oscText);
			await browser.waitUntil(async () => (await clipboard.readText()) === oscText, {
				timeout: 10_000,
				timeoutMsg: "OSC 52 text did not reach the Windows clipboard",
			});
		} finally {
			await clipboard.writeText(originalClipboard);
			await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view;
				if (view?.__wslClipboardOriginalWrite) {
					view.ptySession.writeStdin = view.__wslClipboardOriginalWrite;
				}
			});
		}
	});

	it("[issue #52] launches formal OpenCode V2 under WSL2/X410", async function () {
		if (!isWsl2() || process.env.OPENCODE_REAL_E2E !== "1") this.skip();
		const profile = mkdtempSync(path.join(tmpdir(), "obsidian-opencode-v2-e2e-"));
		const executable = resolveOpencodeExecutable("opencode");
		const clipboard = createWslWindowsClipboard();
		if (!clipboard) throw new Error("WSL2 was detected without a Windows clipboard bridge");
		const originalImage = await clipboard.readImagePng!();
		const originalText = originalImage ? null : await clipboard.readText();
		const previous = await browser.execute(async (opencodePath: string, profileDirectory: string) => {
			const plugin = (window as any).app.plugins.plugins.opencode;
			const settings = {
				opencodePath: plugin.settings.opencodePath,
				newSessionArgs: plugin.settings.newSessionArgs,
				environmentVariables: { ...plugin.settings.environmentVariables },
			};
			plugin.settings.opencodePath = opencodePath;
			plugin.settings.newSessionArgs = "--standalone";
			plugin.settings.environmentVariables = {
				...plugin.settings.environmentVariables,
				XDG_DATA_HOME: `${profileDirectory}/data`,
				XDG_CONFIG_HOME: `${profileDirectory}/config`,
				XDG_CACHE_HOME: `${profileDirectory}/cache`,
			};
			await plugin.saveSettings();
			await plugin.newSession();
			return settings;
		}, executable, profile);

		try {
			await expect(browser.$(".opencode-terminal-container .xterm")).toExist();
			await waitForTerminalText("Ask anything");
			const textarea = browser.$(".opencode-terminal-container .xterm-helper-textarea");
			await textarea.click();
			await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				view.terminal.paste("WSL2 formal V2 input é中😀");
			});
			await waitForTerminalText("WSL2 formal V2 input é中😀");
			await clipboard.writeImagePng!(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
			await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				view.terminal.textarea.dispatchEvent(new KeyboardEvent("keydown", {
					key: "v",
					code: "KeyV",
					ctrlKey: true,
					bubbles: true,
					cancelable: true,
				}));
			});
			await waitForTerminalText("Image 1]");
		} finally {
			if (originalImage) await clipboard.writeImagePng!(originalImage);
			else await clipboard.writeText(originalText ?? "");
			await browser.execute(async (settings: typeof previous) => {
				const plugin = (window as any).app.plugins.plugins.opencode;
				await plugin.viewCoordinator.closeTerminal();
				plugin.settings.opencodePath = settings.opencodePath;
				plugin.settings.newSessionArgs = settings.newSessionArgs;
				plugin.settings.environmentVariables = settings.environmentVariables;
				await plugin.saveSettings();
				await plugin.activateTerminalView();
			}, previous);
			rmSync(profile, { recursive: true, force: true });
		}
	});

	it("[issue #22] resizes the running Windows ConPTY", async function () {
		if (process.platform !== "win32") this.skip();
		await browser.execute(async (cmdStubPath: string) => {
			const app = (window as any).app;
			const plugin = app.plugins.plugins.opencode;
			plugin.settings.opencodePath = cmdStubPath;
			await plugin.saveSettings();
			await plugin.newSession();
		}, opencodeCmdStub);
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

	it("[issue #36] reports terminal and cell pixel geometry to OpenCode 2", async function () {
		await browser.executeObsidianCommand("opencode:open-terminal");
		await expect(browser.$(".opencode-terminal-container .xterm")).toExist();
		await browser.pause(100);

		const result = await browser.execute(async () => {
			const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			const replies: string[] = [];
			const originalWriteStdin = view.ptySession.writeStdin;
			view.ptySession.writeStdin = (data: string) => replies.push(data);
			try {
				await new Promise<void>((resolve) => view.terminal.write("\x1b[c\x1b[14t\x1b[16t", resolve));
				await new Promise((resolve) => window.setTimeout(resolve, 25));
			} finally {
				view.ptySession.writeStdin = originalWriteStdin;
			}
			return {
				replies,
				rows: view.terminal.rows,
				cols: view.terminal.cols,
			};
		});

		expect(result.replies).toContain("\x1b[?62;4;9;22c");
		const windowReply = result.replies.find((reply) => reply.startsWith("\x1b[4;"));
		expect(windowReply).toBeDefined();
		const [, windowHeight, windowWidth] = windowReply!.match(/^\x1b\[4;(\d+);(\d+)t$/) ?? [];
		const cellReply = result.replies.find((reply) => reply.startsWith("\x1b[6;"));
		expect(cellReply).toBeDefined();
		const [, height, width] = cellReply!.match(/^\x1b\[6;(\d+);(\d+)t$/) ?? [];
		expect(Number(height)).toBeGreaterThan(0);
		expect(Number(width)).toBeGreaterThan(0);
		expect(Math.abs(Number(windowHeight) - Number(height) * result.rows))
			.toBeLessThanOrEqual(result.rows / 2 + 1);
		expect(Math.abs(Number(windowWidth) - Number(width) * result.cols))
			.toBeLessThanOrEqual(result.cols / 2 + 1);
	});

	it("[issues #36, #54] negotiates SIXEL and copies a rendered image to Windows under WSL2", async function () {
		if (process.platform === "win32") this.skip();
		const previousExecutable = await browser.execute(async (stubPath: string): Promise<string> => {
			const plugin = (window as any).app.plugins.plugins.opencode;
			const previous = String(plugin.settings.opencodePath ?? "");
			plugin.settings.opencodePath = stubPath;
			await plugin.saveSettings();
			await plugin.newSession();
			return previous;
		}, opentuiImageStub);
		try {
			await expect(browser.$(".opencode-terminal-container .xterm")).toExist();
			await waitForTerminalText("SIXEL_READY");
			await browser.waitUntil(() => browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view;
				return (view?.imageAddon?.storageUsage ?? 0) > 0;
			}), { timeout: 10_000, timeoutMsg: "The embedded terminal did not render the SIXEL image" });
			const imageSize = await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				for (let y = 0; y < view.terminal.buffer.active.length; y++) {
					for (let x = 0; x < view.terminal.cols; x++) {
						const image = view.imageAddon.getImageAtBufferCell(x, y);
						if (image) return { width: image.width, height: image.height };
					}
				}
				return null;
			});
			expect(imageSize).toEqual({ width: 32, height: 16 });
			await browser.saveScreenshot(path.join(artifactsDir, "opentui-sixel-preview.png"));

			if (isWsl2()) {
				const clipboard = createWslWindowsClipboard();
				if (!clipboard) throw new Error("WSL2 was detected without a Windows clipboard bridge");
				const originalImage = await clipboard.readImagePng!();
				const originalText = originalImage ? null : await clipboard.readText();
				try {
					const dispatched = await browser.execute(() => {
						const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
						const screen = view.terminal.element.querySelector(".xterm-screen");
						const rect = screen.getBoundingClientRect();
						const buffer = view.terminal.buffer.active;
						for (let y = buffer.viewportY; y < buffer.viewportY + view.terminal.rows; y++) {
							for (let x = 0; x < view.terminal.cols; x++) {
								if (!view.imageAddon.getImageAtBufferCell(x, y)) continue;
								screen.dispatchEvent(new MouseEvent("contextmenu", {
									clientX: rect.left + (x + 0.5) * rect.width / view.terminal.cols,
									clientY: rect.top + (y - buffer.viewportY + 0.5) * rect.height / view.terminal.rows,
									button: 2,
									bubbles: true,
									cancelable: true,
								}));
								return true;
							}
						}
						return false;
					});
					expect(dispatched).toBe(true);
					let copiedImage: Buffer | null = null;
					await browser.waitUntil(async () => {
						copiedImage = await clipboard.readImagePng!();
						return Boolean(copiedImage && copiedImage.readUInt32BE(16) === 32 && copiedImage.readUInt32BE(20) === 16);
					}, { timeout: 10_000, timeoutMsg: "Rendered SIXEL image did not reach the Windows clipboard" });
				} finally {
					if (originalImage) await clipboard.writeImagePng!(originalImage);
					else await clipboard.writeText(originalText ?? "");
				}
			}
		} finally {
			await browser.execute(async (opencodePath: string) => {
				const plugin = (window as any).app.plugins.plugins.opencode;
				plugin.settings.opencodePath = opencodePath;
				await plugin.saveSettings();
			}, previousExecutable);
		}
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

	it("[smoke] closes the terminal through its configurable Obsidian command", async function () {
		await browser.executeObsidianCommand("opencode:open-terminal");
		await expect(browser.$(".opencode-terminal-container .xterm")).toExist();
		expect(await browser.execute(() => (
			(window as any).app.workspace.getLeavesOfType("opencode-terminal").length
		))).toBe(1);
		await browser.executeObsidianCommand("opencode:close-terminal");
		await browser.waitUntil(() => browser.execute(() => (
			(window as any).app.workspace.getLeavesOfType("opencode-terminal").length === 0
		)), { timeoutMsg: "OpenCode terminal did not close" });
	});
});
