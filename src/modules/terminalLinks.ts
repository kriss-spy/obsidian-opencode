import type { IBufferCellPosition, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { promises as fs } from "node:fs";
import * as path from "node:path";

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

export class TerminalLinks implements ILinkProvider {
	private disposed = false;
	private revision = 0;
	private hovered: ILink | null = null;
	private validations = new WeakMap<ILink, () => boolean>();
	private pressed: { link: ILink; x: number; y: number; modified: boolean; dragged: boolean } | null = null;
	private cleanups: Array<() => void> = [];

	constructor(private terminal: Terminal, private options: TerminalLinkOptions) {}

	provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
		if (this.disposed) { callback(undefined); return; }
		const line = logicalLine(this.terminal, y);
		if (!line) { callback(undefined); return; }
		const links = findTerminalLinks(line.text, this.options).map(match => {
			let released = false;
			const cols = this.terminal.cols;
			const viewportY = this.terminal.buffer.active.viewportY;
			const buffer = this.terminal.buffer.active;
			const valid = () => !released && !this.disposed && this.terminal.cols === cols &&
				this.terminal.buffer.active === buffer && buffer.viewportY === viewportY &&
				logicalLine(this.terminal, y)?.text === line.text;
			const link: ILink = {
				text: match.text,
				range: { start: line.starts[match.start], end: line.ends[match.end - 1] },
				activate: event => {
					if (valid()) void this.activate(match.text, event);
				},
				hover: () => { if (valid()) this.hovered = link; },
				leave: () => { if (this.hovered === link) this.hovered = null; },
				dispose: () => { released = true; if (this.hovered === link) this.hovered = null; },
			};
			this.validations.set(link, valid);
			return link;
		}).filter(link => link.range.start.y <= y && link.range.end.y >= y);
		callback(links.length ? links : undefined);
	}

	async activate(text: string, event: MouseEvent): Promise<void> {
		if (this.disposed || event.button !== 0 || this.terminal.hasSelection()) return;
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

	attach(container: HTMLElement): void {
		const registration = this.terminal.registerLinkProvider(this);
		this.cleanups.push(() => registration.dispose());
		// xterm's OSC 8 provider has priority. Give it the same guarded opener.
		const previous = this.terminal.options.linkHandler;
		this.terminal.options.linkHandler = {
			activate: (event, text) => { void this.activate(text, event); },
			hover: (_event, text, range) => {
				this.hovered = { text, range, activate: event => { void this.activate(text, event); } };
			},
			leave: () => { this.hovered = null; },
		};
		this.cleanups.push(() => { this.terminal.options.linkHandler = previous; });
		const atLink = (event: MouseEvent, link: ILink): boolean => {
			const screen = this.terminal.element?.querySelector(".xterm-screen");
			if (!screen || !screen.contains(event.target as Node)) return false;
			const rect = screen.getBoundingClientRect();
			if (!rect.width || !rect.height) return false;
			const x = Math.floor((event.clientX - rect.left) / (rect.width / this.terminal.cols)) + 1;
			const row = Math.floor((event.clientY - rect.top) / (rect.height / this.terminal.rows));
			if (x < 1 || x > this.terminal.cols || row < 0 || row >= this.terminal.rows) return false;
			const y = row + this.terminal.buffer.active.viewportY + 1;
			return y >= link.range.start.y && y <= link.range.end.y &&
				(y !== link.range.start.y || x >= link.range.start.x) &&
				(y !== link.range.end.y || x <= link.range.end.x);
		};
		const down = (event: MouseEvent) => {
			this.pressed = null;
			const link = this.hovered;
			if (event.button !== 0 || !link || !atLink(event, link) || this.terminal.hasSelection()) return;
			const modified = this.options.isModEvent(event);
			this.pressed = { link, x: event.clientX, y: event.clientY, modified, dragged: false };
			if (modified) { event.preventDefault(); event.stopImmediatePropagation(); }
		};
		const move = (event: MouseEvent) => {
			if (this.pressed && (Math.abs(event.clientX - this.pressed.x) > 3 || Math.abs(event.clientY - this.pressed.y) > 3)) this.pressed.dragged = true;
		};
		const up = (event: MouseEvent) => {
			const pressed = this.pressed;
			if (!pressed?.modified || event.button !== 0) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (!pressed.dragged && this.hovered === pressed.link && atLink(event, pressed.link)) pressed.link.activate(event, pressed.link.text);
			this.pressed = null;
		};
		const clear = () => { this.revision++; this.hovered = null; this.pressed = null; };
		container.addEventListener("mousedown", down, true);
		container.addEventListener("mousemove", move, true);
		container.addEventListener("mouseup", up, true);
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
			container.removeEventListener("mouseup", up, true);
			container.removeEventListener("mouseleave", clear);
			resize.dispose(); scroll.dispose(); write.dispose();
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.hovered = null;
		this.pressed = null;
		for (const cleanup of this.cleanups.splice(0)) cleanup();
	}
}
