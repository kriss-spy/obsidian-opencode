import * as path from "node:path";
import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const notePath = "Terminal links/中文 My note.md";
const stub = path.resolve(`test/fixtures/opencode-stub${process.platform === "win32" ? ".cmd" : ""}`);

async function render(text: string, mouse = false, wrap = false): Promise<void> {
	await browser.action("pointer").move({ x: 10, y: 10, origin: "viewport" }).perform();
	await browser.executeAsync((text: string, mouse: boolean, wrap: boolean, done: () => void) => {
		const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
		view.terminal.clearSelection();
		view.fitAddon.fit();
			if (wrap) text = " ".repeat(Math.max(0, view.terminal.cols - 12)) + text;
		view.terminal.write(`\x1bc\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l${mouse ? "\x1b[?1000h\x1b[?1006h" : ""}${text}`, () => {
			// xterm buffers the render after parsing; use its actual painted geometry.
			requestAnimationFrame(() => requestAnimationFrame(() => done()));
		});
	}, text, mouse, wrap);
}

async function linkPoint(text: string, end = false): Promise<{ x: number; y: number; range: any }> {
	return browser.execute((text: string, end: boolean) => {
		const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
		const terminal = view.terminal;
		let link: any;
		for (let y = 1; y <= terminal.buffer.active.length; y++) {
			view.terminalLinks.provideLinks(y, (links: any[]) => {
				link ??= links?.find((value: any) => value.text === text);
			});
		}
		if (!link) throw new Error(`Actual terminal provider did not find ${text}`);
		const cell = end ? link.range.end : link.range.start;
		const screen = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
		return {
			x: Math.round(screen.left + (cell.x - 0.5) * screen.width / terminal.cols),
			y: Math.round(screen.top + (cell.y - terminal.buffer.active.viewportY - 0.5) * screen.height / terminal.rows),
			range: link.range,
		};
	}, text, end);
}

async function clickLink(text: string, modified = false, end = false): Promise<void> {
	const point = await linkPoint(text, end);
	await browser.action("pointer").move({ x: point.x, y: point.y, origin: "viewport" }).perform();
	try {
		await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector(".opencode-terminal .xterm-cursor-pointer"))), { timeoutMsg: "xterm did not hover link under pointer" });
	} catch (error) {
		const context = await browser.execute((point: { x: number; y: number }) => {
			const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			const terminal = view.terminal;
			const rect = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
			return { point, hit: document.elementFromPoint(point.x, point.y)?.outerHTML.slice(0, 300), cols: terminal.cols, rows: terminal.rows,
				rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, hovered: view.terminalLinks.hovered?.text,
				buffer: Array.from({ length: terminal.buffer.active.length }, (_, row) => terminal.buffer.active.getLine(row)?.translateToString(true)) };
		}, point);
		throw new Error(`${String(error)} ${JSON.stringify(context)}`);
	}
	if (modified) await browser.action("key").down(process.platform === "darwin" ? Key.Command : Key.Control).perform(true);
	try {
		await browser.action("pointer").move({ x: point.x, y: point.y, origin: "viewport" }).down({ button: 0 }).up({ button: 0 }).perform();
	} finally {
		await browser.releaseActions();
	}
}

async function activationState(): Promise<string> {
	return JSON.stringify(await browser.execute(() => {
		const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view;
		const links = view?.terminalLinks;
		return { hovered: links?.hovered?.text, pressed: links?.pressed && { text: links.pressed.link.text, dragged: links.pressed.dragged, modified: links.pressed.modified, handled: links.pressed.handled },
			selected: view?.terminal.hasSelection(), mouse: view?.terminal.modes.mouseTrackingMode, cols: view?.terminal.cols, rows: view?.terminal.rows,
			external: (window as any).__terminalLinkExternal, input: (window as any).__terminalLinkInput,
			trace: (window as any).__terminalLinkTrace, activeFile: (window as any).app.workspace.getActiveFile()?.path, tabs: (window as any).app.workspace.getLeavesOfType("markdown").length };
	}));
}

async function waitActivation(predicate: () => Promise<boolean>): Promise<void> {
	try { await browser.waitUntil(predicate); }
	catch (error) { throw new Error(`${String(error)} ${await activationState()}`); }
}

async function externalCalls(): Promise<string[]> {
	return browser.execute(() => (window as any).__terminalLinkExternal);
}

