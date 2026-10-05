import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { ILink, Terminal } from "@xterm/xterm";
import { currentOsc8Link } from "./xtermOsc8";
import { findTerminalLinks, resolveNoteTarget, safeWebUrl, TerminalLinks, TerminalLinkOptions } from "./terminalLinks";

const event = (properties: Partial<MouseEvent> = {}): MouseEvent => ({ button: 0, ctrlKey: false, metaKey: false, ...properties } as MouseEvent);
function options(properties: Partial<TerminalLinkOptions> = {}): TerminalLinkOptions {
	return {
		vaultRoot: "/vault", hasNote: value => ["Notes/Project.md", "Notes/My note.md", "中文/😀 é.md", "Other.md"].includes(value),
		openNote: vi.fn(async () => {}), openExternal: vi.fn(async () => {}), onError: vi.fn(),
		isModEvent: event => event.ctrlKey || event.metaKey,
		realpath: async value => value,
		...properties,
	};
}
// Real cell widths are separately covered by the app spec. This fake exercises the public provider contract.
function terminal(lines: Array<{ chars: string[]; widths?: number[]; wrapped?: boolean }>): Terminal {
	return {
		buffer: { active: { length: lines.length, viewportY: 0, getLine: (row: number) => {
			const data = lines[row];
			return data && { length: data.chars.length, isWrapped: data.wrapped ?? false, getCell: (col: number) => ({
				getChars: () => data.chars[col], getWidth: () => data.widths?.[col] ?? 1,
			}) };
		} } },
		cols: 24, rows: lines.length, hasSelection: () => false,
		modes: { mouseTrackingMode: "none" }, options: {},
	} as unknown as Terminal;
}
function links(provider: TerminalLinks, y = 1): ILink[] {
	let result: ILink[] = [];
	provider.provideLinks(y, value => { result = value ?? []; });
	return result;
}

