import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { ILink, Terminal } from "@xterm/xterm";
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
	it("returns links for each wrapped row using inclusive cell ranges", () => {
		const term = terminal([{ chars: Array.from("See Notes/My ") }, { chars: Array.from("note.md:42:8"), wrapped: true }]);
		const provider = new TerminalLinks(term, options());
		const first = links(provider), second = links(provider, 2);
		expect(first[0].text).toBe("Notes/My note.md:42:8");
		expect(first[0].range).toEqual({ start: { x: 5, y: 1 }, end: { x: 12, y: 2 } });
		expect(second[0].range).toEqual(first[0].range);
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
	it("uses the guarded opener for OSC 8 and restores the preceding handler", () => {
		const context = interactionFixture();
		context.term.options.linkHandler!.activate(event(), "javascript:alert(1)", { start: { x: 1, y: 1 }, end: { x: 4, y: 1 } });
		expect(context.config.openExternal).not.toHaveBeenCalled();
		context.term.options.linkHandler!.activate(event(), "https://github.com", { start: { x: 1, y: 1 }, end: { x: 4, y: 1 } });
		expect(context.config.openExternal).toHaveBeenCalledOnce();
	});
});
