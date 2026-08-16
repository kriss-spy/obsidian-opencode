import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyRouterContext } from "./terminalKeyRouter";
import { TerminalKeyRouter } from "./terminalKeyRouter";

interface TestKeyboardEvent {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
}

function registerRouter() {
	let keydownHandler: ((event: KeyboardEvent) => void) | undefined;
	const activeDocument = {
		addEventListener: (type: string, handler: (event: KeyboardEvent) => void) => {
			if (type === "keydown") keydownHandler = handler;
		},
		removeEventListener: vi.fn(),
	};
	Reflect.set(globalThis, "activeDocument", activeDocument);

	const writeStdin = vi.fn();
	const context = {
		app: {
			vault: { adapter: {}, configDir: ".obsidian" },
			hotkeyManager: { defaultKeys: {} },
		},
		terminal: {},
		ptySession: {
			getStdin: () => ({}),
			writeStdin,
		},
		container: {
			contains: () => true,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		},
	} as unknown as KeyRouterContext;

	const router = new TerminalKeyRouter();
	router.register(context);

	return {
		dispatchKeydown(init: TestKeyboardEvent) {
			const event = {
				ctrlKey: false,
				metaKey: false,
				altKey: false,
				shiftKey: false,
				isComposing: false,
				target: {},
				preventDefault: vi.fn(),
				stopImmediatePropagation: vi.fn(),
				...init,
			} as unknown as KeyboardEvent;
			keydownHandler?.(event);
			return event;
		},
		writeStdin,
		router,
	};
}

afterEach(() => {
	Reflect.deleteProperty(globalThis, "activeDocument");
});

describe("TerminalKeyRouter", () => {
	it.each([
		{},
		{ shiftKey: true },
		{ ctrlKey: true },
		{ metaKey: true },
		{ altKey: true },
	])("does not forward Caps Lock presses with modifiers %o", (modifiers) => {
		const { dispatchKeydown, writeStdin, router } = registerRouter();

		const event = dispatchKeydown({ key: "CapsLock", ...modifiers });

		expect(writeStdin).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
		router.dispose();
	});

	it("continues forwarding text and modifier sequences", () => {
		const { dispatchKeydown, writeStdin, router } = registerRouter();

		dispatchKeydown({ key: "a" });
		dispatchKeydown({ key: "A", shiftKey: true });
		dispatchKeydown({ key: "c", ctrlKey: true });
		dispatchKeydown({ key: "x", altKey: true });

		expect(writeStdin.mock.calls).toEqual([["a"], ["A"], ["\x03"], ["\x1bx"]]);
		router.dispose();
	});
});
