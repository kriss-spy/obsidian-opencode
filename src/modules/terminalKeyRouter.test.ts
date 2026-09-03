import { describe, expect, it, vi } from "vitest";
import type { Scope } from "obsidian";
import type { KeyRouterContext } from "./terminalKeyRouter";
import { TerminalKeyRouter } from "./terminalKeyRouter";

function registerRouter(
	customKeys: Record<string, Array<{ modifiers: string[]; key: string }> | undefined> = {},
	reservedTerminalHotkeys: ReadonlySet<string> = new Set(),
	registeredCommandIds?: ReadonlySet<string>,
) {
	const containerHandlers = new Map<string, (event: Event) => void>();

	const terminalPaste = vi.fn();
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
		terminal: { paste: terminalPaste },
		reservedTerminalHotkeys,
		container: {
			contains: () => true,
			ownerDocument: { activeElement: null },
			addEventListener: (type: string, handler: (event: Event) => void) => {
				containerHandlers.set(type, handler);
			},
			removeEventListener: vi.fn(),
		},
	} as unknown as KeyRouterContext;

	const router = new TerminalKeyRouter();
	router.register(context);

	return {
		terminalPaste,
		executeCommandById,
		pushScope,
		popScope,
		dispatchContainerEvent: (type: string, event: Partial<FocusEvent> = {}) => {
			containerHandlers.get(type)?.(event as FocusEvent);
		},
		dispatchPaste: (text: string) => {
			const preventDefault = vi.fn();
			const stopImmediatePropagation = vi.fn();
			containerHandlers.get("paste")?.({
				target: {},
				clipboardData: { getData: () => text },
				preventDefault,
				stopImmediatePropagation,
			} as unknown as ClipboardEvent);
			return { preventDefault, stopImmediatePropagation };
		},
		router,
	};
}

describe("TerminalKeyRouter", () => {
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
});
