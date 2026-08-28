import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Hotkey } from "obsidian";
import { loadOpenCodeHotkeys, normalizeObsidianHotkey, resolveOpenCodeHotkeys } from "./openCodeKeymap";

const temporaryDirectories: string[] = [];
afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("OpenCode keymap", () => {
	it("reserves OpenCode defaults and its leader", () => {
		const keys = resolveOpenCodeHotkeys();
		expect(keys).toContain("ctrl+b");
		expect(keys).toContain("ctrl+p");
		expect(keys).toContain("ctrl+r");
		expect(keys).toContain("ctrl+x");
	});

	it("keeps Ctrl+P reserved while contextual OpenCode bindings still use it", () => {
		const keys = resolveOpenCodeHotkeys({ command_list: "<leader>p" });
		expect(keys).toContain("ctrl+p");
	});

	it("releases Ctrl+P after every OpenCode owner is disabled", () => {
		const keys = resolveOpenCodeHotkeys({
			command_list: "<leader>p",
			"dialog.select.prev": "up",
			"prompt.autocomplete.prev": "up",
		});
		expect(keys).not.toContain("ctrl+p");
		expect(keys).toContain("ctrl+x");
	});

	it("normalizes Obsidian Mod for the host platform", () => {
		const hotkey: Hotkey = { modifiers: ["Mod"], key: "P" };
		expect(normalizeObsidianHotkey(hotkey, "win32")).toBe("ctrl+p");
		expect(normalizeObsidianHotkey(hotkey, "darwin")).toBe("meta+p");
	});

	it("loads JSONC overrides from an explicit OpenCode TUI config", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-keymap-"));
		temporaryDirectories.push(directory);
		const config = path.join(directory, "tui.jsonc");
		fs.writeFileSync(config, `{
			// Ctrl+P is released only after all three owners move.
			"keybinds": {
				"command_list": "<leader>p",
				"dialog.select.prev": "up",
				"prompt.autocomplete.prev": "up",
			},
		}`);

		const keys = loadOpenCodeHotkeys(directory, {
			XDG_CONFIG_HOME: path.join(directory, "missing"),
			OPENCODE_TUI_CONFIG: config,
		});
		expect(keys).not.toContain("ctrl+p");
		expect(keys).toContain("ctrl+x");
	});
});
