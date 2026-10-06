import * as path from "node:path";
import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import multicolumnTableNotes from "../fixtures/multicolumn-table-notes";
import sidebarTableHttp from "../fixtures/sidebar-table-http";
import tableHttpLinks from "../fixtures/table-http-links";

const notePath = "Terminal links/中文 My note.md";
const mixedFragments = [
	"study/Science/formal sciences/mathematics/pure mathematics/",
	"analysis/calculus/Single-variable integral calculus/",
	"definite integral/mean value theorems of definite",
	"integrals/second mean value theorem for definite integrals.",
	"md",
];
const mixedNotePath = mixedFragments.slice(0, 3).join("") + " " + mixedFragments.slice(3).join("");
const tableFragments = [
	"study/Science/formal sciences/mathematics/pure",
	"mathematics/analysis/calculus/Single-variable",
	"integral calculus/definite integral/mean value",
	"theorems of definite integrals/mean value",
	"theorems of definite integrals.md",
];
const tableNotePath = tableFragments.join(" ");
const tableArticlePath = "resources/raindropio-bookmarks/NEWS/Linux Foundation Announces the Formation of the Agentic AI Foundation (AAIF), Anchored by New Project Contributions Including Model Context Protocol (MCP), goose and AGENTS.md.md";
const articleFragments = Array.from({ length: Math.ceil(tableArticlePath.length / 47) }, (_, row) => tableArticlePath.slice(row * 47, (row + 1) * 47));
const stub = path.resolve(`test/fixtures/opencode-stub${process.platform === "win32" ? ".cmd" : ""}`);

async function render(text: string, mouse = false, wrap = false): Promise<void> {
	await browser.action("pointer").move({ x: 10, y: 10, origin: "viewport" }).perform();
	await browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.fitAddon.fit());
	// Opening notes and changing fixture fonts can schedule another fit after
	// this one. Settle real screen geometry before writing and locating cells.
	let previousGeometry = "", stableSince = Date.now();
	await browser.waitUntil(async () => {
		const geometry = await browser.execute(() => {
			const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
			const rect = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
			return JSON.stringify([terminal.cols, terminal.rows, rect.left, rect.top, rect.width, rect.height]);
		});
		if (geometry !== previousGeometry) { previousGeometry = geometry; stableSince = Date.now(); }
		return Date.now() - stableSince >= 300;
	}, { timeoutMsg: "Terminal fixture geometry did not settle" });
	await browser.executeAsync((text: string, mouse: boolean, wrap: boolean, done: () => void) => {
		const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
		view.terminal.clearSelection();
		view.fitAddon.fit();
		if (wrap) text = " ".repeat(Math.max(0, view.terminal.cols - 12)) + text;
		view.terminal.write(`\x1bc\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l${mouse ? "\x1b[?1000h\x1b[?1006h" : ""}${text}`, () => {
			// Background windows can suspend animation frames indefinitely.
			// Parsing must finish first; pointer/canvas assertions below still
			// verify the painted result instead of trusting this deadline.
			let settled = false;
			const finish = () => { if (!settled) { settled = true; clearTimeout(deadline); done(); } };
			const deadline = setTimeout(finish, 250);
			requestAnimationFrame(() => requestAnimationFrame(finish));
		});
	}, text, mouse, wrap);
}

