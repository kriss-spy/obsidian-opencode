import { Terminal } from "@xterm/xterm";
import { App } from "obsidian";
import * as fs from "fs";
import { PtySession } from "./ptySession";

export interface KeyRouterContext {
	app: App;
	terminal: Terminal;
	ptySession: PtySession;
	container: HTMLElement;
}

export class TerminalKeyRouter {
	private disposers: Array<() => void> = [];

	register(context: KeyRouterContext): void {
		this.registerKeyboardHandler(context);
		this.registerPasteHandler(context);
	}

	private registerKeyboardHandler(context: KeyRouterContext): void {
		const { app, terminal, ptySession, container } = context;

		interface HotkeyEntry { modifiers: string[]; key: string }
		const hotkeyToCommand = new Map<string, string>();

		const addHotkeys = (cmdId: string, hotkeys: Array<HotkeyEntry>) => {
			for (const hk of hotkeys) {
				const mods = hk.modifiers.map((m: string) => m === 'Mod' ? 'Ctrl' : m).sort().join('+');
				const str = `${mods}${mods ? '+' : ''}${hk.key}`;
				hotkeyToCommand.set(str, cmdId);
			}
		};

		const defaultKeys = (app as unknown as Record<string, unknown>).hotkeyManager as Record<string, unknown> | undefined;
		for (const [cmdId, hotkeys] of Object.entries((defaultKeys?.defaultKeys as Record<string, HotkeyEntry[]>) ?? {})) {
			addHotkeys(cmdId, hotkeys);
		}

		try {
			const adapter = app.vault.adapter;
			if ('getBasePath' in adapter && typeof (adapter as unknown as Record<string, unknown>).getBasePath === 'function') {
				const basePath = (adapter as unknown as Record<string, () => string>).getBasePath();
				const hotkeysPath = `${basePath}/${app.vault.configDir}/hotkeys.json`;
				if (fs.existsSync(hotkeysPath)) {
					const custom = JSON.parse(fs.readFileSync(hotkeysPath, 'utf8')) as Record<string, HotkeyEntry[]>;
					for (const [cmdId, hotkeys] of Object.entries(custom)) {
						if (Array.isArray(hotkeys) && hotkeys.length > 0) {
							addHotkeys(cmdId, hotkeys);
						}
					}
				}
			}
		} catch {
			// ignore
		}

		const allowedIds = new Set([
			'opencode:open-terminal',
			'opencode:toggle-terminal-sidebar',
			'opencode:open-conversations',
			'opencode:new-session',
			'opencode:continue-last-session',
			'app:toggle-right-sidebar',
		]);

		const handler = (e: KeyboardEvent) => {
			if (!terminal) return;
			const legacyKeyCode = Reflect.get(e, "keyCode") as unknown;
			if (e.isComposing || legacyKeyCode === 229) return;

			const target = e.target as Node;
			const inContainer = container.contains(target);

			if (!inContainer) return;

			if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta' || e.key === 'CapsLock') return;

			if ((e.ctrlKey || e.metaKey) && e.key === 'v') return;

			if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
				e.preventDefault();
				e.stopImmediatePropagation();
				navigator.clipboard.readText().then(text => {
					if (text && ptySession.getStdin()) {
						const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
						ptySession.writeStdin(normalized);
					}
				}).catch(() => {});
				return;
			}

			const mods: string[] = [];
			if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
			if (e.altKey) mods.push('Alt');
			if (e.shiftKey) mods.push('Shift');
			mods.sort();
			const hotkeyStr = `${mods.join('+')}${mods.length ? '+' : ''}${e.key}`;

			const cmdId = hotkeyToCommand.get(hotkeyStr);
			if (cmdId && allowedIds.has(cmdId)) {
				(app as unknown as { commands?: { executeCommandById(id: string): void } }).commands?.executeCommandById(cmdId);
				e.stopImmediatePropagation();
				return;
			}

			e.preventDefault();
			this.sendKeyToPty(e, ptySession);

			if (e.key === 'Escape') {
				window.setTimeout(() => {
					const textarea = terminal.textarea;
					if (textarea) textarea.focus();
				}, 50);
			}

			e.stopImmediatePropagation();
		};

		activeDocument.addEventListener('keydown', handler, true);
		this.disposers.push(() => activeDocument.removeEventListener('keydown', handler, true));
	}

	private registerPasteHandler(context: KeyRouterContext): void {
		const { ptySession, container } = context;

		const pasteHandler = (e: ClipboardEvent) => {
			if (!ptySession.getStdin()) return;
			const target = e.target as Node;
			if (!container.contains(target)) return;

			const text = e.clipboardData?.getData('text/plain');
			if (text) {
				e.preventDefault();
				e.stopImmediatePropagation();
				const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
				ptySession.writeStdin(normalized);
			}
		};

		container.addEventListener('paste', pasteHandler, true);
		this.disposers.push(() => container.removeEventListener('paste', pasteHandler, true));
	}

	private sendKeyToPty(e: KeyboardEvent, ptySession: PtySession): void {
		if (!ptySession.getStdin()) return;

		const key = e.key;
		const ctrl = e.ctrlKey || e.metaKey;
		const alt = e.altKey;
		const shift = e.shiftKey;

		let seq: string;

		if (ctrl && !alt) {
			if (key.length === 1 && key >= 'a' && key <= 'z') {
				seq = String.fromCharCode(key.charCodeAt(0) - 0x60);
			} else if (key >= 'A' && key <= 'Z') {
				seq = String.fromCharCode(key.charCodeAt(0) - 0x40);
			} else {
				switch (key) {
					case '[': seq = '\x1b'; break;
					case '\\': seq = '\x1c'; break;
					case ']': seq = '\x1d'; break;
					case '^': seq = '\x1e'; break;
					case '_': seq = '\x1f'; break;
					default: seq = key; break;
				}
			}
		} else if (alt) {
			seq = '\x1b' + key;
		} else {
			switch (key) {
				case 'Escape': seq = '\x1b'; break;
				case 'Enter': seq = '\r'; break;
				case 'Tab': seq = shift ? '\x1b[Z' : '\t'; break;
				case 'Backspace': seq = '\x7f'; break;
				case 'Delete': seq = '\x1b[3~'; break;
				case 'ArrowUp': seq = '\x1b[A'; break;
				case 'ArrowDown': seq = '\x1b[B'; break;
				case 'ArrowRight': seq = '\x1b[C'; break;
				case 'ArrowLeft': seq = '\x1b[D'; break;
				case 'Home': seq = '\x1b[H'; break;
				case 'End': seq = '\x1b[F'; break;
				case 'PageUp': seq = '\x1b[5~'; break;
				case 'PageDown': seq = '\x1b[6~'; break;
				case 'F1': seq = '\x1bOP'; break;
				case 'F2': seq = '\x1bOQ'; break;
				case 'F3': seq = '\x1bOR'; break;
				case 'F4': seq = '\x1bOS'; break;
				case 'F5': seq = '\x1b[15~'; break;
				case 'F6': seq = '\x1b[17~'; break;
				case 'F7': seq = '\x1b[18~'; break;
				case 'F8': seq = '\x1b[19~'; break;
				case 'F9': seq = '\x1b[20~'; break;
				case 'F10': seq = '\x1b[21~'; break;
				case 'F11': seq = '\x1b[23~'; break;
				case 'F12': seq = '\x1b[24~'; break;
				default: seq = key; break;
			}
		}

		ptySession.writeStdin(seq);
	}

	dispose(): void {
		for (const disposer of this.disposers) {
			try { disposer(); } catch { /* ignore */ }
		}
		this.disposers = [];
	}
}