describe("terminal link parsing and containment", () => {
	it.each(["https://github.com", "HTTP://example.com:80/a?q=1#part", "https://例子.测试/笔记"])("accepts explicit HTTP(S): %s", value => {
		expect(safeWebUrl(value)).not.toBeNull();
	});
	it.each(["javascript:alert(1)", "file:///vault/Notes/Project.md", "obsidian://open", "mailto:x@y", "obsidian:Other.md", "https://", "https://good.example/\nfile", "https://a.example/\u0000"])("rejects unsafe URL %s", value => {
		expect(safeWebUrl(value)).toBeNull();
	});
	it("parses one-based locations and normalizes relative separators", () => {
		expect(resolveNoteTarget("Notes\\Project.md:42:8", "/vault")).toEqual({ path: "Notes/Project.md", line: 42, column: 8 });
		expect(resolveNoteTarget("/vault/Notes/Project.md:42", "/vault")?.line).toBe(42);
		expect(resolveNoteTarget("Notes/../Other.md", "/vault")?.path).toBe("Other.md");
	});
	it.each(["/vault-other/Note.md", "/outside/Note.md", "../../outside.md", "Notes/../../../outside.md", "C:\\outside\\Note.md", "file:///vault/Note.md", "Note.md:0", "Note.md:2:0", "Note.md:99999999999999999999", "Note.md:2:3:4"])("rejects %s", value => {
		expect(resolveNoteTarget(value, "/vault")).toBeNull();
	});
	it("supports Windows drives, UNC roots and WSL automount paths without accepting other roots", () => {
		expect(resolveNoteTarget("c:\\VAULT\\Notes\\Project.md:7", "C:\\Vault")?.path).toBe("Notes/Project.md");
		expect(resolveNoteTarget("/mnt/c/Vault/Notes/Project.md", "C:\\Vault")?.path).toBe("Notes/Project.md");
		expect(resolveNoteTarget("C:\\Vault\\Notes\\Project.md", "/mnt/c/Vault")?.path).toBe("Notes/Project.md");
		expect(resolveNoteTarget("\\\\wsl.localhost\\Ubuntu\\home\\me\\vault\\Note.md", "/home/me/vault", "Ubuntu")?.path).toBe("Note.md");
		expect(resolveNoteTarget("\\\\wsl.localhost\\Other\\home\\me\\vault\\Note.md", "/home/me/vault", "Ubuntu")).toBeNull();
		expect(resolveNoteTarget("\\\\server\\share\\vault\\Note.md", "\\\\server\\share\\vault")?.path).toBe("Note.md");
		expect(resolveNoteTarget("\\\\other\\share\\vault\\Note.md", "\\\\server\\share\\vault")).toBeNull();
		expect(resolveNoteTarget("C:Note.md", "C:\\Vault")).toBeNull();
	});
	it("matches existing space/Unicode paths in prose and preserves locations", () => {
		const result = findTerminalLinks('Changed `Notes/My note.md:42:8`, and 中文/😀 é.md. Missing note.md.', options());
		expect(result.map(value => value.text)).toEqual(["Notes/My note.md:42:8", "中文/😀 é.md"]);
	});
	it("avoids prose false positives and never falls back from an absolute/traversal URL path", () => {
		expect(findTerminalLinks("This is ordinary prose.md", options())).toEqual([]);
		expect(findTerminalLinks("/outside/Notes/My note.md ../../Notes/My note.md file:///vault/Notes/Project.md", options())).toEqual([]);
	});
	it("recognizes paths surrounded by parentheses and Markdown link syntax", () => {
		expect(findTerminalLinks("(Notes/Project.md:42) [read note](Notes/My note.md:3:5)", options()).map(link => link.text))
			.toEqual(["Notes/Project.md:42", "Notes/My note.md:3:5"]);
	});
	it("keeps interior parentheses in quoted and Markdown note destinations", () => {
		const config = options({ hasNote: value => value === "Notes/My (draft).md" });
		expect(findTerminalLinks("`Notes/My (draft).md:3` [note](Notes/My (draft).md:3)", config).map(link => link.text))
			.toEqual(["Notes/My (draft).md:3", "Notes/My (draft).md:3"]);
		expect(findTerminalLinks("/outside/Notes/My (draft).md", config)).toEqual([]);
	});
	it("finds multiple absolute links and notes after URL paths", () => {
		expect(findTerminalLinks("/vault/Other.md /vault/Notes/My note.md https://example.com/a.md Other.md", options()).map(link => link.text))
			.toEqual(["/vault/Other.md", "/vault/Notes/My note.md", "https://example.com/a.md", "Other.md"]);
	});
	it("keeps balanced URL punctuation, trims sentence punctuation and excludes URL note fragments", () => {
		expect(findTerminalLinks("(https://example.com/a_(b)). https://example.com/Notes/Project.md", options()).map(link => link.text))
			.toEqual(["https://example.com/a_(b)", "https://example.com/Notes/Project.md"]);
	});
});