async function linkPoint(text: string, end = false): Promise<{ x: number; y: number; range: any }> {
	return browser.execute((text: string, end: boolean) => {
		const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
		const terminal = view.terminal;
		const matches: any[] = [];
		for (let y = 1; y <= terminal.buffer.active.length; y++) {
			view.terminalLinks.provideLinks(y, (links: any[]) => {
				for (const value of links ?? []) if (value.text === text) matches.push(value);
			});
		}
		const link = end ? matches[matches.length - 1] : matches[0];
		if (!link) throw new Error(`Actual terminal provider did not find ${text}; cols=${terminal.cols}; rows=${JSON.stringify(Array.from({ length: terminal.buffer.active.length }, (_, y) => terminal.buffer.active.getLine(y)?.translateToString(true)))}`);
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
	// xterm 5.5 keeps same-row provider replies after mouseleave/redraw.
	// Cross another buffer row to request fresh hover decoration for this frame.
	const neutral = await browser.execute((point: { y: number }) => {
		const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
		const rect = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
		const height = rect.height / terminal.rows;
		const row = Math.floor((point.y - rect.top) / height) === 0 ? 1 : 0;
		return { x: Math.round(rect.left + rect.width / terminal.cols / 2), y: Math.round(rect.top + (row + 0.5) * height) };
	}, point);
	await browser.action("pointer").move({ ...neutral, origin: "viewport" }).perform();
	await browser.action("pointer").move({ x: point.x, y: point.y, origin: "viewport" }).perform();
	const mouseReporting = await browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.modes.mouseTrackingMode !== "none");
	try {
		// xterm may reuse a same-row hover cache across redraws outside the
		// pointer. TUI activation uses fresh buffer hit testing and must not
		// depend on decorative hover state; verify its real input effects below.
		if (!mouseReporting) await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector(".opencode-terminal .xterm-cursor-pointer"))), { timeoutMsg: "xterm did not hover link under pointer" });
	} catch (error) {
		const context = await browser.execute((point: { x: number; y: number }) => {
			const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			const terminal = view.terminal;
			const rect = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
			return { point, hit: document.elementFromPoint(point.x, point.y)?.outerHTML.slice(0, 300), cols: terminal.cols, rows: terminal.rows,
				rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, hovered: view.terminalLinks.hovered?.text,
				xterm: { cell: terminal._core.linkifier?._lastBufferCell, activeLine: terminal._core.linkifier?._activeLine, out: terminal._core.linkifier?._isMouseOut, current: terminal._core.linkifier?._currentLink?.link?.text,
					coords: terminal._core._mouseService?.getCoords({ clientX: point.x, clientY: point.y }, terminal.element.querySelector(".xterm-screen"), terminal.cols, terminal.rows),
					providers: Array.from(terminal._core.linkifier?._activeProviderReplies ?? [], ([key, links]: any) => ({ key, links: links?.map((l: any) => ({ text: l.link.text, range: l.link.range })) })) },
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
		expect(await browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.modes.mouseTrackingMode)).toBe("vt200");
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
		await browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.focus());
		const start = await linkPoint("https://github.com");
		const end = await linkPoint("https://github.com", true);
		try {
			await browser.action("pointer").move({ x: start.x, y: start.y, origin: "viewport" }).down({ button: 0 })
				.move({ x: Math.round((start.x + end.x) / 2), y: end.y, origin: "viewport", duration: 100 }).pause(50)
				.move({ x: end.x, y: end.y, origin: "viewport", duration: 100 }).pause(100).perform(true);
			await browser.waitUntil(() => browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.hasSelection()), { timeoutMsg: "Native pointer drag did not select terminal text" });
			await browser.action("pointer").up({ button: 0 }).perform();
		} finally { await browser.releaseActions(); }
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
		// xterm filters the unsafe OSC 8 provider, then offers a lower-priority
		// textual URL from its label. Activation must still honor the real URI.
		await render("\x1b]8;;javascript:alert(1)\x07https://github.com\x1b]8;;\x07");
		const labelPoint = await linkPoint("https://github.com");
		await browser.action("pointer").move({ x: labelPoint.x, y: labelPoint.y, origin: "viewport" }).down({ button: 0 }).up({ button: 0 }).perform();
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
	it("opens note paths wrapped by OpenCode into indented hard rows", async function () {
		const text = `${notePath}:3:5`;
		await render("  - Terminal links/\r\n    中文 My note.md:3:5 — session summary", true);
		const point = await linkPoint(text, true);
		const first = await linkPoint(text);
		expect(first.range.start.y).toBeLessThan(point.range.end.y);
		await browser.execute(() => { (window as any).__terminalLinkInput = []; });
		await clickLink(text, true, true);
		await waitActivation(() => browser.execute((notePath: string) => (window as any).app.workspace.getActiveFile()?.path === notePath, notePath));
		const cursor = await browser.execute(() => (window as any).app.workspace.activeLeaf.view.editor.getCursor());
		expect(cursor.line).toBe(2);
		expect(cursor.ch).toBe(4);
		expect(await browser.execute(() => (window as any).__terminalLinkInput)).toEqual([]);
	});
	const noteLayouts: Array<{ kind: string; note: string; lines: string[]; linkRows?: number[] }> = [
		{ kind: "paragraph", note: mixedNotePath, lines: mixedFragments.map(fragment => `     ${fragment}`) },
		{ kind: "table", note: tableNotePath, lines: tableFragments.map((fragment, row) => `     │ ${row === 0 ? "215" : "   "}   │ ${fragment.padEnd(47)} │    `) },
		{ kind: "table with punctuation", note: tableArticlePath, lines: articleFragments.map((fragment, row) => `     │ ${row === 0 ? "214" : "   "}   │ ${fragment.padEnd(47)} │    `) },
		{ kind: "table with split extension", note: "study/AGENTS.md.md", lines: ["study/AGENTS.md", ".md"].map(fragment => `     │ ${fragment.padEnd(47)} │    `) },
		...multicolumnTableNotes.map(record => ({ kind: "multi-column table", note: record.note, lines: record.lines, linkRows: record.fragments.map((_, row) => row + 2) })),
	];
	for (const layout of noteLayouts) it(`opens the full ${layout.linkRows?.length ?? layout.lines.length}-row ${layout.kind} note from every row: ${layout.note}`, async function () {
		const originalFont = await browser.execute((compact: boolean) => {
			const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
			const font = terminal.options.fontSize ?? 14;
			if (compact) terminal.options.fontSize = 10;
			return font;
		}, layout.kind === "multi-column table");
		await browser.execute(async (note: string) => {
			const app = (window as any).app;
			const folders = note.split("/").slice(0, -1);
			for (let i = 1; i <= folders.length; i++) {
				const folder = folders.slice(0, i).join("/");
				if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
			}
			await app.vault.create(note, "mixed wrap regression\n");
		}, layout.note);
		try {
			await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				view.terminal.element.parentElement.style.width = "700px";
				view.fitAddon.fit();
			});
			await browser.execute(() => { (window as any).__terminalLinkInput = []; });
			for (const row of layout.linkRows ?? layout.lines.map((_, index) => index + 1)) {
				// Opening a tab resizes the test stub PTY, which can write another
				// frame. Restore this fixture before each independent row click.
				await render(layout.lines.join("\r\n"), true);
				const point = await browser.execute((row: number, note: string) => {
					const app = (window as any).app;
					const view = app.workspace.getLeavesOfType("opencode-terminal")[0].view;
					const terminal = view.terminal;
					let link: any;
					view.terminalLinks.provideLinks(row, (found: any[]) => { link = found?.find(value => value.text === note); });
					if (!link) throw new Error(`Missing full note target on row ${row}; cols=${terminal.cols}; rows=${JSON.stringify(Array.from({ length: terminal.buffer.active.length }, (_, y) => terminal.buffer.active.getLine(y)?.translateToString(true)))}`);
					const rect = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
					return { x: Math.round(rect.left + (link.range.start.x - 0.5) * rect.width / terminal.cols),
						y: Math.round(rect.top + (row - 0.5) * rect.height / terminal.rows),
						tabs: app.workspace.getLeavesOfType("markdown").length };
				}, row, layout.note);
				if (layout.kind === "multi-column table" && row === 2) {
					await browser.action("pointer").move({ x: point.x, y: point.y, origin: "viewport" }).perform();
					await browser.waitUntil(() => browser.execute((note: string, count: number) => {
						const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
						return view.terminalLinks.hovered?.text === note && document.querySelectorAll(".opencode-terminal-link-underline").length === count;
					}, layout.note, Number(layout.linkRows?.length)));
					const bounds = await browser.execute(() => {
						const t = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
						const screen = t.element.querySelector(".xterm-screen"), rect = screen.getBoundingClientRect();
						return Array.from(screen.querySelectorAll(".opencode-terminal-link-underline"), (element: HTMLElement) => {
							const line = element.getBoundingClientRect();
							return { left: (line.left - rect.left) / (rect.width / t.cols), width: line.width / (rect.width / t.cols) };
						});
					});
					for (let index = 0; index < bounds.length; index++) {
						expect(bounds[index].left).toBeCloseTo(39, 1);
						expect(bounds[index].width).toBeCloseTo(layout.lines[index + 1].split("│")[2].trim().length, 1);
					}
				}
				await browser.action("key").down(process.platform === "darwin" ? Key.Command : Key.Control).perform(true);
				try {
					await browser.action("pointer").move({ x: point.x, y: point.y, origin: "viewport" }).down({ button: 0 }).up({ button: 0 }).perform();
				} finally { await browser.releaseActions(); }
				await waitActivation(() => browser.execute((note: string, tabs: number) => {
					const app = (window as any).app;
					return app.workspace.getActiveFile()?.path === note && app.workspace.getLeavesOfType("markdown").length === tabs + 1;
				}, layout.note, Number(point.tabs)));
				// Keep tab headers from wrapping and moving the terminal while
				// testing the next row. The new-tab assertion above remains real.
				await browser.execute((note: string) => {
					const app = (window as any).app;
					app.workspace.getLeavesOfType("markdown").filter((leaf: any) => leaf.view.file?.path === note).forEach((leaf: any) => leaf.detach());
				}, layout.note);
			}
			expect(await browser.execute(() => (window as any).__terminalLinkInput)).toEqual([]);
		} finally {
			await browser.execute((font: number) => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				view.terminal.options.fontSize = font;
				view.fitAddon.fit();
			}, Number(originalFont));
			await browser.execute(async (note: string) => {
				const app = (window as any).app;
				app.workspace.getLeavesOfType("markdown").filter((leaf: any) => leaf.view.file?.path === note).forEach((leaf: any) => leaf.detach());
				const folder = app.vault.getAbstractFileByPath(note.split("/")[0]);
				if (folder) await app.vault.delete(folder, true);
			}, layout.note);
		}
	});
	for (const layout of tableHttpLinks.flatMap(fixture => {
		const fragments = fixture.url.match(/.{1,29}/g)!;
		const start = sidebarTableHttp.lines.findIndex(row => row.split("│")[1]?.trim() === fixture.label);
		const end = sidebarTableHttp.lines.findIndex((row, index) => index > start && !row.includes("│"));
		const captured = sidebarTableHttp.lines.slice(start, end);
		return [
			{ fixture, kind: "wrapped table", startX: 12, fragments,
				rows: fragments.map((fragment, row) => `     │ ${row === 0 ? fixture.label : " "} │ ${fragment.padEnd(29)} │ ${row === 0 ? fixture.chars : "   "} │`) },
			{ fixture, kind: "captured sidebar table", startX: 28, rows: captured, fragments: captured.map(row => row.split("│")[2].trim()) },
		];
	})) it(`opens every row of ${layout.kind} HTTP URL ${layout.fixture.label} with bounded underlines`, async function () {
		const { fixture, fragments, rows, startX } = layout;
		const originalFont = await browser.execute((captured: boolean) => {
			const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
			const font = terminal.options.fontSize ?? 14;
			// Keep the captured 101-column frame intact in the smaller test window.
			if (captured) terminal.options.fontSize = 10;
			return font;
		}, layout.kind === "captured sidebar table");
		try {
			await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				view.terminal.element.parentElement.style.width = "700px";
				view.fitAddon.fit();
				(window as any).__terminalLinkExternal = [];
				(window as any).__terminalLinkInput = [];
			});
			await render(rows.join("\r\n"), true);
			for (let row = 1; row <= rows.length; row++) {
				const point = await browser.execute((row: number, url: string) => {
					const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
					const terminal = view.terminal;
					let link: any;
					view.terminalLinks.provideLinks(row, (found: any[]) => { link = found?.find(value => value.text === url); });
					if (!link) throw new Error(`Missing complete table URL on row ${row}`);
					const rect = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
					return { x: Math.round(rect.left + (link.range.start.x - 0.5) * rect.width / terminal.cols),
						y: Math.round(rect.top + (row - 0.5) * rect.height / terminal.rows), range: link.range };
				}, row, fixture.url);
				expect(point.range).toEqual({ start: { x: startX, y: row }, end: { x: startX - 1 + fragments[row - 1].length, y: row } });
				await browser.action("pointer").move({ x: point.x, y: point.y, origin: "viewport" }).perform();
				await browser.waitUntil(() => browser.execute((url: string, count: number) => {
					const provider = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminalLinks;
					return provider.hovered?.text === url && document.querySelectorAll(".opencode-terminal-link-underline").length === count;
				}, fixture.url, fragments.length));
				if (row === 1) {
					const underlines = await browser.execute(() => {
						const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
						const screen = terminal.element.querySelector(".xterm-screen"), rect = screen.getBoundingClientRect();
						return { cellWidth: rect.width / terminal.cols, cellHeight: rect.height / terminal.rows,
							lines: Array.from(screen.querySelectorAll(".opencode-terminal-link-underline"), (element: HTMLElement) => {
								const line = element.getBoundingClientRect();
								return { left: line.left - rect.left, width: line.width, top: line.top - rect.top };
							}) };
					});
					for (let index = 0; index < fragments.length; index++) {
						expect(underlines.lines[index].left).toBeCloseTo((startX - 1) * underlines.cellWidth, 1);
						expect(underlines.lines[index].width).toBeCloseTo(fragments[index].length * underlines.cellWidth, 1);
						expect(underlines.lines[index].top).toBeCloseTo((index + 1) * underlines.cellHeight - 2, 1);
					}
				}
				await browser.action("key").down(process.platform === "darwin" ? Key.Command : Key.Control).perform(true);
				try { await browser.action("pointer").move({ x: point.x, y: point.y, origin: "viewport" }).down({ button: 0 }).up({ button: 0 }).perform(); }
				finally { await browser.releaseActions(); }
				await waitActivation(async () => (await externalCalls()).length === row);
			}
			expect(await externalCalls()).toEqual(fragments.map(() => fixture.url));
			expect(await browser.execute(() => (window as any).__terminalLinkInput)).toEqual([]);
			await browser.action("pointer").move({ x: 10, y: 10, origin: "viewport" }).perform();
			await browser.waitUntil(() => browser.execute(() => document.querySelectorAll(".opencode-terminal-link-underline").length === 0));
		} finally {
			await browser.execute((font: number) => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				view.terminal.options.fontSize = font;
				view.fitAddon.fit();
			}, Number(originalFont));
		}
	});
	it("opens the complete HTTP URL from the first, middle and last TUI rows", async function () {
		const fragments = ["https://resources.anthropic.", "com/hubfs/", "Claude%20Code%20Advanced%20P", "atterns_%20Subagents%2C%20MC", "P%2C%20and%20Scaling%20to%20", "Real%20Codebases.pdf"];
		const url = fragments.join("");
		await browser.execute(() => {
			const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			const screen = view.terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
			const parent = view.terminal.element.parentElement;
			const padding = parent.getBoundingClientRect().width - screen.width;
			// Use cell geometry: the default font metrics differ on Windows.
			parent.style.width = `${padding + screen.width / view.terminal.cols * 35.5}px`;
			view.fitAddon.fit();
			// Account for the fit addon's platform scrollbar/padding rounding.
			for (let attempt = 0; attempt < 3 && view.terminal.cols !== 35; attempt++) {
				const cellWidth = view.terminal.element.querySelector(".xterm-screen").getBoundingClientRect().width / view.terminal.cols;
				parent.style.width = `${parseFloat(parent.style.width) - (view.terminal.cols - 35) * cellWidth}px`;
				view.fitAddon.fit();
			}
		});
		await render(fragments.map(fragment => `    ${fragment}`).join("\r\n"), true);
		expect(await browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.cols)).toBe(35);
		await browser.execute(() => { (window as any).__terminalLinkExternal = []; (window as any).__terminalLinkInput = []; });
		await clickLink(url, true);
		await clickLink(url, true, true);
		const middle = await browser.execute((url: string) => {
			const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
			const terminal = view.terminal;
			let link: any;
			view.terminalLinks.provideLinks(3, (found: any[]) => { link = found?.find(value => value.text === url); });
			if (!link) throw new Error("Missing middle-row URL link");
			const rect = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
			return { x: Math.round(rect.left + 6.5 * rect.width / terminal.cols), y: Math.round(rect.top + 2.5 * rect.height / terminal.rows), range: link.range };
		}, url);
		await browser.action("pointer").move({ x: middle.x, y: middle.y, origin: "viewport" }).perform();
		await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector(".opencode-terminal .xterm-cursor-pointer"))));
		const underlines = await browser.execute(() => {
			const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
			const screen = terminal.element.querySelector(".xterm-screen");
			const rect = screen.getBoundingClientRect();
			return { cellWidth: rect.width / terminal.cols, cellHeight: rect.height / terminal.rows,
				lines: Array.from(screen.querySelectorAll(".opencode-terminal-link-underline"), (element: HTMLElement) => {
					const line = element.getBoundingClientRect();
					return { left: line.left - rect.left, width: line.width, top: line.top - rect.top, height: line.height, pointer: getComputedStyle(element).pointerEvents };
				}) };
		});
		expect(underlines.lines).toHaveLength(fragments.length);
		for (let row = 0; row < fragments.length; row++) {
			const line = underlines.lines[row];
			expect(line.left).toBeCloseTo(4 * underlines.cellWidth, 1);
			expect(line.width).toBeCloseTo(fragments[row].length * underlines.cellWidth, 1);
			expect(line.top).toBeCloseTo((row + 1) * underlines.cellHeight - 2, 1);
			expect(line.height).toBe(1);
			expect(line.pointer).toBe("none");
		}
		await browser.action("key").down(process.platform === "darwin" ? Key.Command : Key.Control).perform(true);
		try { await browser.action("pointer").move({ x: middle.x, y: middle.y, origin: "viewport" }).down({ button: 0 }).up({ button: 0 }).perform(); }
		finally { await browser.releaseActions(); }
		await waitActivation(async () => (await externalCalls()).length === 3);
		expect(await externalCalls()).toEqual([url, url, url]);
		expect(await browser.execute(() => (window as any).__terminalLinkInput)).toEqual([]);
		await browser.action("pointer").move({ x: 10, y: 10, origin: "viewport" }).perform();
		await browser.waitUntil(() => browser.execute(() => document.querySelectorAll(".opencode-terminal-link-underline").length === 0));
	});

});
