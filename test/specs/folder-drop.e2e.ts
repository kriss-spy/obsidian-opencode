import * as path from "node:path";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveOpencodeExecutable } from "../../src/utils/opencodeExecutable";
import { browser, expect } from "@wdio/globals";
import { WebSocket } from "ws";

const stub = path.resolve(`test/fixtures/opencode-stub${process.platform === "win32" ? ".cmd" : ""}`);
const folder = "Folder drop 笔记";

// Build payloads with Obsidian's own drag manager and actual vault objects.
async function drop(paths: string[], multiple = false): Promise<void> {
	await browser.execute((paths: string[], multiple: boolean) => {
		const app = (window as any).app, manager = app.dragManager;
		const objects = paths.map(path => app.vault.getAbstractFileByPath(path));
		if (objects.some(file => !file)) throw new Error("Missing folder-drop fixture");
		const event = new DragEvent("dragstart", { dataTransfer: new DataTransfer() });
		const previous = manager.draggable;
		try {
			manager.draggable = multiple ? manager.dragFiles(event, objects, "file-explorer") : manager.dragFolder(event, objects[0], "file-explorer");
			const target = document.querySelector(".opencode-terminal-container");
			if (!target) throw new Error("Missing terminal drop target");
			target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: event.dataTransfer }));
		} finally { manager.draggable = previous; }
	}, paths, multiple);
}

async function dragFromExplorer(directory: string): Promise<void> {
	await browser.execute(async () => {
		const app = (window as any).app;
		const explorer = app.workspace.getLeavesOfType("file-explorer")[0];
		if (!explorer) throw new Error("File explorer is unavailable");
		app.workspace.leftSplit.expand();
		await app.workspace.revealLeaf(explorer);
	});
	const source = browser.$(`.nav-folder-title[data-path="${directory}"]`);
	await source.waitForDisplayed();
	const points = await browser.execute((directory: string) => {
		const source = document.querySelector(`.nav-folder-title[data-path="${directory}"]`)!.getBoundingClientRect();
		const target = document.querySelector(".opencode-terminal-container .xterm-screen")!.getBoundingClientRect();
		return { source: { x: Math.round(source.left + 60), y: Math.round(source.top + source.height / 2) },
			target: { x: Math.round(target.left + target.width / 2), y: Math.round(target.top + target.height / 2) } };
	}, directory);
	await browser.execute(() => {
		(window as any).__directoryDragTrace = [];
		const trace = (event: DragEvent) => (window as any).__directoryDragTrace.push({ type: event.type, target: (event.target as HTMLElement)?.className,
			path: (window as any).app.dragManager.draggable?.file?.path, x: event.clientX, y: event.clientY });
		for (const type of ["dragstart", "dragover", "drop", "dragend"]) document.addEventListener(type, trace as EventListener, true);
		(window as any).__directoryDragTraceCleanup = () => { for (const type of ["dragstart", "dragover", "drop", "dragend"]) document.removeEventListener(type, trace as EventListener, true); };
	});
	await browser.action("pointer").move({ ...points.source, origin: "viewport" }).down({ button: 0 })
		.move({ x: points.source.x + 15, y: points.source.y, origin: "viewport", duration: 150 })
		.move({ ...points.target, origin: "viewport", duration: 500 }).pause(100)
		.move({ x: points.target.x + 5, y: points.target.y + 5, origin: "viewport", duration: 100 }).pause(100).up({ button: 0 }).perform();
}

async function input(): Promise<string[]> {
	// Explorer activation can report focus changes; they are terminal protocol,
	// separate from the dropped prompt content. Keep every other input byte.
	return browser.execute(() => (window as any).__folderDropInput.filter((data: string) => data !== "\x1b[I" && data !== "\x1b[O"));
}

describe("folder drag and drop in an isolated vault", function () {
	before(async function () {
		await browser.execute(async (stub: string, folder: string) => {
			const app = (window as any).app, plugin = app.plugins.plugins.opencode;
			await app.vault.createFolder(folder);
			await app.vault.createFolder(`${folder}/子目录`);
			await app.vault.createFolder("FolderDropPlain");
			await app.vault.create(`${folder}/子目录/note.md`, "folder fixture\n");
			plugin.settings.opencodePath = stub;
			plugin.settings.defaultWorkingDirectory = "";
			await plugin.saveSettings();
			// Keep both the explorer and terminal visible while dragging in the
			// small test window; responsive sidebars can hide each other.
			await app.workspace.getLeaf(false).setViewState({ type: "opencode-terminal", active: true });
		}, stub, folder);
		await browser.waitUntil(() => browser.execute(() => {
			const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view;
			return !!view?.ptySession.getStdin() && view.editorServer?.port > 0;
		}));
		await browser.execute(() => {
			const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
			(window as any).__folderDropInput = [];
			(window as any).__folderDropSubscription = terminal.onData((data: string) => (window as any).__folderDropInput.push(data));
		});
	});

	after(async function () {
		await browser.execute(() => { (window as any).__folderDropSubscription?.dispose(); (window as any).__directoryDragTraceCleanup?.(); });
		await browser.executeObsidianCommand("opencode:close-terminal");
		await browser.execute(async (folder: string) => {
			const app = (window as any).app;
			for (const name of [folder, "FolderDropPlain"]) {
				const file = app.vault.getAbstractFileByPath(name);
				if (file) await app.vault.delete(file, true);
			}
		}, folder);
	});

	it("pastes folder text and preserves file references with a connected editor bridge", async function () {
		const port = await browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.editorServer.port);
		const socket = new WebSocket(`ws://127.0.0.1:${port}`);
		await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
		const messages: any[] = [];
		socket.on("message", data => messages.push(JSON.parse(data.toString())));
		try {
			await drop([folder]);
			await browser.waitUntil(async () => (await input()).length > 0);
			expect(await input()).toEqual([` ${folder}/ `]);
			await browser.execute(() => { (window as any).__folderDropInput = []; });
			await dragFromExplorer(folder);
			await browser.waitUntil(async () => (await input()).length > 0);
			expect(await input()).toEqual([` ${folder}/ `]);
			expect(messages).toEqual([]);
			await browser.execute(() => { (window as any).__folderDropInput = []; });
			await drop([`${folder}/子目录`, "Smoke.md", "FolderDropPlain"], true);
			await browser.waitUntil(async () => messages.length === 1 && (await input()).length === 2);
			expect(messages.map(message => message.params)).toEqual([
				{ filePath: "Smoke.md", lineStart: 1, lineEnd: 1 },
			]);
			expect(await input()).toEqual([` ${folder}/子目录/ `, " FolderDropPlain/ "]);
		} finally {
			await new Promise<void>(resolve => { socket.once("close", () => resolve()); socket.close(); });
			await browser.waitUntil(() => browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.editorServer.clients.size === 0));
		}
	});

	it("pastes the same plain folder text without an editor bridge", async function () {
		for (const target of ["FolderDropPlain", `${folder}/子目录`]) {
			await browser.execute(() => { (window as any).__folderDropInput = []; });
			await drop([target]);
			await browser.waitUntil(async () => (await input()).length > 0);
			const writes = await input();
			expect(writes).toEqual([` ${target}/ `]);
			expect(writes.join("")).not.toMatch(/[\r\n\t]/);
		}
	});
});