describe("[issue #62] real xterm terminal links in an isolated vault", function () {
	before(async function () {
		await browser.executeObsidianCommand("opencode:close-terminal");
		await browser.execute(async (stub: string, notePath: string) => {
			const app = (window as any).app;
			const plugin = app.plugins.plugins.opencode;
			plugin.settings.opencodePath = stub;
			plugin.settings.defaultWorkingDirectory = "";
			await plugin.saveSettings();
			if (!app.vault.getAbstractFileByPath("Terminal links")) await app.vault.createFolder("Terminal links");
			if (!app.vault.getFileByPath(notePath)) await app.vault.create(notePath, "first\nsecond\nthird line for cursor\nfourth\n");
			const file = app.vault.getFileByPath("Smoke.md");
			if (file) await app.workspace.getLeaf(false).openFile(file);
		}, stub, notePath);
		await browser.executeObsidianCommand("opencode:open-terminal");
		await browser.waitUntil(() => browser.execute(() => {
			const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view;
			const buffer = view?.terminal?.buffer.active;
			return buffer && Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) ?? "").join("").includes("OpenCode isolated test stub");
		}));
		await browser.execute(() => {
			const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			(window as any).__terminalLinkExternal = [];
			(window as any).__terminalLinkInput = [];
			(window as any).__terminalLinkTrace = [];
			const trace = (kind: string, extra: any = {}) => (window as any).__terminalLinkTrace.push({ kind, revision: view.terminalLinks.revision,
				pressed: view.terminalLinks.pressed && { text: view.terminalLinks.pressed.link.text, dragged: view.terminalLinks.pressed.dragged, modified: view.terminalLinks.pressed.modified },
				hovered: view.terminalLinks.hovered?.text, selected: view.terminal.hasSelection(), ...extra });
			const originalActivate = view.terminalLinks.activate.bind(view.terminalLinks);
			view.terminalLinks.activate = async (text: string, event: MouseEvent) => {
				trace("activate", { text, x: event.clientX, y: event.clientY, modifier: event.ctrlKey || event.metaKey });
				await originalActivate(text, event);
				trace("activate-finished", { text });
			};
			const originalNote = view.terminalLinks.options.openNote;
			view.terminalLinks.options.openNote = async (target: any, event: MouseEvent) => {
				trace("open-note", { target });
				await originalNote(target, event);
				trace("note-opened", { file: (window as any).app.workspace.getActiveFile()?.path });
			};
			const mouseTrace = (event: MouseEvent) => {
				trace(event.type, { x: event.clientX, y: event.clientY, button: event.button, target: (event.target as HTMLElement)?.tagName });
			};
			window.addEventListener("mousedown", mouseTrace, true);
			window.addEventListener("mouseup", mouseTrace, true);
			(window as any).__terminalLinkTraceCleanup = () => {
				window.removeEventListener("mousedown", mouseTrace, true);
				window.removeEventListener("mouseup", mouseTrace, true);
			};
			(window as any).__terminalLinkLeaf = view.leaf.id;
			(window as any).__terminalLinkPid = view.ptySession.ptyProcess?.pid;
			// Only replace the external side effect. Provider, xterm mouse events,
			// filesystem validation and Obsidian note navigation remain real.
			view.terminalLinks.options.openExternal = async (url: string) => { (window as any).__terminalLinkExternal.push(url); };
			(window as any).__terminalLinkInputListener = view.terminal.onData((data: string) => { (window as any).__terminalLinkInput.push(data); });
		});
	});

	after(async function () {
		await browser.execute(() => { (window as any).__terminalLinkInputListener?.dispose(); (window as any).__terminalLinkTraceCleanup?.(); });
		await browser.executeObsidianCommand("opencode:close-terminal");
		await browser.execute(async () => {
			const app = (window as any).app;
			app.workspace.getLeavesOfType("markdown").filter((leaf: any) => leaf.view.file?.path.startsWith("Terminal links/")).forEach((leaf: any) => leaf.detach());
			const folder = app.vault.getAbstractFileByPath("Terminal links");
			if (folder) await app.vault.delete(folder, true);
		});
	});

	it("opens wrapped space/Unicode note paths and cursor locations while preserving terminal leaf/PTY", async function () {
		const text = `${notePath}:3:5`;
		await render(`Agent: \`${text}\``, false, true);
		const point = await linkPoint(text, true);
		expect(point.range.end.y).toBeGreaterThan(point.range.start.y);
		await clickLink(text, false, true);
		await waitActivation(() => browser.execute((notePath: string) => (window as any).app.workspace.getActiveFile()?.path === notePath, notePath));
		const state = await browser.execute(() => {
			const app = (window as any).app;
			const editor = app.workspace.activeLeaf.view.editor;
			const leaf = app.workspace.getLeavesOfType("opencode-terminal")[0];
			return { cursor: editor.getCursor(), leaf: leaf.id, sameLeaf: leaf.id === (window as any).__terminalLinkLeaf, samePid: leaf.view.ptySession.ptyProcess?.pid === (window as any).__terminalLinkPid };
		});
		expect(state.cursor).toEqual({ line: 2, ch: 4 });
		expect(state.sameLeaf).toBe(true);
		expect(state.samePid).toBe(true);
	});

	it("opens Cmd/Ctrl-click in a new tab and accepts absolute in-vault paths", async function () {
		const absolute = await browser.execute((notePath: string) => `${(window as any).app.plugins.plugins.opencode.vaultRoot.replace(/[\\/]+$/, "")}/${notePath}:999:999`, notePath);
		const tabCount = Number(await browser.execute(() => (window as any).app.workspace.getLeavesOfType("markdown").length));
		await render(`Side terminal: ${absolute}`);
		await clickLink(absolute, true, true);
		await waitActivation(() => browser.execute((tabCount: number) => (window as any).app.workspace.getLeavesOfType("markdown").length > tabCount, tabCount));
		const cursor = await browser.execute(() => (window as any).app.workspace.activeLeaf.view.editor.getCursor());
		expect(cursor.line).toBe(4);
		expect(cursor.ch).toBe(0);
	});

	it("uses the safe external opener for web links", async function () {
		await render("Agent response: https://github.com");
		await clickLink("https://github.com");
		await waitActivation(async () => (await externalCalls()).includes("https://github.com/"));
	});

	it("keeps ordinary TUI mouse input and takes only modifier-click link activation", async function () {
		await browser.execute(() => { (window as any).__terminalLinkInput = []; });
		const before = (await externalCalls()).length;
		await render("Side terminal: https://github.com", true);
		await clickLink("https://github.com");
		expect((await externalCalls()).length).toBe(before);
		await waitActivation(() => browser.execute(() => (window as any).__terminalLinkInput.some((data: string) => data.startsWith("\x1b[<"))));
		// Stub echoes PTY input; redraw a stable side-terminal frame before activation.
		await render("Side terminal: https://github.com", true);
		await browser.execute(() => { (window as any).__terminalLinkInput = []; });
		await clickLink("https://github.com", true);
		await waitActivation(async () => (await externalCalls()).length === before + 1);
		expect(await browser.execute(() => (window as any).__terminalLinkInput)).toEqual([]);
	});

	it("preserves text selection and rejects same-link drags", async function () {
		const before = (await externalCalls()).length;
		await render("https://github.com");
		const start = await linkPoint("https://github.com");
		const end = await linkPoint("https://github.com", true);
		await browser.action("pointer").move({ x: start.x, y: start.y, origin: "viewport" }).down({ button: 0 })
			.move({ x: end.x, y: end.y, origin: "viewport", duration: 200 }).up({ button: 0 }).perform();
		expect(await browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.hasSelection())).toBe(true);
		expect((await externalCalls()).length).toBe(before);
	});

	it("guards OSC 8 schemes and never provides outside-vault or unsupported-scheme file links", async function () {
		const before = (await externalCalls()).length;
		await render("\x1b]8;;https://github.com\x07safe label\x1b]8;;\x07");
		// OSC 8 comes from xterm's built-in provider, not our textual provider.
		const point = await browser.execute(() => {
			const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
			const rect = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
			return { x: Math.round(rect.left + rect.width / terminal.cols / 2), y: Math.round(rect.top + rect.height / terminal.rows / 2) };
		});
		await browser.action("pointer").move({ ...point, origin: "viewport" }).down({ button: 0 }).up({ button: 0 }).perform();
		await waitActivation(async () => (await externalCalls()).length === before + 1);
		await render("\x1b]8;;https://new.example\x07safe label\x1b]8;;\x07");
		await browser.action("pointer").move({ ...point, origin: "viewport" }).down({ button: 0 }).up({ button: 0 }).perform();
		await waitActivation(async () => (await externalCalls()).includes("https://new.example/"));
		await render("\x1b]8;;javascript:alert(1)\x07safe label\x1b]8;;\x07");
		await browser.action("pointer").move({ x: point.x + 2, y: point.y, origin: "viewport" }).down({ button: 0 }).up({ button: 0 }).perform();
		expect((await externalCalls()).length).toBe(before + 2);
		await render(`/outside/${notePath}\r\n../../${notePath}\r\nfile:///outside/${notePath}`);
		const found = await browser.execute(() => {
			const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			const found: string[] = [];
			for (let row = 1; row <= view.terminal.buffer.active.length; row++) view.terminalLinks.provideLinks(row, (links: any[]) => links?.forEach(link => found.push(link.text)));
			return found;
		});
		expect(found).toEqual([]);
	});
});
