import { describe, expect, it, vi } from "vitest";
import type { Scope } from "obsidian";
import type { KeyRouterContext } from "./terminalKeyRouter";
import { TerminalKeyRouter } from "./terminalKeyRouter";

function registerRouter(
	customKeys: Record<string, Array<{ modifiers: string[]; key: string }> | undefined> = {},
	reservedTerminalHotkeys: ReadonlySet<string> = new Set(),
	registeredCommandIds?: ReadonlySet<string>,
	clipboard?: { readText(): Promise<string>; writeText(text: string): Promise<void> },
	onClipboardImagePaste?: (png: Buffer) => void | Promise<void>,
	copySelectionOnCtrlC = false,
	suspendTerminalHotkeys?: ReadonlySet<string>,
) {
	const containerHandlers = new Map<string, Array<(event: Event) => void>>();
	const suspendBlocked = vi.fn();
	let customKeyEventHandler: ((event: KeyboardEvent) => boolean) | undefined;

	const terminalPaste = vi.fn();
	const terminalClearSelection = vi.fn();
	let selection = "";
	let osc52Handler: ((data: string) => boolean | Promise<boolean>) | undefined;
	const clipboardError = vi.fn();
	const executeCommandById = vi.fn(() => true);
	const pushScope = vi.fn();
	const popScope = vi.fn();
	const defaultKeys = {
		"opencode:new-session": [{ modifiers: ["Mod"], key: "n" }],
		"app:open-settings": [{ modifiers: ["Mod"], key: "," }],
	};
	const activeCommandIds = registeredCommandIds ?? new Set([
		...Object.keys(defaultKeys),
		...Object.keys(customKeys),
	]);
	const context = {
		app: {
			vault: { adapter: {}, configDir: "test-config" },
			hotkeyManager: {
				defaultKeys,
				customKeys,
			},
			commands: {
				executeCommandById,
				listCommands: () => [...activeCommandIds].map((id) => ({ id })),
			},
			keymap: { pushScope, popScope },
		},
		terminal: {
			attachCustomKeyEventHandler: (handler: (event: KeyboardEvent) => boolean) => {
				customKeyEventHandler = handler;
			},
			paste: terminalPaste,
			hasSelection: () => Boolean(selection),
			getSelection: () => selection,
			clearSelection: terminalClearSelection,
			parser: {
				registerOscHandler: (_identifier: number, handler: typeof osc52Handler) => {
					osc52Handler = handler;
					return { dispose: vi.fn() };
				},
			},
		},
		reservedTerminalHotkeys,
		suspendTerminalHotkeys,
		onSuspendBlocked: suspendBlocked,
		clipboard,
		copySelectionOnCtrlC,
		onClipboardError: clipboardError,
		onClipboardImagePaste,
		container: {
			contains: () => true,
			ownerDocument: { activeElement: null },
			addEventListener: (type: string, handler: (event: Event) => void) => {
				containerHandlers.set(type, [...(containerHandlers.get(type) ?? []), handler]);
			},
			removeEventListener: vi.fn(),
		},
	} as unknown as KeyRouterContext;

	const router = new TerminalKeyRouter();
	router.register(context);

	return {
		terminalPaste,
		suspendBlocked,
		terminalClearSelection,
		clipboardError,
		setSelection: (value: string) => { selection = value; },
		executeCommandById,
		pushScope,
		popScope,
		dispatchContainerEvent: (type: string, event: Partial<FocusEvent> = {}) => {
			containerHandlers.get(type)?.forEach(handler => handler(event as FocusEvent));
		},
		dispatchPaste: (text: string) => {
			const preventDefault = vi.fn();
			const stopImmediatePropagation = vi.fn();
			containerHandlers.get("paste")?.forEach(handler => handler({
				target: {},
				clipboardData: { getData: () => text },
				preventDefault,
				stopImmediatePropagation,
			} as unknown as ClipboardEvent));
			return { preventDefault, stopImmediatePropagation };
		},
		dispatchKeydown: (event: Partial<KeyboardEvent>) => {
			const preventDefault = vi.fn();
			const stopImmediatePropagation = vi.fn();
			let stopped = false;
			let prevented = false;
			const dispatched = {
				target: {},
				get defaultPrevented() { return prevented; },
				preventDefault: () => { preventDefault(); prevented = true; },
				stopImmediatePropagation: () => { stopImmediatePropagation(); stopped = true; },
				...event,
			} as unknown as KeyboardEvent;
			for (const handler of containerHandlers.get("keydown") ?? []) {
				handler(dispatched);
				if (stopped) break;
			}
			return { preventDefault, stopImmediatePropagation };
		},
		dispatchOsc52: (data: string) => osc52Handler?.(data),
		dispatchTerminalKey: (event: Partial<KeyboardEvent> = {}) => {
			const preventDefault = vi.fn();
			const result = customKeyEventHandler?.({
				type: "keydown",
				key: "Enter",
				shiftKey: true,
				ctrlKey: false,
				altKey: false,
				metaKey: false,
				isComposing: false,
				keyCode: 13,
				preventDefault,
				...event,
			} as unknown as KeyboardEvent);
			return { result, preventDefault };
		},
		setShiftEnterNewline: (enabled: boolean, callback?: () => void) =>
			router.setShiftEnterNewline(context.terminal, enabled, callback),
		router,
	};
}