describe("folder drag and drop with installed OpenCode", function () {
	it("[real V2] shows plain explorer folder paths beside file line mentions", async function () {
		if (process.platform !== "linux" || process.env.OPENCODE_REAL_E2E !== "1") this.skip();
		const executable = resolveOpencodeExecutable("opencode");
		const profile = mkdtempSync(path.join(tmpdir(), "obsidian-opencode-folder-real-"));
		const directory = "Drop 笔记";
		const previous = await browser.execute(() => {
			const settings = (window as any).app.plugins.plugins.opencode.settings;
			return { ...settings, environmentVariables: { ...settings.environmentVariables } };
		});
		const buffer = () => browser.execute(() => {
			const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view.terminal;
			return terminal ? Array.from({ length: terminal.buffer.active.length }, (_, i) =>
				terminal.buffer.active.getLine(i)?.translateToString(true) ?? "").join("\n") : "";
		});
		const visible = async (reference: string) => {
			try {
				// OpenCode can wrap a mention across prompt rows, each with a drawn border.
				await browser.waitUntil(async () => (await buffer()).replace(/[┃\s]/g, "").includes(reference.replace(/\s/g, "")), {
					timeout: 10_000, timeoutMsg: `OpenCode did not display ${reference} in its prompt`,
				});
			} catch (error) { throw new Error(`${String(error)}\nTerminal buffer:\n${await buffer()}`); }
		};
		try {
			await browser.execute(async (executable: string, profile: string, directory: string) => {
				const app = (window as any).app, plugin = app.plugins.plugins.opencode;
				await plugin.viewCoordinator.closeTerminal();
				await app.vault.createFolder(directory);
				await app.vault.createFolder(`${directory}/nested`);
				await app.vault.create(`${directory}/nested/note.md`, "directory fixture\n");
				plugin.settings.opencodePath = executable;
				plugin.settings.defaultWorkingDirectory = "";
				plugin.settings.newSessionArgs = "--standalone";
				plugin.settings.environmentVariables = {
					XDG_CONFIG_HOME: `${profile}/config`, XDG_DATA_HOME: `${profile}/data`,
					XDG_CACHE_HOME: `${profile}/cache`, XDG_STATE_HOME: `${profile}/state`,
					OPENCODE_CONFIG_DIR: `${profile}/config/opencode`,
				};
				await plugin.saveSettings();
				plugin.sessionArgs = null;
				await app.workspace.getLeaf(false).setViewState({ type: "opencode-terminal", active: true });
			}, executable, profile, directory);
			await visible("Ask anything");
			await browser.waitUntil(() => browser.execute(() =>
				(window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.editorServer.clients.size === 1));
			// Establish that the existing v1 line-mention delivery still works.
			await drop(["Smoke.md"], true);
			await visible("Smoke.md#1");
			await dragFromExplorer(directory);
			await visible(`${directory}/`);
			expect(await buffer()).not.toContain(`@${directory}`);
			expect(await buffer()).not.toContain(`${directory}#1`);
			await drop([`${directory}/nested`, `${directory}/nested/note.md`], true);
			await visible(`${directory}/nested/`);
			await visible(`@${directory}/nested/note.md#1`);
			mkdirSync(path.resolve("test-results/obsidian"), { recursive: true });
			await browser.saveScreenshot(path.resolve("test-results/obsidian/real-folder-drop.png"));
		} finally {
			await browser.execute(async (payload: string) => {
				const { settings, directory } = JSON.parse(payload);
				(window as any).__directoryDragTraceCleanup?.();
				const app = (window as any).app, plugin = app.plugins.plugins.opencode;
				await plugin.viewCoordinator.closeTerminal();
				const folder = app.vault.getAbstractFileByPath(directory);
				if (folder) await app.vault.delete(folder, true);
				plugin.settings = settings;
				await plugin.saveSettings();
			}, JSON.stringify({ settings: previous, directory }));
			rmSync(profile, { recursive: true, force: true });
		}
	});
});
