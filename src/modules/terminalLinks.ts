import type { IBufferCellPosition, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { currentOsc8Link } from "./xtermOsc8";

export interface NoteTarget {
	path: string;
	line?: number;
	column?: number;
}

export interface TerminalLinkOptions {
	vaultRoot: string;
	hasNote(path: string): boolean;
	openNote(target: NoteTarget, event: MouseEvent): Promise<void>;
	openExternal(url: string): Promise<unknown>;
	isModEvent(event: MouseEvent): boolean;
	onError(error: unknown): void;
	wslDistro?: string;
	/** Override only for filesystem-independent tests. Production always uses realpath. */
	realpath?: (path: string) => Promise<string>;
}

export function safeWebUrl(text: string): string | null {
	if (!/^https?:\/\//i.test(text) || /[\x00-\x20\x7f]/.test(text)) return null;
	try {
		const url = new URL(text);
		return url.hostname && (url.protocol === "http:" || url.protocol === "https:") ? url.href : null;
	} catch {
		return null;
	}
}

function pathApi(root: string): typeof path.posix {
	return /^[a-z]:[\\/]|^\\\\/i.test(root) ? path.win32 : path.posix;
}

function nativePath(text: string, root: string, distro?: string): string | null {
	if (pathApi(root) === path.win32) {
		const mounted = /^\/mnt\/([a-z])(?:\/(.*))?$/i.exec(text);
		if (mounted) return `${mounted[1]}:\\${mounted[2] ?? ""}`.replace(/\//g, "\\");
		return text.replace(/\//g, "\\");
	}
	const drive = /^([a-z]):[\\/](.*)$/i.exec(text);
	// WSL's automount aliases are useful only when the active vault uses that mount.
	if (drive) return /^\/mnt\/[a-z](?:\/|$)/i.test(root)
		? `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}` : null;
	const unc = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)\\(.*)$/i.exec(text);
	if (unc) return distro && unc[1].toLowerCase() === distro.toLowerCase()
		? `/${unc[2].replace(/\\/g, "/")}` : null;
	if (/^\\\\/.test(text)) return null;
	return text.replace(/\\/g, "/");
}

function containedRelative(root: string, target: string): string | null {
	const api = pathApi(root);
	const relative = api.relative(api.resolve(root), api.resolve(target));
	return relative && relative !== ".." && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative)
		? relative.split(api.sep).join("/") : null;
}

export function resolveNoteTarget(text: string, root: string, distro?: string): NoteTarget | null {
	if (/[\x00-\x1f\x7f]|^[a-z][a-z\d+.-]*:\/\//i.test(text)) return null;
	const match = /^(.*\.md)(?::([1-9]\d*))?(?::([1-9]\d*))?$/i.exec(text);
	if (!match) return null;
	if (/^[a-z][a-z\d+.-]*:/i.test(match[1]) && !/^[a-z]:[\\/]/i.test(match[1])) return null;
	const native = nativePath(match[1], root, distro);
	if (!native) return null;
	const api = pathApi(root);
	// Drive-relative and Windows root-relative paths depend on process cwd/drive.
	if (api === path.win32 && (/^[a-z]:[^\\]/i.test(native) || /^\\(?!\\)/.test(native))) return null;
	const relative = containedRelative(root, api.resolve(root, native));
	if (!relative) return null;
	const line = match[2] ? Number(match[2]) : undefined;
	const column = match[3] ? Number(match[3]) : undefined;
	if ((line !== undefined && !Number.isSafeInteger(line)) || (column !== undefined && !Number.isSafeInteger(column))) return null;
	return { path: relative, line, column };
}

interface TextMatch { start: number; end: number; text: string; note?: NoteTarget }

/** Spaces are resolved against existing notes rather than guessed from prose. */
export function findTerminalLinks(text: string, options: Pick<TerminalLinkOptions, "vaultRoot" | "hasNote" | "wslDistro">): TextMatch[] {
	const links: TextMatch[] = [];
	const urls = /https?:\/\/[^\s<>"'`]+/gi;
	let match: RegExpExecArray | null;
	while ((match = urls.exec(text))) {
		let value = match[0].replace(/[.,!?:;]+$/, "");
		// Retain balanced URL parentheses, trim surrounding prose punctuation.
		while (/[)\]}]$/.test(value)) {
			const close = value.slice(-1);
			const open = close === ")" ? "(" : close === "]" ? "[" : "{";
			if (value.split(close).length <= value.split(open).length) break;
			value = value.slice(0, -1);
		}
		if (safeWebUrl(value)) links.push({ start: match.index, end: match.index + value.length, text: value });
	}
	const ends = /\.md(?::[1-9]\d*(?::[1-9]\d*)?)?(?=$|[\s`"'<>\])},;.!?])/gi;
	let previousEnd = 0;
	while ((match = ends.exec(text))) {
		const end = match.index + match[0].length;
		// Restrict candidates to the current delimiter-bounded phrase.
		let segmentStart = match.index;
		while (segmentStart > previousEnd && !/[\n\r\t`"'<>\[\]{}|,;]/.test(text[segmentStart - 1])) segmentStart--;
		previousEnd = end;
		if (end - segmentStart > 4096) continue;
		for (let start = segmentStart; start <= match.index; start++) {
			if (start > segmentStart && !/[\s()]/.test(text[start - 1])) continue;
			if (/\s/.test(text[start])) continue;
			const value = text.slice(start, end);
			// Never recover a relative suffix from an explicit rejected absolute/traversal path.
			const explicit = /^(?:[a-z]:[\\/]|[\\/]|\.\.[\\/]|[a-z][a-z\d+.-]*:\/\/)/i.test(value);
			if (links.some(link => start < link.end && end > link.start)) break;
			const note = resolveNoteTarget(value, options.vaultRoot, options.wslDistro);
			if (note && options.hasNote(note.path)) {
				links.push({ start, end, text: value, note });
				break;
			}
			if (explicit) break;
		}
	}
	return links.sort((a, b) => a.start - b.start);
}

interface LogicalLine { text: string; starts: IBufferCellPosition[]; ends: IBufferCellPosition[] }

/** Map UTF-16 string offsets to xterm's 1-based, inclusive cell coordinates. */
function logicalLine(terminal: Terminal, y: number): LogicalLine | null {
	const buffer = terminal.buffer.active;
	let first = y - 1;
	if (!buffer.getLine(first)) return null;
	// Bound work for malicious/very long unbroken output; do not detect truncated links.
	while (first > 0 && buffer.getLine(first)?.isWrapped) {
		if (y - 1 - first > 128) return null;
		first--;
	}
	const result: LogicalLine = { text: "", starts: [], ends: [] };
	for (let row = first; row < buffer.length; row++) {
		const line = buffer.getLine(row);
		if (!line || (row > first && !line.isWrapped)) break;
		if (row - first > 128) return null;
		const next = buffer.getLine(row + 1);
		let length = line.length;
		// In the alternate buffer xterm preserves old wraps when the viewport
		// grows, padding the formerly full row with empty cells. Printed spaces
		// have chars=" "; only null padding must be omitted from the logical text.
		while (length > 0 && !line.getCell(length - 1)?.getChars()) length--;
		for (let col = 0; col < length; col++) {
			const cell = line.getCell(col);
			if (!cell || cell.getWidth() === 0) continue;
			const chars = cell.getChars();
			// Wide characters wrap early, leaving an empty final cell as padding.
			if (!chars && col === line.length - 1 && next?.isWrapped && next.getCell(0)?.getWidth() === 2) continue;
			const value = chars || " ";
			result.text += value;
			if (result.text.length > 16384) return null;
			for (let i = 0; i < value.length; i++) {
				result.starts.push({ x: col + 1, y: row + 1 });
				result.ends.push({ x: col + Math.max(1, cell.getWidth()), y: row + 1 });
			}
		}
	}
	return result;
}

interface LinkLine { line: LogicalLine; current(): boolean; continuation?: "note" | "web"; suffix?: ILink["range"] }

/** Join URL tokens only within a bounded, consistently indented TUI wrap. */
function wrappedWebLines(terminal: Terminal, y: number): LinkLine[] {
	if (terminal.modes.mouseTrackingMode === "none") return [];
	const result: LinkLine[] = [];
	const content = (text: string) => text.replace(/ +[█▄▀▐▌┃│] *$/, "").trimEnd();
	for (let first = Math.max(1, y - 31); first <= y; first++) {
		const initial = logicalLine(terminal, first);
		if (!initial || initial.starts[0]?.y !== first) continue;
		const indent = /^(?: +[┃│] {2,}| {2,}(?:[-*•] )?)/.exec(initial.text)?.[0];
		if (!indent) continue;
		const start = /https?:\/\/[^\s<>"'`]+$/i.exec(content(initial.text));
		if (!start || start.index < indent.length) continue;
		let line: LogicalLine = { text: start[0], starts: initial.starts.slice(start.index, start.index + start[0].length), ends: initial.ends.slice(start.index, start.index + start[0].length) };
		const sources = [{ y: first, text: initial.text }];
		let row = initial.ends[initial.ends.length - 1].y + 1;
		let bounded = true;
		while (row <= terminal.buffer.active.length) {
			const end = line.ends[line.ends.length - 1];
			// OpenCode leaves a small right margin or wraps at URL separators.
			// A short completed URL must not consume a following paragraph.
			if (terminal.cols - end.x > 6 && !/[/.%?=&_-]$/.test(line.text)) break;
			const next = logicalLine(terminal, row);
			if (!next || next.starts[0]?.y !== row) break;
			const prefix = indent.includes("┃") || indent.includes("│") ? indent : " ".repeat(indent.length);
			const text = content(next.text);
			if (!text.startsWith(prefix)) break;
			const token = /^[^\s<>"'`]+/.exec(text.slice(prefix.length))?.[0];
			if (!token || /^(?:[-*•]|[a-z][a-z\d+.-]*:\/\/)/i.test(token) ||
				text.slice(prefix.length + token.length).replace(/^["'`\])},;.!?]+/, "").trim()) break;
			if (terminal.cols - end.x > 6 && token.length <= terminal.cols - end.x - 4) break;
			if (row >= first + 32 || line.text.length + token.length > 4096) { bounded = false; break; }
			line = { text: line.text + token,
				starts: [...line.starts, ...next.starts.slice(prefix.length, prefix.length + token.length)],
				ends: [...line.ends, ...next.ends.slice(prefix.length, prefix.length + token.length)] };
			sources.push({ y: row, text: next.text });
			row = next.ends[next.ends.length - 1].y + 1;
		}
		if (!bounded || sources.length < 2 || line.ends[line.ends.length - 1].y < y || !safeWebUrl(line.text)) continue;
		const following = logicalLine(terminal, row)?.text;
		result.push({ line, continuation: "web", suffix: { start: line.starts[0], end: line.ends[line.ends.length - 1] },
			current: () => sources.every(source => logicalLine(terminal, source.y)?.text === source.text) && logicalLine(terminal, row)?.text === following });
	}
	return result;
}

/** OpenCode lays out indented paragraphs itself, without xterm's wrap flag. */
function linkLines(terminal: Terminal, y: number): LinkLine[] {
	const normal = logicalLine(terminal, y);
	if (!normal) return [];
	const ordinary: LinkLine = { line: normal, current: () => logicalLine(terminal, y)?.text === normal.text };
	const result: LinkLine[] = [];
	if (terminal.modes.mouseTrackingMode === "none") return [ordinary];
	// Only consider a short, consistently indented TUI paragraph. Real newlines
	// in ordinary terminal output remain separate; lookup still requires an
	// exact existing Markdown path and never salvages an outside-vault suffix.
	for (let first = Math.max(1, y - 7); first <= y; first++) {
		const initial = logicalLine(terminal, first);
		if (!initial || initial.starts[0]?.y !== first) continue;
		const indent = /^ {2,}(?:[-*•] )?/.exec(initial.text)?.[0].length;
		if (!indent) continue;
		const sources = [{ y: first, text: initial.text }];
		const initialEnd = initial.text.trimEnd().length;
		if (initialEnd <= indent) continue;
		let spaced: LogicalLine = { text: initial.text.slice(indent, initialEnd), starts: initial.starts.slice(indent, initialEnd), ends: initial.ends.slice(indent, initialEnd) };
		let joined = spaced;
		const pathPrefix = /[\\/]/.test(spaced.text) && !/\.md(?:[:\s`"')]|$)/i.test(spaced.text);
		let continuationStart: IBufferCellPosition | undefined;
		for (let row = initial.ends[initial.ends.length - 1].y + 1; row < first + 8;) {
			const next = logicalLine(terminal, row);
			if (!next || next.starts[0]?.y !== row ||
				!next.text.startsWith(" ".repeat(indent)) || /\s/.test(next.text[indent] ?? " ")) break;
			const end = next.text.trimEnd().length;
			const fragment: LogicalLine = { text: next.text.slice(indent, end), starts: next.starts.slice(indent, end), ends: next.ends.slice(indent, end) };
			continuationStart ??= fragment.starts[0];
			const append = (previous: LogicalLine, separator: string): LogicalLine => ({
				text: previous.text + separator + fragment.text,
				starts: [...previous.starts, ...(separator ? [previous.ends[previous.ends.length - 1]] : []), ...fragment.starts],
				ends: [...previous.ends, ...(separator ? [previous.ends[previous.ends.length - 1]] : []), ...fragment.ends],
			});
			spaced = append(spaced, /[\\/]$/.test(spaced.text) ? "" : " ");
			joined = append(joined, "");
			if (spaced.text.length > 4096) break;
			sources.push({ y: row, text: next.text });
			const last = next.ends[next.ends.length - 1].y;
			row = last + 1;
			if (last < y) continue;
			const snapshot = sources.slice();
			const current = () => snapshot.every(source => logicalLine(terminal, source.y)?.text === source.text);
			const noteEnd = pathPrefix ? /\.md(?::[1-9]\d*(?::[1-9]\d*)?)?(?=$|[\s`"'<>\])},;.!?])/i.exec(spaced.text) : null;
			// Do not offer the root basename from a continuation of a longer
			// path, even when that full path is missing or outside the vault.
			const suffix = noteEnd && continuationStart ? { start: continuationStart, end: spaced.ends[noteEnd.index + noteEnd[0].length - 1] } : undefined;
			result.push({ line: spaced, current, continuation: "note", suffix });
			if (joined.text !== spaced.text) result.push({ line: joined, current, continuation: "note", suffix });
		}
	}
	return [...result, ordinary];
}

export class TerminalLinks implements ILinkProvider {
	private disposed = false;
	private revision = 0;
	private hovered: ILink | null = null;
	private capturedPrimaryPress = false;
	private validations = new WeakMap<ILink, () => boolean>();
	private pressed: { link: ILink; x: number; y: number; modified: boolean; dragged: boolean; handled: boolean } | null = null;
	private cleanups: Array<() => void> = [];

	constructor(private terminal: Terminal, private options: TerminalLinkOptions) {}

	provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
		if (this.disposed) { callback(undefined); return; }
		const seen = new Set<string>();
		const lines = [...wrappedWebLines(this.terminal, y), ...linkLines(this.terminal, y)];
		const suffixes = lines.flatMap(line => line.suffix ? [line.suffix] : []);
		const before = (a: IBufferCellPosition, b: IBufferCellPosition) => a.y < b.y || (a.y === b.y && a.x <= b.x);
		const links = lines.flatMap(({ line, current, continuation }) => findTerminalLinks(line.text, this.options).flatMap(match => {
			const range = { start: line.starts[match.start], end: line.ends[match.end - 1] };
			if (continuation && (range.start.y === range.end.y || (continuation === "note" ? !match.note : match.note))) return [];
			if (!continuation && suffixes.some(suffix => before(range.start, suffix.end) && before(suffix.start, range.end))) return [];
			if (range.start.y > y || range.end.y < y) return [];
			const key = `${match.text}:${range.start.x}:${range.start.y}:${range.end.x}:${range.end.y}`;
			if (seen.has(key)) return [];
			seen.add(key);
			let released = false;
			const cols = this.terminal.cols;
			const viewportY = this.terminal.buffer.active.viewportY;
			const buffer = this.terminal.buffer.active;
			const valid = () => !released && !this.disposed && this.terminal.cols === cols &&
				this.terminal.buffer.active === buffer && buffer.viewportY === viewportY &&
				current();
			const link: ILink = {
				text: match.text,
				range,
				activate: event => {
					if (valid() && !this.pressed?.handled) void this.activate(match.text, event);
				},
				hover: () => { if (valid()) this.hovered = link; },
				leave: () => { if (this.hovered === link) this.hovered = null; },
				dispose: () => { released = true; if (this.hovered === link) this.hovered = null; },
			};
			this.validations.set(link, valid);
			return [link];
		}));
		callback(links.length ? links : undefined);
	}

	async activate(text: string, event: MouseEvent): Promise<void> {
		if (this.disposed || event.button !== 0 || this.terminal.hasSelection()) return;
		const cell = this.cellAt(event);
		if (cell) {
			const osc = currentOsc8Link(this.terminal, cell);
			// xterm ignores unsafe OSC 8 providers and can then offer a textual
			// URL from the label. Never let that lower-priority callback bypass
			// the actual current OSC 8 target (including an unavailable registry).
			if (osc.present && osc.uri !== text) return;
		}
		if (this.pressed?.dragged) return;
		if (this.terminal.modes.mouseTrackingMode !== "none" && !this.options.isModEvent(event)) return;
		const revision = this.revision;
		const hoveredRow = this.hovered?.text === text ? this.hovered.range.start.y : undefined;
		const snapshot = hoveredRow ? logicalLine(this.terminal, hoveredRow)?.text : undefined;
		try {
			const url = safeWebUrl(text);
			if (url) { await this.options.openExternal(url); return; }
			const note = resolveNoteTarget(text, this.options.vaultRoot, this.options.wslDistro);
			if (!note || !this.options.hasNote(note.path)) return;
			const realpath = this.options.realpath ?? fs.realpath;
			const api = pathApi(this.options.vaultRoot);
			const [root, file] = await Promise.all([
				realpath(this.options.vaultRoot),
				realpath(api.join(this.options.vaultRoot, note.path)),
			]);
			if (this.disposed || revision !== this.revision || (hoveredRow && snapshot !== logicalLine(this.terminal, hoveredRow)?.text) || !containedRelative(root, file) || !this.options.hasNote(note.path)) return;
			await this.options.openNote(note, event);
		} catch (error) {
			if (!this.disposed) this.options.onError(error);
		}
	}

	private cellAt(event: MouseEvent): IBufferCellPosition | null {
		const screen = this.terminal.element?.querySelector(".xterm-screen");
		if (!screen || !screen.contains(event.target as Node)) return null;
		const rect = screen.getBoundingClientRect();
		if (!rect.width || !rect.height) return null;
		const x = Math.floor((event.clientX - rect.left) / (rect.width / this.terminal.cols)) + 1;
		const row = Math.floor((event.clientY - rect.top) / (rect.height / this.terminal.rows));
		if (x < 1 || x > this.terminal.cols || row < 0 || row >= this.terminal.rows) return null;
		return { x, y: row + this.terminal.buffer.active.viewportY + 1 };
	}

	attach(container: HTMLElement): void {
		const registration = this.terminal.registerLinkProvider(this);
		this.cleanups.push(() => registration.dispose());
		// xterm's OSC 8 provider has priority. Give it the same guarded opener.
		const previous = this.terminal.options.linkHandler;
		this.terminal.options.linkHandler = {
			activate: (event, text) => {
				const cell = cellAt(event);
				if (cell && currentOsc8Link(this.terminal, cell).uri === text && !this.pressed?.handled) void this.activate(text, event);
			},
			hover: (event, text, range) => {
				const cell = cellAt(event);
				if (cell && currentOsc8Link(this.terminal, cell).uri === text) {
					this.hovered = { text, range, activate: event => { void this.activate(text, event); } };
				}
			},
			leave: () => { this.hovered = null; },
		};
		this.cleanups.push(() => { this.terminal.options.linkHandler = previous; });
		const cellAt = (event: MouseEvent) => this.cellAt(event);
		const contains = (link: ILink, cell: IBufferCellPosition): boolean => cell.y >= link.range.start.y && cell.y <= link.range.end.y &&
			(cell.y !== link.range.start.y || cell.x >= link.range.start.x) &&
			(cell.y !== link.range.end.y || cell.x <= link.range.end.x);
		const linkAt = (event: MouseEvent): ILink | null => {
			const cell = cellAt(event);
			if (!cell) return null;
			// Refresh OSC 8 metadata too: xterm's cached hover can describe the
			// previous target after a redraw. Preserve its priority over visible text.
			const osc = currentOsc8Link(this.terminal, cell);
			if (osc.present) return osc.uri && safeWebUrl(osc.uri)
				? { text: osc.uri, range: { start: cell, end: cell }, activate: event => { void this.activate(osc.uri!, event); } }
				: null;
			// Textual links are looked up fresh: xterm can retain old active-line
			// replies after mouseleave followed by a redraw outside the pointer.
			let result: ILink | null = null;
			this.provideLinks(cell.y, links => { result = links?.find(link => contains(link, cell)) ?? null; });
			return result;
		};
		const down = (event: MouseEvent) => {
			if (event.button !== 0) return;
			this.pressed = null;
			this.capturedPrimaryPress = false;
			const link = linkAt(event);
			if (!link || this.terminal.hasSelection()) return;
			const modified = this.options.isModEvent(event);
			this.pressed = { link, x: event.clientX, y: event.clientY, modified, dragged: false, handled: false };
			if (modified) { this.capturedPrimaryPress = true; event.preventDefault(); event.stopImmediatePropagation(); }
		};
		const move = (event: MouseEvent) => {
			if (this.pressed && (Math.abs(event.clientX - this.pressed.x) > 3 || Math.abs(event.clientY - this.pressed.y) > 3)) this.pressed.dragged = true;
		};
		const up = (event: MouseEvent) => {
			if (event.button !== 0) return;
			const owned = this.capturedPrimaryPress;
			if (owned) {
				this.capturedPrimaryPress = false;
				event.preventDefault();
				event.stopImmediatePropagation();
			}
			const pressed = this.pressed;
			if (!pressed) return;
			if (!owned && this.terminal.modes.mouseTrackingMode !== "none") return;
			const current = linkAt(event);
			if (!pressed.dragged && current && current.text === pressed.link.text &&
				current.range.start.x === pressed.link.range.start.x && current.range.start.y === pressed.link.range.start.y &&
				current.range.end.x === pressed.link.range.end.x && current.range.end.y === pressed.link.range.end.y) {
				// Ordinary releases still reach xterm's selection service. Suppress
				// only its duplicate activation callback, not the mouse event.
				pressed.handled = true;
				void this.activate(current.text, event);
			}
			if (pressed.modified) this.pressed = null;
		};
		const clear = () => { this.revision++; this.hovered = null; this.pressed = null; };
		container.addEventListener("mousedown", down, true);
		container.addEventListener("mousemove", move, true);
		const ownerDocument = container.ownerDocument;
		ownerDocument.addEventListener("mouseup", up, true);
		container.addEventListener("mouseleave", clear);
		const resize = this.terminal.onResize(clear);
		const scroll = this.terminal.onScroll(clear);
		const write = this.terminal.onWriteParsed(() => {
			// A write callback can run before onWriteParsed. xterm may already have
			// cached the links from that frame: retain unchanged hovered content.
			// Pending async filesystem work is still cancelled when another frame arrives.
			this.revision++;
			if (this.hovered && this.validations.get(this.hovered)?.() === false) {
				this.hovered = null;
				this.pressed = null;
			}
		});
		this.cleanups.push(() => {
			container.removeEventListener("mousedown", down, true);
			container.removeEventListener("mousemove", move, true);
			ownerDocument.removeEventListener("mouseup", up, true);
			container.removeEventListener("mouseleave", clear);
			resize.dispose(); scroll.dispose(); write.dispose();
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.capturedPrimaryPress = false;
		this.hovered = null;
		this.pressed = null;
		for (const cleanup of this.cleanups.splice(0)) cleanup();
	}
}
