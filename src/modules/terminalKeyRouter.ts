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
	suspendTerminalHotkeys?: ReadonlySet<string>;
	onSuspendBlocked?: () => void;
	clipboard?: TerminalClipboard;
	copySelectionOnCtrlC?: boolean | (() => boolean);
	onClipboardError?: (message: string) => void;
	onClipboardImagePaste?: (png: Buffer) => void | Promise<void>;
	shiftEnterNewline?: boolean;
	onShiftEnterNewline?: () => void;
}

export class TerminalKeyRouter {
	private disposers: Array<() => void> = [];
	private shiftEnterDisposer: (() => void) | null = null;
	private shiftEnterTimers = new Set<{ id: number; window: Window }>();

	register(context: KeyRouterContext): void {
		this.registerSuspendGuard(context);
		this.registerShortcutScope(context);
		this.setShiftEnterNewline(context.terminal, context.shiftEnterNewline ?? false, context.onShiftEnterNewline);
		if (context.clipboard) {
			this.registerWslClipboard(context);
		} else {
			this.registerPasteHandler(context);
		}
	}

	private registerSuspendGuard(context: KeyRouterContext): void {
		const handler = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing || isImeKey(event)) return;
			const modifiers = [
				...(event.ctrlKey ? ["Ctrl"] : []), ...(event.altKey ? ["Alt"] : []),
				...(event.shiftKey ? ["Shift"] : []), ...(event.metaKey ? ["Meta"] : []),
			] as Hotkey["modifiers"];
			const key = normalizeObsidianHotkey({ modifiers, key: event.key });
			if (!context.suspendTerminalHotkeys?.has(key)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (!event.repeat) context.onSuspendBlocked?.();
		};
		context.container.addEventListener("keydown", handler, true);
		this.disposers.push(() => context.container.removeEventListener("keydown", handler, true));
	}

	setShiftEnterNewline(terminal: Terminal, enabled: boolean, onShiftEnterNewline?: () => void): void {
		this.shiftEnterDisposer?.();
		this.shiftEnterDisposer = null;
		this.clearShiftEnterTimers();
		if (!enabled || !onShiftEnterNewline) return;

		terminal.attachCustomKeyEventHandler((event) => {
			if (event.isComposing || isImeKey(event)) return true;
			if (event.type === "keydown" && event.key === "Enter" && event.shiftKey &&
				!event.ctrlKey && !event.altKey && !event.metaKey) {
				event.preventDefault();
				// xterm defers compositionend commits by one task. Queue this after
				// that task so composed text reaches onData before the newline.
				const ownerWindow = terminal.element?.ownerDocument.defaultView ?? window;
				const timer = { id: 0, window: ownerWindow };
				timer.id = ownerWindow.setTimeout(() => {
					this.shiftEnterTimers.delete(timer);
					onShiftEnterNewline();
				}, 0);
				this.shiftEnterTimers.add(timer);
				return false;
			}
			return true;
		});
		this.shiftEnterDisposer = () => terminal.attachCustomKeyEventHandler(() => true);
	}

	private clearShiftEnterTimers(): void {
		for (const timer of this.shiftEnterTimers) timer.window.clearTimeout(timer.id);
		this.shiftEnterTimers.clear();
	}

	private registerWslClipboard(context: KeyRouterContext): void {
		const { clipboard, container, terminal } = context;
		if (!clipboard) return;

		const reportFailure = (error: unknown) => {
			const detail = error instanceof Error ? error.message : String(error);
			context.onClipboardError?.(`Windows clipboard: ${detail}`);
		};
		const normalizePaste = (text: string) => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		const copySelection = () => {
			const manualCopy = typeof context.copySelectionOnCtrlC === "function"
				? context.copySelectionOnCtrlC()
				: context.copySelectionOnCtrlC;
			if (!manualCopy || !terminal.hasSelection()) return false;
			const selection = terminal.getSelection();
			void clipboard.writeText(selection).then(() => {
				if (terminal.getSelection() === selection) terminal.clearSelection();
			}, reportFailure);
			return true;
		};
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
			const key = event.key.toLowerCase();
			if (key === "c") {
				if (!copySelection()) return;
				stop(event);
			} else if (key === "v") {
				stop(event);
				pasteFromWindows();
			}
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
					if (event.isComposing || isImeKey(event)) return;
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
		this.shiftEnterDisposer?.();
		this.shiftEnterDisposer = null;
		this.clearShiftEnterTimers();
		for (const disposer of this.disposers) {
			try { disposer(); } catch { /* ignore */ }
		}
		this.disposers = [];
	}
}

// Some Electron IMEs send 229 before isComposing becomes true. Keep that
// compatibility check isolated instead of using deprecated keyCode for keys.
function isImeKey(event: KeyboardEvent): boolean {
	return Reflect.get(event, "keyCode") === 229;
}
