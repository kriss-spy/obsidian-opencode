import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Hotkey } from "obsidian";

type KeyStroke = {
	name: string;
	ctrl?: boolean;
	shift?: boolean;
	meta?: boolean;
	super?: boolean;
	hyper?: boolean;
};

type Binding = string | KeyStroke | { key: string | KeyStroke } | false;
type BindingValue = Binding | Binding[];

// Snapshot of OpenCode's non-empty defaults. Configured keys not present here are
// still accepted, so commands whose upstream default is `none` can be enabled.
const DEFAULT_BINDINGS: Record<string, BindingValue> = {
	leader: "ctrl+x",
	app_exit: "ctrl+c,ctrl+d,<leader>q",
	command_list: "ctrl+p",
	diff_close: "escape,q", diff_toggle: "enter,space", diff_expand: "right",
	diff_expand_all: "E", diff_collapse: "left", diff_switch_focus: "tab",
	diff_next_hunk: "]", diff_previous_hunk: "[", diff_next_file: "n",
	diff_previous_file: "p", diff_toggle_file_tree: "b", diff_single_patch: "s",
	diff_switch_source: "d", diff_toggle_view: "v", diff_help: "?",
	editor_open: "<leader>e", theme_list: "<leader>t", sidebar_toggle: "<leader>b",
	status_view: "<leader>s", session_export: "<leader>x", session_new: "<leader>n",
	session_list: "<leader>l", session_timeline: "<leader>g", session_rename: "ctrl+r",
	session_delete: "ctrl+d", session_interrupt: "escape", session_background: "ctrl+b",
	session_compact: "<leader>c", session_queued_prompts: "<leader>q",
	session_child_first: "<leader>down", session_child_cycle: "right",
	session_child_cycle_reverse: "left", session_parent: "up", session_pin_toggle: "ctrl+f",
	session_quick_switch_1: "<leader>1", session_quick_switch_2: "<leader>2",
	session_quick_switch_3: "<leader>3", session_quick_switch_4: "<leader>4",
	session_quick_switch_5: "<leader>5", session_quick_switch_6: "<leader>6",
	session_quick_switch_7: "<leader>7", session_quick_switch_8: "<leader>8",
	session_quick_switch_9: "<leader>9", stash_delete: "ctrl+d",
	model_provider_list: "ctrl+a", model_favorite_toggle: "ctrl+f", model_list: "<leader>m",
	model_cycle_recent: "f2", model_cycle_recent_reverse: "shift+f2", agent_list: "<leader>a",
	agent_cycle: "tab", agent_cycle_reverse: "shift+tab", variant_cycle: "ctrl+t",
	messages_page_up: "pageup,ctrl+alt+b", messages_page_down: "pagedown,ctrl+alt+f",
	messages_line_up: "ctrl+alt+y", messages_line_down: "ctrl+alt+e",
	messages_half_page_up: "ctrl+alt+u", messages_half_page_down: "ctrl+alt+d",
	messages_first: "ctrl+g,home", messages_last: "ctrl+alt+g,end",
	messages_copy: "<leader>y", messages_undo: "<leader>u", messages_redo: "<leader>r",
	messages_toggle_conceal: "<leader>h", input_clear: "ctrl+c",
	input_paste: { key: "ctrl+v" }, input_submit: "return",
	input_newline: "shift+return,ctrl+return,alt+return,ctrl+j",
	input_move_left: "left,ctrl+b", input_move_right: "right,ctrl+f",
	input_move_up: "up", input_move_down: "down", input_select_left: "shift+left",
	input_select_right: "shift+right", input_select_up: "shift+up", input_select_down: "shift+down",
	input_line_home: "ctrl+a", input_line_end: "ctrl+e", input_select_line_home: "ctrl+shift+a",
	input_select_line_end: "ctrl+shift+e", input_visual_line_home: "alt+a",
	input_visual_line_end: "alt+e", input_select_visual_line_home: "alt+shift+a",
	input_select_visual_line_end: "alt+shift+e", input_buffer_home: "home", input_buffer_end: "end",
	input_select_buffer_home: "shift+home", input_select_buffer_end: "shift+end",
	input_delete_line: "ctrl+shift+d", input_delete_to_line_end: "ctrl+k",
	input_delete_to_line_start: "ctrl+u", input_backspace: "backspace,shift+backspace",
	input_delete: "ctrl+d,delete,shift+delete", input_undo: "ctrl+-,super+z",
	input_redo: "ctrl+.,super+shift+z", input_word_forward: "alt+f,alt+right,ctrl+right",
	input_word_backward: "alt+b,alt+left,ctrl+left",
	input_select_word_forward: "alt+shift+f,alt+shift+right",
	input_select_word_backward: "alt+shift+b,alt+shift+left",
	input_delete_word_forward: "alt+d,alt+delete,ctrl+delete",
	input_delete_word_backward: "ctrl+w,ctrl+backspace,alt+backspace", input_select_all: "super+a",
	history_previous: "up", history_next: "down", "dialog.select.prev": "up,ctrl+p",
	"dialog.select.next": "down,ctrl+n", "dialog.select.page_up": "pageup",
	"dialog.select.page_down": "pagedown", "dialog.select.home": "home", "dialog.select.end": "end",
	"dialog.select.submit": "return", "dialog.prompt.submit": "return", "dialog.mcp.toggle": "space",
	"dialog.move_session.new": "ctrl+m", "dialog.move_session.delete": "ctrl+d",
	"dialog.move_session.refresh": "ctrl+r", "prompt.autocomplete.prev": "up,ctrl+p",
	"prompt.autocomplete.next": "down,ctrl+n", "prompt.autocomplete.hide": "escape",
	"prompt.autocomplete.select": "return", "prompt.autocomplete.complete": "tab",
	"permission.prompt.fullscreen": "ctrl+f", "plugins.toggle": "space",
	"dialog.plugins.install": "shift+i", terminal_suspend: "ctrl+z", tips_toggle: "<leader>h",
	which_key_toggle: "ctrl+alt+k", which_key_layout_toggle: "ctrl+alt+shift+k",
	which_key_pending_toggle: "ctrl+alt+shift+p", which_key_group_previous: "ctrl+alt+left,ctrl+alt+[",
	which_key_group_next: "ctrl+alt+right,ctrl+alt+]", which_key_scroll_up: "ctrl+alt+up,ctrl+alt+p",
	which_key_scroll_down: "ctrl+alt+down,ctrl+alt+n", which_key_page_up: "ctrl+alt+pageup",
	which_key_page_down: "ctrl+alt+pagedown", which_key_home: "ctrl+alt+home",
	which_key_end: "ctrl+alt+end",
};

