import { Terminal } from "@xterm/xterm";
import { App, Hotkey, Scope } from "obsidian";
import { normalizeObsidianHotkey } from "./openCodeKeymap";
import { decodeOsc52ClipboardSet, TerminalClipboard } from "./wslWindowsClipboard";

interface HotkeyManagerInternals {
	defaultKeys?: Record<string, Hotkey[] | undefined>;
	customKeys?: Record<string, Hotkey[] | undefined>;
}

interface CommandInternals {
	executeCommandById(id: string): boolean;
	listCommands?(): Array<{ id: string }>;
}

export interface KeyRouterContext {
	app: App;
	terminal: Terminal;
	container: HTMLElement;
	reservedTerminalHotkeys: ReadonlySet<string>;
	clipboard?: TerminalClipboard;
	onClipboardError?: (message: string) => void;
	onClipboardImagePaste?: (png: Buffer) => void | Promise<void>;
}

export class TerminalKeyRouter {
	private disposers: Array<() => void> = [];

	register(context: KeyRouterContext): void {
		this.registerShortcutScope(context);
		if (context.clipboard) {
			this.registerWslClipboard(context);
		} else {
			this.registerPasteHandler(context);
		}
	}

	private registerWslClipboard(context: KeyRouterContext): void {
		const { clipboard, container, terminal } = context;
		if (!clipboard) return;

		const reportFailure = (error: unknown) => {
			const detail = error instanceof Error ? error.message : String(error);
			context.onClipboardError?.(`Windows clipboard: ${detail}`);
		};
		const normalizePaste = (text: string) => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		const pasteFromWindows = () => {
			void (async () => {
				if (clipboard.readImagePng && context.onClipboardImagePaste) {
					const image = await clipboard.readImagePng();
					if (image) {
						await context.onClipboardImagePaste(image);
						return;
					}
				}
				const text = await clipboard.readText();
				if (text) terminal.paste(normalizePaste(text));
			})().catch(reportFailure);
		};
		const stop = (event: Event) => {
			event.preventDefault();
			event.stopImmediatePropagation();
		};

		const keydownHandler = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing || !event.ctrlKey || event.altKey || event.metaKey) return;
			if (event.key.toLowerCase() !== "v") return;
			stop(event);
			pasteFromWindows();
		};
		const pasteHandler = (event: ClipboardEvent) => {
			if (event.defaultPrevented) return;
			if (!container.contains(event.target as Node)) return;
			stop(event);
			pasteFromWindows();
		};

		container.addEventListener("keydown", keydownHandler, true);
		container.addEventListener("paste", pasteHandler, true);
		this.disposers.push(() => {
			container.removeEventListener("keydown", keydownHandler, true);
			container.removeEventListener("paste", pasteHandler, true);
		});

		const osc52 = terminal.parser.registerOscHandler(52, async (data) => {
			const text = decodeOsc52ClipboardSet(data);
			if (text === null) return true;
			try {
				await clipboard.writeText(text);
			} catch (error) {
				reportFailure(error);
			}
			return true;
		});
		this.disposers.push(() => osc52.dispose());
	}

	private registerShortcutScope(context: KeyRouterContext): void {
		const { app, container } = context;
		const scope = new Scope();
		const appInternals = app as unknown as {
			hotkeyManager?: HotkeyManagerInternals;
			commands?: CommandInternals;
		};
		const hotkeyManager = appInternals.hotkeyManager;
		const registeredCommandIds = appInternals.commands?.listCommands
			? new Set(appInternals.commands.listCommands().map(({ id }) => id))
			: undefined;

		const commandIds = new Set([
			...Object.keys(hotkeyManager?.defaultKeys ?? {}),
			...Object.keys(hotkeyManager?.customKeys ?? {}),
		]);
		for (const commandId of commandIds) {
			if (registeredCommandIds && !registeredCommandIds.has(commandId)) continue;
			const hasCustomHotkeys = Object.prototype.hasOwnProperty.call(
				hotkeyManager?.customKeys ?? {},
				commandId,
			);
			const hotkeys = hasCustomHotkeys
				? hotkeyManager?.customKeys?.[commandId] ?? []
				: hotkeyManager?.defaultKeys?.[commandId] ?? [];

			for (const hotkey of hotkeys) {
				if (context.reservedTerminalHotkeys.has(normalizeObsidianHotkey(hotkey))) continue;
				const handler = scope.register(hotkey.modifiers, hotkey.key, (event) => {
					const legacyKeyCode = Reflect.get(event, "keyCode") as unknown;
					if (event.isComposing || legacyKeyCode === 229) return;
					return appInternals.commands?.executeCommandById(commandId) ? false : undefined;
				});
				this.disposers.push(() => scope.unregister(handler));
			}
		}

		let active = false;
		const activate = () => {
			if (active) return;
			active = true;
			app.keymap.pushScope(scope);
		};
		const deactivate = () => {
			if (!active) return;
			active = false;
			app.keymap.popScope(scope);
		};
		const focusInHandler = () => activate();
		const focusOutHandler = (event: FocusEvent) => {
			if (event.relatedTarget && container.contains(event.relatedTarget as Node)) return;
			deactivate();
		};

		container.addEventListener("focusin", focusInHandler, true);
		container.addEventListener("focusout", focusOutHandler, true);
		this.disposers.push(() => {
			container.removeEventListener("focusin", focusInHandler, true);
			container.removeEventListener("focusout", focusOutHandler, true);
			deactivate();
		});

		if (container.contains(container.ownerDocument.activeElement)) activate();
	}

	private registerPasteHandler(context: KeyRouterContext): void {
		const { terminal, container } = context;

		const pasteHandler = (e: ClipboardEvent) => {
			if (e.defaultPrevented) return;
			const target = e.target as Node;
			if (!container.contains(target)) return;

			const text = e.clipboardData?.getData('text/plain');
			if (text) {
				e.preventDefault();
				e.stopImmediatePropagation();
				const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
				terminal.paste(normalized);
			}
		};

		container.addEventListener('paste', pasteHandler, true);
		this.disposers.push(() => container.removeEventListener('paste', pasteHandler, true));
	}

	dispose(): void {
		for (const disposer of this.disposers) {
			try { disposer(); } catch { /* ignore */ }
		}
		this.disposers = [];
	}
}
