import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
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
        ioctl(pty_fd, TIOCSWINSZ, pack("HHHH", columns, rows, 0, 0))

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

		this.spawnPty(terminal);
	}

	private spawnPty(terminal: Terminal) {
		const cwd = this.plugin.settings.defaultWorkingDirectory || this.plugin.vaultRoot;
		const opencodePath = this.plugin.settings.opencodePath || "opencode";
		const args = this.plugin.settings.newSessionArgs
			? this.plugin.settings.newSessionArgs.split(/\s+/).filter(Boolean)
			: [];

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

	async onClose() {
		if (this.ptyProcess) {
			this.ptyProcess.kill();
			this.ptyProcess = null;
		}
		if (this.terminal) {
			this.terminal.dispose();
			this.terminal = null;
		}
	}

	focusTerminal() {
		if (this.terminal) {
			this.terminal.focus();
		}
	}
}