const KEY_ALIASES: Record<string, string> = { return: "enter", esc: "escape", cmd: "meta", super: "meta" };
const MODIFIER_ORDER = ["ctrl", "alt", "shift", "meta"];

function canonical(parts: string[]): string {
	const lowered = parts.map((part) => KEY_ALIASES[part.toLowerCase()] ?? part.toLowerCase());
	const key = lowered.find((part) => !MODIFIER_ORDER.includes(part));
	if (!key) return "";
	const modifiers = MODIFIER_ORDER.filter((modifier) => lowered.includes(modifier));
	return [...modifiers, key].join("+");
}

export function normalizeObsidianHotkey(hotkey: Hotkey, platform: NodeJS.Platform = process.platform): string {
	const modifiers = hotkey.modifiers.map((modifier) => {
		const lower = modifier.toLowerCase();
		if (lower === "mod") return platform === "darwin" ? "meta" : "ctrl";
		return KEY_ALIASES[lower] ?? lower;
	});
	return canonical([...modifiers, hotkey.key]);
}

function bindingKeys(value: BindingValue | undefined, leader: string): string[] {
	if (value === undefined || value === false || value === "none") return [];
	const items = Array.isArray(value) ? value : [value];
	return items.flatMap((item) => {
		if (item === false || item === null || item === undefined) return [];
		const key = typeof item === "object"
			? ("key" in item ? item.key : item)
			: item;
		if (key === null || key === undefined || typeof key === "boolean") return [];
		if (typeof key === "object") {
			if (typeof key.name !== "string") return [];
			return [canonical([
				...(key.ctrl ? ["ctrl"] : []), ...(key.meta || key.super ? ["meta"] : []),
				...(key.hyper ? ["ctrl", "alt", "shift", "meta"] : []), ...(key.shift ? ["shift"] : []), key.name,
			])];
		}
		return key.split(",").map((stroke) => {
			const trimmed = stroke.trim();
			if (trimmed.startsWith("<leader>")) return leader;
			const parts = trimmed.split("+");
			const last = parts[parts.length - 1];
			if (last.length === 1 && last !== last.toLowerCase()) parts.unshift("shift");
			return canonical(parts);
		});
	}).filter(Boolean);
}

