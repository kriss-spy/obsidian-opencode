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

	it("releases terminal suspend on Windows unless the user configured it", () => {
		expect(resolveOpenCodeHotkeys({}, "win32")).not.toContain("ctrl+z");
		expect(resolveOpenCodeHotkeys({ terminal_suspend: "ctrl+z" }, "win32")).toContain("ctrl+z");
		expect(resolveOpenCodeHotkeys({}, "linux")).toContain("ctrl+z");
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

	it("preserves commas before bracket keys inside JSONC strings", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-keymap-"));
		temporaryDirectories.push(directory);
		const config = path.join(directory, "tui.jsonc");
		fs.writeFileSync(config, `{
			"keybinds": {
				"app_debug": "ctrl+alt+i,]", // trailing comments are valid JSONC
			},
		}`);

		const keys = loadOpenCodeHotkeys(directory, {
			XDG_CONFIG_HOME: path.join(directory, "missing"),
			OPENCODE_TUI_CONFIG: config,
		});
		expect(keys).toContain("ctrl+alt+i");
	});

	it("expands environment variables in OpenCode keybindings", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-keymap-"));
		temporaryDirectories.push(directory);
		const config = path.join(directory, "tui.json");
		fs.writeFileSync(config, JSON.stringify({ keybinds: { app_debug: "{env:TEST_OPENCODE_KEY}" } }));

		const keys = loadOpenCodeHotkeys(directory, {
			XDG_CONFIG_HOME: path.join(directory, "missing"),
			OPENCODE_TUI_CONFIG: config,
			TEST_OPENCODE_KEY: "ctrl+alt+i",
		});
		expect(keys).toContain("ctrl+alt+i");
	});

	it("expands relative file references in OpenCode keybindings", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-keymap-"));
		temporaryDirectories.push(directory);
		const config = path.join(directory, "tui.json");
		fs.writeFileSync(path.join(directory, "shortcut.txt"), "ctrl+alt+i\n");
		fs.writeFileSync(config, JSON.stringify({ keybinds: { app_debug: "{file:shortcut.txt}" } }));

		const keys = loadOpenCodeHotkeys(directory, {
			XDG_CONFIG_HOME: path.join(directory, "missing"),
			OPENCODE_TUI_CONFIG: config,
		});
		expect(keys).toContain("ctrl+alt+i");
	});

	it("applies .opencode keybindings after project tui files", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-keymap-"));
		temporaryDirectories.push(directory);
		const project = path.join(directory, "project");
		fs.mkdirSync(path.join(directory, ".opencode"));
		fs.mkdirSync(project);
		fs.writeFileSync(path.join(directory, ".opencode", "tui.json"), JSON.stringify({
			keybinds: { app_debug: "ctrl+alt+i" },
		}));
		fs.writeFileSync(path.join(project, "tui.json"), JSON.stringify({
			keybinds: { app_debug: "ctrl+alt+j" },
		}));

		const keys = loadOpenCodeHotkeys(project, {
			XDG_CONFIG_HOME: path.join(directory, "missing"),
		});
		expect(keys).toContain("ctrl+alt+i");
		expect(keys).not.toContain("ctrl+alt+j");
	});

	it("skips project keybindings when project config is disabled", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-keymap-"));
		temporaryDirectories.push(directory);
		fs.writeFileSync(path.join(directory, "tui.json"), JSON.stringify({
			keybinds: { app_debug: "ctrl+alt+i" },
		}));

		const keys = loadOpenCodeHotkeys(directory, {
			XDG_CONFIG_HOME: path.join(directory, "missing"),
			OPENCODE_DISABLE_PROJECT_CONFIG: "true",
		});
		expect(keys).not.toContain("ctrl+alt+i");
	});
});
