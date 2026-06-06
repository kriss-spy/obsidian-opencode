import { ItemView, WorkspaceLeaf } from "obsidian";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import OpencodePlugin from "../main";
import { handleTerminalDrop } from "../terminalDrop";
import { EditorServer } from "../editorServer";
import { normalizeVaultPath } from "../utils/path";
import { PtySession } from "../modules/ptySession";
import { TerminalKeyRouter } from "../modules/terminalKeyRouter";
import { OPENCODE_TERMINAL_VIEW_TYPE } from "./viewTypes";

export { OPENCODE_TERMINAL_VIEW_TYPE, OPENCODE_TERMINAL_BOTTOM_VIEW_TYPE } from "./viewTypes";

export class OpencodeTerminalView extends ItemView {
	terminal: Terminal | null = null;
	fitAddon: FitAddon | null = null;
	container: HTMLElement | null = null;
	editorServer: EditorServer | null = null;
	private ptySession: PtySession;
	private keyRouter: TerminalKeyRouter;

	constructor(leaf: WorkspaceLeaf, private plugin: OpencodePlugin) {
		super(leaf);
		this.ptySession = new PtySession();
		this.keyRouter = new TerminalKeyRouter();
	}

	getViewType() {
		return OPENCODE_TERMINAL_VIEW_TYPE;
	}

	getDisplayText() {
		// eslint-disable-next-line obsidianmd/ui/sentence-case
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

		const termContainer = container.createEl("div", {
			cls: "opencode-terminal",
		});

		// Get computed styles from Obsidian for theme integration
		const computedStyle = getComputedStyle(activeDocument.body);
		const isDark = activeDocument.body.classList.contains("theme-dark");

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
		let fitTimeout: number | null = null;
		const doFit = () => {
			if (fitTimeout) window.clearTimeout(fitTimeout);
			fitTimeout = window.setTimeout(() => {
				if (termContainer.clientWidth > 0 && termContainer.clientHeight > 0) {
					try {
						fitAddon.fit();
						// Send resize after fit completes
						window.setTimeout(() => this.ptySession.sendResize(terminal), 50);
					} catch (err) {
						console.warn("Fit failed:", err);
					}
				}
			}, 50);
		};

		// Initial fit with multiple attempts to ensure proper sizing
		window.setTimeout(doFit, 0);
		window.setTimeout(doFit, 100);
		window.setTimeout(doFit, 300);
		window.setTimeout(doFit, 500);

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
			this.ptySession.writeStdin(data);
		});

		this.spawnPty(terminal);

		// Start the WebSocket editor server so OpenCode can auto-discover this vault
		this.editorServer = new EditorServer();
		this.editorServer.start(this.plugin.vaultRoot).catch((err) => {
			console.warn("OpenCode editor server failed to start:", err);
		});

		// Register key interception and drag/drop
		this.keyRouter.register({
			app: this.app,
			terminal,
			ptySession: this.ptySession,
			container,
		});
		this.register(() => this.keyRouter.dispose());

		// Handle drag and drop for files
		const dragOverHandler = (e: DragEvent) => {
			const target = e.target as Node;
			if (!container.contains(target)) return;
			e.preventDefault();
		};

		const dropHandler = (e: DragEvent) => {
			const target = e.target as Node;
			if (!container.contains(target)) return;

			e.preventDefault();
			e.stopImmediatePropagation();

			const dragMgr = (this.app as unknown as Record<string, unknown>).dragManager as { draggable?: unknown } | undefined;
			handleTerminalDrop({
				dragManager: dragMgr,
				dataTransfer: e.dataTransfer,
				ptyWrite: this.ptySession.getStdin() ? (data: string) => this.ptySession.writeStdin(data) : undefined,
				onFileDrop: this.editorServer ? (filePath: string) => {
					const normalized = normalizeVaultPath(filePath, this.plugin.vaultRoot);
					this.editorServer!.notifyAtMentioned(normalized);
				} : undefined
			});
		};

		container.addEventListener('dragover', dragOverHandler, true);
		container.addEventListener('drop', dropHandler, true);
		this.register(() => {
			container.removeEventListener('dragover', dragOverHandler, true);
			container.removeEventListener('drop', dropHandler, true);
		});

		window.setTimeout(() => {
			if (this.terminal) {
				this.terminal.focus();
			}
		}, 600);
	}

	restartPty() {
		this.ptySession.kill();
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

		// Handle pending prompt from @opencode editor suggest
		if (this.plugin.pendingPrompt) {
			args.push("--prompt", this.plugin.pendingPrompt);
			this.plugin.pendingPrompt = null;
		}

		this.ptySession.spawn(terminal, {
			opencodePath,
			cwd,
			args,
		});
	}

	async onClose() {
		if (this.editorServer) {
			await this.editorServer.stop();
			this.editorServer = null;
		}
		this.ptySession.kill();
		if (this.terminal) {
			try {
				this.terminal.dispose();
			} catch {
				// xterm WebGL addon has a known dispose bug
			}
			this.terminal = null;
		}
		this.keyRouter.dispose();
	}

	focusTerminal() {
		if (this.terminal) {
			this.terminal.focus();
		}
	}
}