describe("TerminalKeyRouter", () => {
	it("blocks suspend shortcuts before xterm while preserving composition and other modifiers", () => {
		const context = registerRouter({}, new Set(), undefined, undefined, undefined, false, new Set(["ctrl+z"]));
		const blocked = context.dispatchKeydown({ key: "z", ctrlKey: true });
		expect(blocked.preventDefault).toHaveBeenCalledOnce();
		expect(blocked.stopImmediatePropagation).toHaveBeenCalledOnce();
		expect(context.suspendBlocked).toHaveBeenCalledOnce();
		for (const extra of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { altKey: true }, { metaKey: true }]) {
			expect(context.dispatchKeydown({ key: "z", ctrlKey: true, ...extra }).preventDefault).not.toHaveBeenCalled();
		}
		context.dispatchKeydown({ key: "z", ctrlKey: true, repeat: true });
		expect(context.suspendBlocked).toHaveBeenCalledOnce();
		context.router.dispose();
	});

	it("leaves Ctrl+Z available when it is not a suspend binding", () => {
		const context = registerRouter({}, new Set(), undefined, undefined, undefined, false, new Set());
		expect(context.dispatchKeydown({ key: "z", ctrlKey: true }).preventDefault).not.toHaveBeenCalled();
		context.router.dispose();
	});

	it("activates an isolated scope for effective Obsidian shortcuts", () => {
		const { dispatchContainerEvent, executeCommandById, pushScope, router } = registerRouter();

		dispatchContainerEvent("focusin");

		expect(pushScope).toHaveBeenCalledOnce();
		const scope = pushScope.mock.calls[0][0] as Scope & {
			handlers: Array<{
				modifiers: string[] | null;
				key: string | null;
				callback: (event: KeyboardEvent, context: unknown) => unknown;
			}>;
		};
		expect(scope.handlers.map(({ modifiers, key }) => ({ modifiers, key }))).toEqual([
			{ modifiers: ["Mod"], key: "n" },
			{ modifiers: ["Mod"], key: "," },
		]);
		scope.handlers[0].callback({ isComposing: false } as KeyboardEvent, {});
		expect(executeCommandById).toHaveBeenCalledWith("opencode:new-session");
		router.dispose();
	});

	it("uses a custom hotkey instead of the command default", () => {
		const { dispatchContainerEvent, pushScope, router } = registerRouter({
			"opencode:new-session": [{ modifiers: ["Alt"], key: "x" }],
		});

		dispatchContainerEvent("focusin");
		const scope = pushScope.mock.calls[0][0] as Scope & {
			handlers: Array<{ modifiers: string[] | null; key: string | null }>;
		};
		expect(scope.handlers.map(({ modifiers, key }) => ({ modifiers, key }))).toEqual([
			{ modifiers: ["Alt"], key: "x" },
			{ modifiers: ["Mod"], key: "," },
		]);
		router.dispose();
	});

	it("runs a user-assigned Obsidian shortcut when OpenCode does not own it", () => {
		const commandId = "darlal-switcher-plus:switcher-plus:open-commands";
		const { dispatchContainerEvent, executeCommandById, pushScope, router } = registerRouter({
			[commandId]: [{ modifiers: ["Mod"], key: "P" }],
		});

		dispatchContainerEvent("focusin");
		const scope = pushScope.mock.calls[0][0] as Scope & {
			handlers: Array<{ key: string | null; callback: (event: KeyboardEvent) => unknown }>;
		};
		const ctrlP = scope.handlers.find(({ key }) => key === "P");
		expect(ctrlP).toBeDefined();
		ctrlP!.callback({ isComposing: false } as KeyboardEvent);
		expect(executeCommandById).toHaveBeenCalledWith(commandId);
		router.dispose();
	});

	it("routes the configurable close-terminal shortcut while the terminal is focused", () => {
		const commandId = "opencode:close-terminal";
		const { dispatchContainerEvent, executeCommandById, pushScope, router } = registerRouter({
			[commandId]: [{ modifiers: ["Mod", "Shift"], key: "W" }],
		});

		dispatchContainerEvent("focusin");
		const scope = pushScope.mock.calls[0][0] as Scope & {
			handlers: Array<{ key: string | null; callback: (event: KeyboardEvent) => unknown }>;
		};
		const closeTerminal = scope.handlers.find(({ key }) => key === "W");
		expect(closeTerminal).toBeDefined();
		closeTerminal!.callback({ isComposing: false } as KeyboardEvent);
		expect(executeCommandById).toHaveBeenCalledWith(commandId);
		router.dispose();
	});

	it("leaves a shortcut with OpenCode when OpenCode owns it", () => {
		const commandId = "darlal-switcher-plus:switcher-plus:open-commands";
		const { dispatchContainerEvent, pushScope, router } = registerRouter({
			[commandId]: [{ modifiers: ["Mod"], key: "P" }],
		}, new Set(["ctrl+p"]));

		dispatchContainerEvent("focusin");
		const scope = pushScope.mock.calls[0][0] as Scope & { handlers: Array<{ key: string | null }> };
		expect(scope.handlers.some(({ key }) => key === "P")).toBe(false);
		router.dispose();
	});

	it("ignores stale hotkeys for commands that are no longer registered", () => {
		const staleId = "opencode:toggle-opencode-terminal-sidebar";
		const liveId = "opencode:toggle-terminal-sidebar";
		const hotkey = [{ modifiers: ["Alt", "Mod"], key: "I" }];
		const { dispatchContainerEvent, executeCommandById, pushScope, router } = registerRouter({
			[staleId]: hotkey,
			[liveId]: hotkey,
		}, new Set(), new Set([liveId]));

		dispatchContainerEvent("focusin");
		const scope = pushScope.mock.calls[0][0] as Scope & {
			handlers: Array<{ key: string | null; callback: (event: KeyboardEvent) => unknown }>;
		};
		const ctrlAltI = scope.handlers.filter(({ key }) => key === "I");
		expect(ctrlAltI).toHaveLength(1);
		ctrlAltI[0].callback({ isComposing: false } as KeyboardEvent);
		expect(executeCommandById).toHaveBeenCalledWith(liveId);
		router.dispose();
	});

	it("does not restore a default hotkey the user removed", () => {
		const { dispatchContainerEvent, pushScope, router } = registerRouter({
			"opencode:new-session": [],
		});

		dispatchContainerEvent("focusin");
		const scope = pushScope.mock.calls[0][0] as Scope & { handlers: unknown[] };
		expect(scope.handlers).toHaveLength(1);
		expect(scope.handlers[0]).toMatchObject({ modifiers: ["Mod"], key: "," });
		router.dispose();
	});

	it("does not run an Obsidian command during IME composition", () => {
		const { dispatchContainerEvent, executeCommandById, pushScope, router } = registerRouter();

		dispatchContainerEvent("focusin");
		const scope = pushScope.mock.calls[0][0] as Scope & {
			handlers: Array<{ callback: (event: KeyboardEvent, context: unknown) => unknown }>;
		};
		const result = scope.handlers[0].callback({ isComposing: true } as KeyboardEvent, {});
		expect(result).toBeUndefined();
		expect(executeCommandById).not.toHaveBeenCalled();
		router.dispose();
	});

	it("routes enabled Shift+Enter to the callback and preserves ordinary Enter and Alt+Enter", () => {
		vi.useFakeTimers();
		try {
			const onShiftEnterNewline = vi.fn();
			const context = registerRouter();
			context.setShiftEnterNewline(true, onShiftEnterNewline);

			const shiftEnter = context.dispatchTerminalKey();
			expect(shiftEnter.result).toBe(false);
			expect(shiftEnter.preventDefault).toHaveBeenCalledOnce();
			vi.runAllTimers();
			expect(onShiftEnterNewline).toHaveBeenCalledOnce();

			expect(context.dispatchTerminalKey({ shiftKey: false }).result).toBe(true);
			expect(context.dispatchTerminalKey({ altKey: true }).result).toBe(true);
			expect(onShiftEnterNewline).toHaveBeenCalledOnce();
			context.router.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("passes composing and legacy IME Shift+Enter events to xterm", () => {
		const onShiftEnterNewline = vi.fn();
		const context = registerRouter();
		context.setShiftEnterNewline(true, onShiftEnterNewline);

		expect(context.dispatchTerminalKey({ isComposing: true }).result).toBe(true);
		expect(context.dispatchTerminalKey({ keyCode: 229 }).result).toBe(true);
		expect(onShiftEnterNewline).not.toHaveBeenCalled();
		context.router.dispose();
	});

	it("defers Shift+Enter until xterm can flush a completed composition", () => {
		vi.useFakeTimers();
		try {
			const onShiftEnterNewline = vi.fn();
			const context = registerRouter();
			context.setShiftEnterNewline(true, onShiftEnterNewline);

			const shiftEnter = context.dispatchTerminalKey();
			expect(shiftEnter.result).toBe(false);
			expect(onShiftEnterNewline).not.toHaveBeenCalled();

			vi.runAllTimers();
			expect(onShiftEnterNewline).toHaveBeenCalledOnce();
			context.router.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("applies disabling and re-enabling of Shift+Enter immediately", () => {
		vi.useFakeTimers();
		try {
			const onShiftEnterNewline = vi.fn();
			const context = registerRouter();
			context.setShiftEnterNewline(true, onShiftEnterNewline);
			expect(context.dispatchTerminalKey().result).toBe(false);

			context.setShiftEnterNewline(false, onShiftEnterNewline);
			expect(context.dispatchTerminalKey().result).toBe(true);
			vi.runAllTimers();
			expect(onShiftEnterNewline).not.toHaveBeenCalled();

			context.setShiftEnterNewline(true, onShiftEnterNewline);
			expect(context.dispatchTerminalKey().result).toBe(false);
			vi.runAllTimers();
			expect(onShiftEnterNewline).toHaveBeenCalledOnce();
			context.router.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("pushes the terminal scope once on focus and removes it on blur", () => {
		const { dispatchContainerEvent, pushScope, popScope, router } = registerRouter();

		dispatchContainerEvent("focusin");
		dispatchContainerEvent("focusin");
		dispatchContainerEvent("focusout", { relatedTarget: null });

		expect(pushScope).toHaveBeenCalledOnce();
		expect(popScope).toHaveBeenCalledOnce();
		expect(popScope).toHaveBeenCalledWith(pushScope.mock.calls[0][0]);
		router.dispose();
	});

	it("routes paste through xterm's input path", () => {
		const { dispatchPaste, terminalPaste, router } = registerRouter();

		const event = dispatchPaste("first\r\nsecond\rthird");

		expect(terminalPaste).toHaveBeenCalledWith("first\nsecond\nthird");
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
		router.dispose();
	});

	it("leaves Ctrl+C to OpenCode when copy-on-select is enabled", () => {
		const clipboard = { readText: vi.fn(), writeText: vi.fn().mockResolvedValue(undefined) };
		const context = registerRouter({}, new Set(), undefined, clipboard);
		context.setSelection("selected text");

		const event = context.dispatchKeydown({ key: "c", ctrlKey: true });

		expect(clipboard.writeText).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
		context.router.dispose();
	});

	it("copies a WSL selection with Ctrl+C when OpenCode copy-on-select is disabled", async () => {
		const clipboard = { readText: vi.fn(), writeText: vi.fn().mockResolvedValue(undefined) };
		const context = registerRouter({}, new Set(), undefined, clipboard, undefined, true);
		context.setSelection("Décodage 中文 😀\n$HOME 'quotes'");

		const event = context.dispatchKeydown({ key: "c", ctrlKey: true });
		await vi.waitFor(() => expect(context.terminalClearSelection).toHaveBeenCalledOnce());

		expect(clipboard.writeText).toHaveBeenCalledWith("Décodage 中文 😀\n$HOME 'quotes'");
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
		context.router.dispose();
	});

	it("still sends Ctrl+C to OpenCode without a selection when copy-on-select is disabled", () => {
		const clipboard = { readText: vi.fn(), writeText: vi.fn() };
		const context = registerRouter({}, new Set(), undefined, clipboard, undefined, true);

		const event = context.dispatchKeydown({ key: "c", ctrlKey: true });

		expect(clipboard.writeText).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
		context.router.dispose();
	});

	it("retains the selection when conditional Ctrl+C copy fails", async () => {
		const clipboard = {
			readText: vi.fn(),
			writeText: vi.fn().mockRejectedValue(new Error("PowerShell interop failed")),
		};
		const context = registerRouter({}, new Set(), undefined, clipboard, undefined, true);
		context.setSelection("keep me");

		context.dispatchKeydown({ key: "c", ctrlKey: true });
		await vi.waitFor(() => expect(context.clipboardError).toHaveBeenCalledWith(expect.stringMatching(/PowerShell interop failed/)));

		expect(context.terminalClearSelection).not.toHaveBeenCalled();
		context.router.dispose();
	});

	it("reads the Windows clipboard for WSL paste and normalizes line endings", async () => {
		const clipboard = {
			readText: vi.fn().mockResolvedValue("é中😀\r\nsecond\rthird"),
			writeText: vi.fn(),
		};
		const context = registerRouter({}, new Set(), undefined, clipboard);

		const event = context.dispatchKeydown({ key: "v", ctrlKey: true });
		await vi.waitFor(() => expect(context.terminalPaste).toHaveBeenCalledWith("é中😀\nsecond\nthird"));

		expect(event.preventDefault).toHaveBeenCalledOnce();
		context.router.dispose();
	});

	it("gives a Windows clipboard image precedence over text paste", async () => {
		const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
		const onClipboardImagePaste = vi.fn().mockResolvedValue(undefined);
		const clipboard = {
			readImagePng: vi.fn().mockResolvedValue(image),
			readText: vi.fn().mockResolvedValue("fallback text"),
			writeText: vi.fn(),
		};
		const imageContext = registerRouter({}, new Set(), undefined, clipboard, onClipboardImagePaste);

		imageContext.dispatchKeydown({ key: "v", ctrlKey: true });
		await vi.waitFor(() => expect(onClipboardImagePaste).toHaveBeenCalledWith(image));

		expect(clipboard.readText).not.toHaveBeenCalled();
		expect(imageContext.terminalPaste).not.toHaveBeenCalled();
		imageContext.router.dispose();
	});

	it("routes only valid OSC 52 clipboard sets to the WSL bridge", async () => {
		const clipboard = { readText: vi.fn(), writeText: vi.fn().mockResolvedValue(undefined) };
		const context = registerRouter({}, new Set(), undefined, clipboard);
		const text = "OSC é中😀";

		await context.dispatchOsc52(`c;${Buffer.from(text, "utf8").toString("base64")}`);
		await context.dispatchOsc52("c;?");
		await context.dispatchOsc52("c;not base64");

		expect(clipboard.writeText).toHaveBeenCalledOnce();
		expect(clipboard.writeText).toHaveBeenCalledWith(text);
		context.router.dispose();
	});
});