describe("public xterm provider and activation", () => {
	it("underlines all wrapped fragments together and removes them on leave/dispose", () => {
		const created: Array<{ style: Record<string, string>; remove: ReturnType<typeof vi.fn> }> = [];
		const screen = { ownerDocument: { createElement: () => {
			const element = { style: {}, remove: vi.fn() };
			created.push(element);
			return element;
		} }, appendChild: vi.fn() };
		const term = terminal([{ chars: Array.from("    https://resources.anthropic.") }, { chars: Array.from("    com/hubfs/") }]);
		Object.assign(term, { cols: 35, element: { querySelector: () => screen } });
		Object.assign(term.modes, { mouseTrackingMode: "any" });
		const provider = new TerminalLinks(term, options());
		const first = links(provider, 1)[0], second = links(provider, 2)[0];
		expect(first.decorations).toEqual({ pointerCursor: true, underline: false });
		first.hover!(event(), first.text);
		expect(created).toHaveLength(2);
		expect(created.map(element => element.style.width)).toEqual([`${28 / 35 * 100}%`, `${10 / 35 * 100}%`]);
		second.hover!(event(), second.text);
		expect(created).toHaveLength(4);
		expect(created[0].remove).toHaveBeenCalledOnce();
		first.leave!(event(), first.text);
		expect(created[2].remove).not.toHaveBeenCalled();
		second.leave!(event(), second.text);
		expect(created[2].remove).toHaveBeenCalledOnce();
		first.hover!(event(), first.text);
		provider.dispose();
		expect(created[4].remove).toHaveBeenCalledOnce();
	});
	it.each(["    ", " ┃  ", "  - "])("reconstructs a TUI-wrapped HTTP URL with prefix %s from every row without partial targets", async (prefix) => {
		const fragments = ["https://resources.anthropic.", "com/hubfs/", "Claude%20Code%20Advanced%20P", "atterns_%20Subagents%2C%20MC", "P%2C%20and%20Scaling%20to%20", "Real%20Codebases.pdf"];
		const rows = fragments.map((fragment, row) => ({ chars: Array.from(`${row === 0 || prefix.includes("┃") ? prefix : "    "}${fragment}`.padEnd(35)) }));
		const term = terminal(rows);
		Object.assign(term, { cols: 35 });
		Object.assign(term.modes, { mouseTrackingMode: "any" });
		const config = options();
		const provider = new TerminalLinks(term, config);
		for (let y = 1; y <= rows.length; y++) {
			expect(links(provider, y).map(link => link.text)).toEqual([fragments.join("")]);
			const link = links(provider, y)[0];
			expect(link.range).toEqual({ start: { x: 5, y }, end: { x: 4 + fragments[y - 1].length, y } });
			await link.activate(event({ ctrlKey: true }), link.text);
		}
		expect(config.openExternal).toHaveBeenCalledTimes(rows.length);
		expect(config.openExternal).toHaveBeenLastCalledWith(fragments.join(""));
		const stale = links(provider, 3)[0];
		rows[3].chars = Array.from("    changed output");
		await stale.activate(event({ ctrlKey: true }), stale.text);
		expect(config.openExternal).toHaveBeenCalledTimes(rows.length);
	});
	it("does not join a short complete URL to prose or another URL", () => {
		for (const url of ["https://example.com", "https://example.com/"]) for (const second of ["    following prose", "    anotherword", "    https://other.example", "  - Other.md", "     extraindent"]) {
			const term = terminal([{ chars: Array.from(`    ${url}`.padEnd(68)) }, { chars: Array.from(second.padEnd(68)) }]);
			Object.assign(term, { cols: 68 });
			Object.assign(term.modes, { mouseTrackingMode: "any" });
			expect(links(new TerminalLinks(term, options()))[0].text).toBe(url);
		}
	});
	it("keeps query strings, percent escapes and fragments across bullet/native wraps", () => {
		const rows = [{ chars: Array.from("  - https://example.com/a%") }, { chars: Array.from("    20b?query=long-") }, { chars: Array.from("value&x=1#part."), wrapped: true }];
		const term = terminal(rows);
		Object.assign(term, { cols: 28 });
		Object.assign(term.modes, { mouseTrackingMode: "any" });
		const provider = new TerminalLinks(term, options());
		for (const row of [1, 2, 3]) expect(links(provider, row).map(link => link.text)).toEqual(["https://example.com/a%20b?query=long-value&x=1#part"]);
		Object.assign(term.modes, { mouseTrackingMode: "none" });
		expect(links(provider, 1).map(link => link.text)).toEqual(["https://example.com/a%"]);
		expect(links(provider, 2)).toEqual([]);
	});
	it("blocks partial first-row URLs when a recognized continuation exceeds either bound", () => {
		for (const fragments of [
			["https://example.com/", ...Array(32).fill("continued/")],
			["https://example.com/", "x".repeat(4100)],
		]) {
			const term = terminal(fragments.map(fragment => ({ chars: Array.from(`    ${fragment}`.padEnd(25)) })));
			Object.assign(term, { cols: 25 });
			Object.assign(term.modes, { mouseTrackingMode: "any" });
			expect(links(new TerminalLinks(term, options()), 1)).toEqual([]);
		}
	});
	it("reconnects OpenCode's indented hard-row path layout using exact indexed notes", () => {
		const note = "study/AI/explore AI/agent/subjects/harness engineering/harness engineering.md";
		const rows = [
			{ chars: Array.from("     - study/AI/explore AI/agent/subjects/harness engineering/      ") },
			{ chars: Array.from("       harness engineering.md — added the case study") },
		];
		const term = terminal(rows);
		Object.assign(term.modes, { mouseTrackingMode: "any" });
		const config = options({ hasNote: value => value === note });
		const provider = new TerminalLinks(term, config);
		const first = links(provider, 1)[0];
		expect(first.text).toBe(note);
		expect(first.range.start).toEqual({ x: 8, y: 1 });
		expect(first.range.end).toEqual({ x: rows[0].chars.join("").trimEnd().length, y: 1 });
		expect(links(provider, 2)[0].range).toEqual({ start: { x: 8, y: 2 }, end: { x: 29, y: 2 } });
		rows[1].chars = Array.from("       other engineering.md — replaced output");
		first.activate(event(), first.text);
		expect(config.openNote).not.toHaveBeenCalled();
	});

	it("supports indented word and mid-word breaks while keeping ordinary output separate", () => {
		for (const [first, second] of [["  - Notes/My", "    note.md:3"], ["  - Notes/My no", "    te.md:3"]]) {
			const term = terminal([{ chars: Array.from(first) }, { chars: Array.from(second) }]);
			const provider = new TerminalLinks(term, options());
			expect(links(provider)).toEqual([]);
			Object.assign(term.modes, { mouseTrackingMode: "any" });
			expect(links(provider)[0].text).toBe("Notes/My note.md:3");
		}
	});

	it("combines TUI indentation with native xterm wraps in a continuation", () => {
		const term = terminal([
			{ chars: Array.from("  - Notes/") },
			{ chars: Array.from("    My ") },
			{ chars: Array.from("note.md:3:2"), wrapped: true },
		]);
		Object.assign(term.modes, { mouseTrackingMode: "any" });
		const provider = new TerminalLinks(term, options());
		for (const row of [1, 2, 3]) expect(links(provider, row)[0].text).toBe("Notes/My note.md:3:2");
	});

	it("prefers the whole wrapped path over a root basename and preserves following references", () => {
		const term = terminal([
			{ chars: Array.from("  - Notes/") },
			{ chars: Array.from("    My note.md:3, then Other.md") },
		]);
		Object.assign(term.modes, { mouseTrackingMode: "any" });
		const provider = new TerminalLinks(term, options({ hasNote: value => ["Notes/My note.md", "My note.md", "Other.md"].includes(value) }));
		expect(links(provider, 2).map(link => link.text)).toEqual(["Notes/My note.md:3", "Other.md"]);
	});

	it("does not reconnect missing, outside, differently indented or separate bullet paths", () => {
		for (const [first, second] of [
			["  - /outside/Notes/", "    My note.md"],
			["  - ../../Notes/", "    My note.md"],
			["  - file:///vault/Notes/", "    My note.md"],
			["  - Notes/", "     My note.md"],
			["  - Notes/", "  - My note.md"],
			["  - Notes/", "    Missing.md"],
		]) {
			const term = terminal([{ chars: Array.from(first) }, { chars: Array.from(second) }]);
			Object.assign(term.modes, { mouseTrackingMode: "any" });
			const provider = new TerminalLinks(term, options({ hasNote: value => ["Notes/My note.md", "My note.md"].includes(value) }));
			expect(links(provider, 1)).toEqual([]);
			const separate = second.startsWith("     ") || second.startsWith("  - ");
			expect(links(provider, 2).map(link => link.text)).toEqual(separate ? ["My note.md"] : []);
		}
	});

	it("returns links for each wrapped row using inclusive cell ranges", () => {
		const term = terminal([{ chars: Array.from("See Notes/My ") }, { chars: Array.from("note.md:42:8"), wrapped: true }]);
		const provider = new TerminalLinks(term, options());
		const first = links(provider), second = links(provider, 2);
		expect(first[0].text).toBe("Notes/My note.md:42:8");
		expect(first[0].range).toEqual({ start: { x: 5, y: 1 }, end: { x: 12, y: 2 } });
		expect(second[0].range).toEqual(first[0].range);
	});
	it("ignores null padding from an alternate-buffer viewport growth while retaining printed wrap spaces", () => {
		const term = terminal([
			{ chars: [...Array.from("See Notes/My "), ...Array(11).fill("")] },
			{ chars: [...Array.from("note.md:42:8"), ...Array(12).fill("")], wrapped: true },
		]);
		const provider = new TerminalLinks(term, options());
		expect(links(provider, 2)[0]).toMatchObject({ text: "Notes/My note.md:42:8", range: { start: { x: 5, y: 1 }, end: { x: 12, y: 2 } } });
	});
	it("maps CJK, surrogate pairs, combining chars and early wide wraps to cells", () => {
		const term = terminal([
			{ chars: ["中", "", "文", "", "/", ""] , widths: [2, 0, 2, 0, 1, 1] },
			{ chars: ["😀", "", " ", "é", ".", "m", "d"], widths: [2, 0, 1, 1, 1, 1, 1], wrapped: true },
		]);
		const provider = new TerminalLinks(term, options());
		expect(links(provider, 2)[0]).toMatchObject({ text: "中文/😀 é.md", range: { start: { x: 1, y: 1 }, end: { x: 7, y: 2 } } });
	});
	it("never joins hard line breaks and resolves fresh contents after reset", () => {
		const rows = [{ chars: Array.from("Notes/My ") }, { chars: Array.from("note.md") }];
		const provider = new TerminalLinks(terminal(rows), options());
		expect(links(provider)).toEqual([]);
		rows[0].chars = Array.from("Other.md");
		expect(links(provider)[0].text).toBe("Other.md");
		provider.dispose();
		expect(links(provider)).toEqual([]);
	});
	it("only opens HTTP(S) and never opens an absent/outside note", async () => {
		const config = options();
		const provider = new TerminalLinks(terminal([]), config);
		await provider.activate("https://github.com", event());
		await provider.activate("javascript:alert(1)", event());
		await provider.activate("file:///vault/Other.md", event());
		await provider.activate("/outside/Other.md", event());
		await provider.activate("Absent.md", event());
		expect(config.openExternal).toHaveBeenCalledExactlyOnceWith("https://github.com/");
		expect(config.openNote).not.toHaveBeenCalled();
	});
	it("opens notes with preserved location/modifier and rejects TUI owned clicks, selections and nonprimary buttons", async () => {
		const config = options();
		const term = terminal([]);
		const provider = new TerminalLinks(term, config);
		Object.defineProperty(term, "modes", { value: { mouseTrackingMode: "any" } });
		await provider.activate("Other.md:4:2", event());
		await provider.activate("Other.md:4:2", event({ button: 2, ctrlKey: true }));
		expect(config.openNote).not.toHaveBeenCalled();
		const click = event({ ctrlKey: true });
		await provider.activate("Other.md:4:2", click);
		expect(config.openNote).toHaveBeenCalledExactlyOnceWith({ path: "Other.md", line: 4, column: 2 }, click);
		vi.mocked(config.openNote).mockClear();
		term.hasSelection = () => true;
		await provider.activate("Other.md", click);
		expect(config.openNote).not.toHaveBeenCalled();
	});
	it("reports missing files without opening", async () => {
		const failing = options({ realpath: async () => { throw new Error("ENOENT"); } });
		await new TerminalLinks(terminal([]), failing).activate("Other.md", event());
		expect(failing.onError).toHaveBeenCalledOnce();
		expect(failing.openNote).not.toHaveBeenCalled();
	});
	it("ignores a completed asynchronous lookup after close", async () => {
		const resolves: Array<(value: string) => void> = [];
		const config = options({ realpath: () => new Promise(resolve => resolves.push(resolve)) });
		const provider = new TerminalLinks(terminal([]), config);
		const pending = provider.activate("Other.md", event());
		provider.dispose();
		resolves[0]("/vault"); resolves[1]("/vault/Other.md");
		await pending;
		expect(config.openNote).not.toHaveBeenCalled();
	});
});

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
describe("actual filesystem boundary checks", () => {
	it("allows an inside note and rejects a symlink escaping the vault", async () => {
		const directory = mkdtempSync(path.join(tmpdir(), "terminal-links-")); temporary.push(directory);
		const root = path.join(directory, "vault"); mkdirSync(root);
		writeFileSync(path.join(root, "Inside.md"), "inside");
		writeFileSync(path.join(directory, "Outside.md"), "outside");
		try { symlinkSync(path.join(directory, "Outside.md"), path.join(root, "Escape.md")); }
		catch (error) { if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") return; throw error; }
		const config = options({ vaultRoot: root, hasNote: () => true, realpath: undefined });
		const provider = new TerminalLinks(terminal([]), config);
		await provider.activate("Inside.md", event());
		await provider.activate("Escape.md", event());
		expect(config.openNote).toHaveBeenCalledExactlyOnceWith({ path: "Inside.md", line: undefined, column: undefined }, expect.anything());
	});
});

function interactionFixture(config = options()) {
	const term = terminal([{ chars: Array.from("https://github.com") }]);
	const listeners = new Map<string, (event: MouseEvent) => void>();
	const modes = { mouseTrackingMode: "none" };
	const subscriptions = new Map<string, () => void>();
	const disposers: Array<ReturnType<typeof vi.fn>> = [];
	const screen = { contains: () => true, getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 10 }) };
	Object.assign(term, {
		element: { querySelector: () => screen }, modes,
		registerLinkProvider: vi.fn(() => { const dispose = vi.fn(); disposers.push(dispose); return { dispose }; }),
		onResize: (fn: () => void) => { subscriptions.set("resize", fn); return { dispose: vi.fn() }; },
		onScroll: (fn: () => void) => { subscriptions.set("scroll", fn); return { dispose: vi.fn() }; },
		onWriteParsed: (fn: () => void) => { subscriptions.set("write", fn); return { dispose: vi.fn() }; },
	});
	const container = {
		ownerDocument: {
			addEventListener: (name: string, callback: (event: MouseEvent) => void) => listeners.set(name, callback),
			removeEventListener: (name: string) => listeners.delete(name),
		},
		addEventListener: (name: string, callback: (event: MouseEvent) => void) => listeners.set(name, callback),
		removeEventListener: (name: string) => listeners.delete(name),
	} as unknown as HTMLElement;
	const provider = new TerminalLinks(term, config);
	provider.attach(container);
	const link = links(provider)[0];
	const mouse = (name: string, properties: Partial<MouseEvent> = {}) => {
		const value = event({ clientX: 5, clientY: 5, target: {} as Node, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...properties });
		listeners.get(name)?.(value);
		return value;
	};
	return { term, provider, link, config, listeners, subscriptions, disposers, mouse, modes };
}