export function resolveOpenCodeHotkeys(
	overrides: Record<string, BindingValue> = {},
	platform: NodeJS.Platform = process.platform,
): ReadonlySet<string> {
	const bindings = { ...DEFAULT_BINDINGS, ...overrides };
	if (platform === "win32" && !Object.prototype.hasOwnProperty.call(overrides, "terminal_suspend")) {
		bindings.terminal_suspend = false;
	}
	const leaderValue = bindings.leader;
	const leader = bindingKeys(leaderValue, "ctrl+x")[0] ?? "ctrl+x";
	const result = new Set<string>([leader]);
	for (const [name, value] of Object.entries(bindings)) {
		if (name === "leader") continue;
		for (const key of bindingKeys(value, leader)) result.add(key);
	}
	return result;
}

function parseJsonc(text: string): unknown {
	let result = "";
	let inString = false;
	let escaped = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		const next = text[index + 1];
		if (inString) {
			result += char;
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') { inString = true; result += char; continue; }
		if (char === "/" && next === "/") {
			while (index < text.length && text[index] !== "\n") index += 1;
			result += "\n";
			continue;
		}
		if (char === "/" && next === "*") {
			index += 2;
			while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
			index += 1;
			continue;
		}
		result += char;
	}

	let withoutTrailingCommas = "";
	inString = false;
	escaped = false;
	for (let index = 0; index < result.length; index += 1) {
		const char = result[index];
		if (inString) {
			withoutTrailingCommas += char;
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			inString = true;
			withoutTrailingCommas += char;
			continue;
		}
		if (char === ",") {
			let following = index + 1;
			while (/\s/.test(result[following] ?? "")) following += 1;
			if (result[following] === "}" || result[following] === "]") continue;
		}
		withoutTrailingCommas += char;
	}
	return JSON.parse(withoutTrailingCommas);
}

function readOverrides(file: string, env: NodeJS.ProcessEnv): Record<string, BindingValue> {
	try {
		let source = fs.readFileSync(file, "utf8").replace(/\{env:([^}]+)\}/g, (_, name: string) => env[name] ?? "");
		source = source.replace(/\{file:([^}]+)\}/g, (token: string, reference: string, offset: number) => {
			const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
			if (source.slice(lineStart, offset).trimStart().startsWith("//")) return token;
			const referencedFile = reference.startsWith("~/")
				? path.join(os.homedir(), reference.slice(2))
				: path.resolve(path.dirname(file), reference);
			try {
				return JSON.stringify(fs.readFileSync(referencedFile, "utf8").trim()).slice(1, -1);
			} catch {
				return "";
			}
		});
		const parsed = parseJsonc(source) as { keybinds?: unknown };
		return parsed && typeof parsed.keybinds === "object" && parsed.keybinds
			? parsed.keybinds as Record<string, BindingValue>
			: {};
	} catch {
		return {};
	}
}

function configFiles(cwd: string, env: NodeJS.ProcessEnv): string[] {
	const configHome = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
	const files = [path.join(configHome, "opencode", "tui.json"), path.join(configHome, "opencode", "tui.jsonc")];
	if (env.OPENCODE_TUI_CONFIG) files.push(env.OPENCODE_TUI_CONFIG);

	const ancestors: string[] = [];
	for (let directory = path.resolve(cwd);;) {
		ancestors.unshift(directory);
		const parent = path.dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	const projectConfigFlag = env.OPENCODE_DISABLE_PROJECT_CONFIG?.toLowerCase();
	if (projectConfigFlag !== "true" && projectConfigFlag !== "1") {
		for (const directory of ancestors) {
			files.push(path.join(directory, "tui.json"), path.join(directory, "tui.jsonc"));
		}
		for (const directory of [...ancestors].reverse()) {
			files.push(path.join(directory, ".opencode", "tui.json"), path.join(directory, ".opencode", "tui.jsonc"));
		}
	}
	if (env.OPENCODE_CONFIG_DIR) {
		files.push(path.join(env.OPENCODE_CONFIG_DIR, "tui.json"), path.join(env.OPENCODE_CONFIG_DIR, "tui.jsonc"));
	}
	return files;
}

export function loadOpenCodeHotkeys(cwd: string, env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
	const overrides: Record<string, BindingValue> = {};
	for (const file of configFiles(cwd, env)) Object.assign(overrides, readOverrides(file, env));
	return resolveOpenCodeHotkeys(overrides);
}
