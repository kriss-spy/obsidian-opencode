import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import OpencodePlugin from "../main";
import { spawn, ChildProcess } from "child_process";

export const OPENCODE_TERMINAL_VIEW_TYPE = "opencode-terminal";

const UNIX_PSEUDOTERMINAL_PY = `
import sys
from os import execvp, read, write, waitpid, waitstatus_to_exitcode
from fcntl import ioctl
from pty import fork
from termios import TIOCSWINSZ
from struct import pack
from selectors import DefaultSelector, EVENT_READ

_CHUNK_SIZE = 1024
_CMDIO = 3

def write_all(fd, data):
    while data:
        data = data[write(fd, data):]

def main():
    pid, pty_fd = fork()
    if pid == 0:
        execvp(sys.argv[1], sys.argv[1:])
    
    with DefaultSelector() as selector:
        selector.register(pty_fd, EVENT_READ, lambda: forward_pty(pty_fd))
        selector.register(0, EVENT_READ, lambda: forward_stdin(pty_fd))
        selector.register(_CMDIO, EVENT_READ, lambda: handle_resize(pty_fd))
        
        while True:
            events = selector.select()
            for key, _ in events:
                key.data()
            if not any(key.data for key in selector.get_map().values() if key.data):
                break
    
    waitstatus_to_exitcode(waitpid(pid, 0)[1])

def forward_pty(pty_fd):
    try:
        data = read(pty_fd, _CHUNK_SIZE)
    except OSError:
        data = b""
    if not data:
        sys.exit(0)
    write_all(1, data)

def forward_stdin(pty_fd):
    try:
        data = read(0, _CHUNK_SIZE)
    except OSError:
        data = b""
    if not data:
        sys.exit(0)
    write_all(pty_fd, data)

def handle_resize(pty_fd):
    try:
        data = read(_CMDIO, _CHUNK_SIZE)
    except OSError:
        data = b""
    if not data:
        return
    for line in data.decode("UTF-8", "strict").splitlines():
        rows, columns = (int(s.strip()) for s in line.split("x", 2))
        ioctl(pty_fd, TIOCSWINSZ, pack("HHHH", rows, columns, 0, 0))

if __name__ == "__main__":
    main()
`;