describe("mouse capture ownership and link lifecycle", () => {
	it("claims modifier link clicks before the TUI and leaves plain/non-link input alone", async () => {
		const context = interactionFixture();
		context.modes.mouseTrackingMode = "any";
		context.link.hover!(event(), context.link.text);
		const plain = context.mouse("mousedown");
		expect(plain.stopImmediatePropagation).not.toHaveBeenCalled();
		const down = context.mouse("mousedown", { ctrlKey: true });
		const up = context.mouse("mouseup", { ctrlKey: true });
		expect(down.stopImmediatePropagation).toHaveBeenCalledOnce();
		expect(up.stopImmediatePropagation).toHaveBeenCalledOnce();
		expect(context.config.openExternal).toHaveBeenCalledExactlyOnceWith("https://github.com/");
		const outside = context.mouse("mousedown", { ctrlKey: true, clientX: 235 });
		expect(outside.stopImmediatePropagation).not.toHaveBeenCalled();
	});
	it("rejects movement within the same link with and without modifiers", () => {
		for (const modified of [false, true]) {
			const context = interactionFixture();
			context.link.hover!(event(), context.link.text);
			context.mouse("mousedown", { ctrlKey: modified });
			context.mouse("mousemove", { clientX: 65, ctrlKey: modified });
			if (modified) context.mouse("mouseup", { clientX: 65, ctrlKey: true });
			else context.link.activate(event(), context.link.text); // xterm's own same-link drag behavior
			expect(context.config.openExternal).not.toHaveBeenCalled();
		}
	});
	it("refuses disposed links and stale links after writes/resize/scroll", () => {
		for (const cause of ["resize", "scroll", "write", "dispose"]) {
			const context = interactionFixture();
			if (cause === "dispose") context.link.dispose!();
			else {
				if (cause === "resize") Object.assign(context.term, { cols: 25 });
				if (cause === "scroll") Object.assign(context.term.buffer.active, { viewportY: 1 });
				if (cause === "write") Object.assign(context.term.buffer.active, { getLine: () => undefined });
				context.subscriptions.get(cause)!();
			}
			context.link.activate(event(), context.link.text);
			expect(context.config.openExternal).not.toHaveBeenCalled();
		}
	});
	it("keeps a freshly cached link usable when onWriteParsed follows the write callback", () => {
		const context = interactionFixture();
		context.link.hover!(event(), context.link.text);
		context.subscriptions.get("write")!();
		context.mouse("mousedown", { ctrlKey: true });
		context.mouse("mouseup", { ctrlKey: true });
		expect(context.config.openExternal).toHaveBeenCalledExactlyOnceWith("https://github.com/");
	});
	it("hit-tests fresh terminal content without requiring a cached hover and activates once", () => {
		const context = interactionFixture();
		const down = context.mouse("mousedown");
		const up = context.mouse("mouseup");
		context.link.activate(event(), context.link.text); // xterm's later callback
		expect(down.stopImmediatePropagation).not.toHaveBeenCalled();
		expect(up.stopImmediatePropagation).not.toHaveBeenCalled();
		expect(context.config.openExternal).toHaveBeenCalledExactlyOnceWith("https://github.com/");
	});
	it("consumes a captured modifier release after write/resize/scroll/mouseleave cancellation", () => {
		for (const cause of ["write", "resize", "scroll", "mouseleave"]) {
			const context = interactionFixture();
			context.modes.mouseTrackingMode = "any";
			context.mouse("mousedown", { ctrlKey: true });
			if (cause === "write") Object.assign(context.term.buffer.active, { getLine: () => undefined });
			if (cause === "mouseleave") context.mouse("mouseleave");
			else context.subscriptions.get(cause)!();
			const up = context.mouse("mouseup", { ctrlKey: true });
			expect(up.stopImmediatePropagation).toHaveBeenCalledOnce();
			expect(context.config.openExternal).not.toHaveBeenCalled();
			// A subsequent unmatched release is not swallowed.
			expect(context.mouse("mouseup").stopImmediatePropagation).not.toHaveBeenCalled();
		}
	});
	it("cancels async note validation after resize/write/scroll and removes every handler on close", async () => {
		for (const cause of ["resize", "write", "scroll"]) {
			const resolve: Array<(value: string) => void> = [];
			const context = interactionFixture(options({ realpath: () => new Promise(done => resolve.push(done)) }));
			const pending = context.provider.activate("Other.md", event());
			context.subscriptions.get(cause)!();
			resolve[0]("/vault"); resolve[1]("/vault/Other.md");
			await pending;
			expect(context.config.openNote).not.toHaveBeenCalled();
			context.provider.dispose(); context.provider.dispose();
			expect(context.listeners.size).toBe(0);
			expect(context.disposers[0]).toHaveBeenCalledOnce();
			expect(context.term.options.linkHandler).toBeUndefined();
		}
	});
	it("validates OSC 8 activation against the current cell URI instead of a stale hover", () => {
		const context = interactionFixture();
		let id = 1;
		const original = context.term.buffer.active.getLine.bind(context.term.buffer.active);
		Object.assign(context.term.buffer.active, { getLine: (row: number) => {
			const line = original(row);
			if (!line) return undefined;
			const getCell = line.getCell.bind(line);
			return { ...line, getCell: (col: number) => Object.assign(getCell(col)!, { extended: { urlId: id } }) };
		} });
		Object.assign(context.term, { _core: { _oscLinkService: { getLinkData: (id: number) => ({ uri: id === 1 ? "https://old.example" : id === 2 ? "https://new.example" : "javascript:alert(1)" }) } } });
		const range = { start: { x: 1, y: 1 }, end: { x: 17, y: 1 } };
		context.term.options.linkHandler!.hover!(event({ clientX: 5, clientY: 5, target: {} as Node }), "https://old.example", range);
		id = 2;
		context.term.options.linkHandler!.activate(event({ clientX: 5, clientY: 5, target: {} as Node }), "https://old.example", range);
		expect(context.config.openExternal).not.toHaveBeenCalled();
		context.mouse("mousedown", { ctrlKey: true }); context.mouse("mouseup", { ctrlKey: true });
		expect(context.config.openExternal).toHaveBeenCalledExactlyOnceWith("https://new.example/");
		vi.mocked(context.config.openExternal).mockClear();
		id = 3; // A safe-looking visible URL must not override an unsafe OSC 8 URI.
		context.mouse("mousedown", { ctrlKey: true }); context.mouse("mouseup", { ctrlKey: true });
		context.link.activate(event({ clientX: 5, clientY: 5, target: {} as Node }), context.link.text); // xterm's lower-priority textual fallback
		expect(context.config.openExternal).not.toHaveBeenCalled();
		id = 0; // Plain text replaces OSC 8: the stale URI must not remain active.
		context.term.options.linkHandler!.activate(event({ clientX: 5, clientY: 5, target: {} as Node }), "https://old.example", range);
		expect(context.config.openExternal).not.toHaveBeenCalled();
		expect(currentOsc8Link(context.term, { x: 1, y: 1 })).toEqual({ present: false });
	});
	it("fails closed when OSC 8 URL metadata exists but the registry is unavailable", () => {
		const term = terminal([{ chars: ["x"] }]);
		Object.assign(term.buffer.active, { getLine: () => ({ getCell: () => ({ extended: { urlId: 1 } }) }) });
		expect(currentOsc8Link(term, { x: 1, y: 1 })).toEqual({ present: true, uri: undefined });
	});
	it("retains a captured primary release when another mouse button is pressed", () => {
		const context = interactionFixture();
		context.modes.mouseTrackingMode = "any";
		context.mouse("mousedown", { ctrlKey: true });
		context.mouse("mousedown", { button: 2 });
		context.subscriptions.get("resize")!();
		expect(context.mouse("mouseup", { ctrlKey: true }).stopImmediatePropagation).toHaveBeenCalledOnce();
		expect(context.config.openExternal).not.toHaveBeenCalled();
	});
});