export class OpencodeTerminalView extends ItemView {
	terminal: Terminal | null = null;
	fitAddon: FitAddon | null = null;
	ptyProcess: ChildProcess | null = null;
	cmdioFd: number | null = null;
	container: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: OpencodePlugin) {
		super(leaf);
	}

	getViewType() {
		return OPENCODE_TERMINAL_VIEW_TYPE;
	}

	getDisplayText() {
		return "OpenCode";
	}

	getIcon(): string {
		return "terminal";
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("opencode-terminal-container");
		this.container = container;

		// Hide the view header for a cleaner terminal experience
		const viewHeader = this.containerEl.children[0] as HTMLElement;
		if (viewHeader) {
			viewHeader.style.display = "none";
		}

		const termContainer = container.createEl("div", {
			cls: "opencode-terminal",
		});

		// Get computed styles from Obsidian for theme integration
		const computedStyle = getComputedStyle(document.body);
		const isDark = document.body.classList.contains("theme-dark");

		const terminal = new Terminal({
			fontSize: this.plugin.settings.terminalFontSize,
			fontFamily: this.plugin.settings.terminalFontFamily,
			lineHeight: 1.2,
			theme: {
				background: computedStyle.getPropertyValue("--background-primary").trim() || (isDark ? "#1e1e1e" : "#ffffff"),
				foreground: computedStyle.getPropertyValue("--text-normal").trim() || (isDark ? "#d4d4d4" : "#333333"),
				cursor: computedStyle.getPropertyValue("--text-normal").trim() || (isDark ? "#d4d4d4" : "#333333"),
				cursorAccent: computedStyle.getPropertyValue("--background-primary").trim() || (isDark ? "#1e1e1e" : "#ffffff"),
				selectionBackground: computedStyle.getPropertyValue("--text-selection").trim() || (isDark ? "#264f78" : "#add6ff"),
				black: computedStyle.getPropertyValue("--text-faint").trim() || (isDark ? "#666666" : "#666666"),
				red: computedStyle.getPropertyValue("--text-error").trim() || (isDark ? "#f44747" : "#cd3131"),
				green: computedStyle.getPropertyValue("--text-success").trim() || (isDark ? "#6a9955" : "#0bc765"),
				yellow: computedStyle.getPropertyValue("--text-warning").trim() || (isDark ? "#dcdcaa" : "#e5e510"),
				blue: computedStyle.getPropertyValue("--text-accent").trim() || (isDark ? "#569cd6" : "#2470fe"),
				magenta: computedStyle.getPropertyValue("--text-accent-hover").trim() || (isDark ? "#c586c0" : "#bc3fbc"),
				cyan: "#4ec9b0",
				white: computedStyle.getPropertyValue("--text-normal").trim() || (isDark ? "#d4d4d4" : "#333333"),
			},
			cursorBlink: true,
			scrollback: 10000,
			convertEol: true,
			allowProposedApi: true,
		});

		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new WebLinksAddon());

		terminal.open(termContainer);
		try {
			terminal.loadAddon(new WebglAddon());
		} catch (e) {
			console.warn("WebGL addon failed to load, falling back to canvas", e);
		}
		this.terminal = terminal;
		this.fitAddon = fitAddon;

		// Debounced fit function to avoid excessive calls
		let fitTimeout: NodeJS.Timeout | null = null;
		const doFit = () => {
			if (fitTimeout) clearTimeout(fitTimeout);
			fitTimeout = setTimeout(() => {
				if (termContainer.clientWidth > 0 && termContainer.clientHeight > 0) {
					try {
						fitAddon.fit();
						// Send resize after fit completes
						setTimeout(() => this.sendResize(), 50);
					} catch (e) {
						console.warn("Fit failed:", e);
					}
				}
			}, 50);
		};

		// Initial fit with multiple attempts to ensure proper sizing
		setTimeout(doFit, 0);
		setTimeout(doFit, 100);
		setTimeout(doFit, 300);
		setTimeout(doFit, 500);

		// Observe container resize
		const resizeObserver = new ResizeObserver(() => {
			doFit();
		});
		resizeObserver.observe(termContainer);
		resizeObserver.observe(container);
		this.register(() => resizeObserver.disconnect());

		// Listen to workspace events
		this.registerEvent(
			this.app.workspace.on("resize", () => {
				doFit();
			})
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				doFit();
			})
		);

		// Handle window resize
		window.addEventListener("resize", doFit);
		this.register(() => window.removeEventListener("resize", doFit));

		terminal.onData((data: string) => {
			if (this.ptyProcess?.stdin) {
				this.ptyProcess.stdin.write(data);
			}
		});

		this.registerKeyInterception();

		this.spawnPty(terminal);

		setTimeout(() => {
			if (this.terminal) {
				this.terminal.focus();
			}
		}, 600);
	}

	restartPty() {
		if (this.ptyProcess) {
			this.ptyProcess.kill();
			this.ptyProcess = null;
		}
		if (this.terminal) {
			this.terminal.clear();
			this.spawnPty(this.terminal);
		}
	}

	private spawnPty(terminal: Terminal) {
		const defaultCwd = this.plugin.settings.defaultWorkingDirectory || this.plugin.vaultRoot;
		const cwd = this.plugin.sessionCwd || defaultCwd;
		const opencodePath = this.plugin.settings.opencodePath || "opencode";
		
		let args: string[] = [];
		if (this.plugin.sessionArgs) {
			args = [...this.plugin.sessionArgs];
		} else {
			args = this.plugin.settings.newSessionArgs
				? this.plugin.settings.newSessionArgs.split(/\s+/).filter(Boolean)
				: [];
		}

		// Clear one-time session args after reading them
		this.plugin.sessionArgs = null;
		this.plugin.sessionCwd = null;

		const pythonPath = process.platform === "win32" ? "python" : "python3";

		if (process.platform === "win32") {
			terminal.writeln("\r\nWindows PTY support not yet implemented.\r\n");
			new Notice("OpenCode terminal not supported on Windows yet.");
			return;
		}

		this.ptyProcess = spawn(pythonPath, ["-c", UNIX_PSEUDOTERMINAL_PY, opencodePath, ...args], {
			cwd,
			env: process.env as NodeJS.ProcessEnv,
			stdio: ["pipe", "pipe", "pipe", "pipe"],
		});

		this.ptyProcess.stdout?.on("data", (chunk: Buffer) => {
			terminal.write(chunk);
		});

		this.ptyProcess.stderr?.on("data", (chunk: Buffer) => {
			console.error("PTY stderr:", chunk.toString());
		});

		this.ptyProcess.on("exit", (code, signal) => {
			terminal.writeln(`\r\n[Process exited with code ${code ?? signal}]\r\n`);
			this.ptyProcess = null;
		});

		this.ptyProcess.on("error", (err) => {
			terminal.writeln(`\r\nError: ${err.message}\r\n`);
			new Notice(`Failed to start OpenCode: ${err.message}`);
		});

		setTimeout(() => {
			this.sendResize();
		}, 300);
	}

	private sendResize() {
		if (!this.ptyProcess || !this.terminal) return;
		const { rows, cols } = this.terminal;
		const pty = this.ptyProcess as any;
		const cmdio = pty.stdio?.[3];
		if (cmdio && typeof cmdio.write === "function") {
			cmdio.write(`${rows}x${cols}\n`);
		}
	}

	private registerKeyInterception() {
		const container = this.container;
		if (!container) return;

		const app = this.app as any;

		const hotkeyToCommand = new Map<string, string>();

		const addHotkeys = (cmdId: string, hotkeys: Array<{ modifiers: string[]; key: string }>) => {
			for (const hk of hotkeys) {
				const mods = hk.modifiers.map((m: string) => m === 'Mod' ? 'Ctrl' : m).sort().join('+');
				const str = `${mods}${mods ? '+' : ''}${hk.key}`;
				hotkeyToCommand.set(str, cmdId);
			}
		};

		for (const [cmdId, hotkeys] of Object.entries(app.hotkeyManager.defaultKeys || {})) {
			addHotkeys(cmdId, hotkeys as Array<{ modifiers: string[]; key: string }>);
		}

		try {
			const adapter = app.vault.adapter;
			const hotkeysPath = (adapter as any).getBasePath() + '/.obsidian/hotkeys.json';
			const fs = require('fs');
			if (fs.existsSync(hotkeysPath)) {
				const custom = JSON.parse(fs.readFileSync(hotkeysPath, 'utf8'));
				for (const [cmdId, hotkeys] of Object.entries(custom)) {
					if (Array.isArray(hotkeys) && hotkeys.length > 0) {
						addHotkeys(cmdId, hotkeys as Array<{ modifiers: string[]; key: string }>);
					}
				}
			}
		} catch (e) {
			// ignore
		}

		const allowedIds = new Set([
			'opencode:open-opencode-terminal',
			'opencode:toggle-opencode-terminal-sidebar',
			'opencode:open-opencode-conversations',
			'opencode:new-opencode-session',
			'opencode:continue-last-opencode-session',
			'app:toggle-right-sidebar',
		]);

		// Listen on document in capture phase to beat Obsidian's handler.
		const handler = (e: KeyboardEvent) => {
			if (!this.terminal) return;

			const target = e.target as Node;
			const inContainer = container.contains(target);

			if (!inContainer) return;

			// Skip modifier-only keys (Ctrl, Alt, Shift, Meta)
			if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') return;

			const mods: string[] = [];
			if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
			if (e.altKey) mods.push('Alt');
			if (e.shiftKey) mods.push('Shift');
			mods.sort();
			const hotkeyStr = `${mods.join('+')}${mods.length ? '+' : ''}${e.key}`;

			const cmdId = hotkeyToCommand.get(hotkeyStr);
			if (cmdId && allowedIds.has(cmdId)) {
				app.commands.executeCommandById(cmdId);
				e.stopImmediatePropagation();
				return;
			}

			// Prevent browser default (textarea input) to avoid double-send to PTY
			e.preventDefault();

			// Send key to PTY manually so opencode receives it
			this.sendKeyToPty(e);

			// Re-focus textarea after Esc (opencode blurs on interrupt)
			if (e.key === 'Escape') {
				setTimeout(() => {
					const textarea = this.terminal?.textarea;
					if (textarea) textarea.focus();
				}, 50);
			}

			e.stopImmediatePropagation();
		};

		document.addEventListener('keydown', handler, true);
		this.register(() => document.removeEventListener('keydown', handler, true));
	}

	private sendKeyToPty(e: KeyboardEvent) {
		if (!this.ptyProcess?.stdin) return;

		const key = e.key;
		const ctrl = e.ctrlKey || e.metaKey;
		const alt = e.altKey;
		const shift = e.shiftKey;

		// Build the escape sequence for the key
		let seq: string;

		if (ctrl && !alt) {
			// Ctrl+letter: ASCII control code
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
			// Alt+key: ESC prefix
			seq = '\x1b' + key;
		} else {
			// Regular key or special keys
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

		this.ptyProcess.stdin.write(seq);
	}

	async onClose() {
		if (this.ptyProcess) {
			this.ptyProcess.kill();
			this.ptyProcess = null;
		}
		if (this.terminal) {
			try {
				this.terminal.dispose();
			} catch (e) {
				// xterm WebGL addon has a known dispose bug
			}
			this.terminal = null;
		}
	}

	focusTerminal() {
		if (this.terminal) {
			this.terminal.focus();
		}
	}
}
