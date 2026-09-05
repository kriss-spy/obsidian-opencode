import { ItemView, WorkspaceLeaf } from "obsidian";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { CanvasAddon } from "@xterm/addon-canvas";
import { WebglAddon } from "@xterm/addon-webgl";
import { release } from "node:os";
import OpencodePlugin from "../main";
import { handleTerminalDrop } from "../terminalDrop";
import { EditorServer } from "../editorServer";
import { normalizeVaultPath } from "../utils/path";
import { PtySession } from "../modules/ptySession";
import { TerminalKeyRouter } from "../modules/terminalKeyRouter";
import {
	CLEAR_PICKER_QUERY,
	findOpenCodeScrollRegionRows,
	findOpenCodeScrollbarThumb,
	isOpenCodePicker,
	pickerTargetAtRow,
	SCROLL_PAGE_DOWN,
	SCROLL_PAGE_UP,
	scrollbarDragInput,
	scrollbarPageInput,
} from "../modules/windowsTerminalMouse";
import { LifecycleQueue } from "../modules/lifecycleQueue";
import { loadOpenCodeHotkeys } from "../modules/openCodeKeymap";
import { mergeEnvironmentVariables } from "../utils/environment";

interface VaultWithConfig {
	getConfig?(key: string): string;
}

export const OPENCODE_TERMINAL_VIEW_TYPE = "opencode-terminal";

export class OpencodeTerminalView extends ItemView {
	terminal: Terminal | null = null;
	fitAddon: FitAddon | null = null;
	container: HTMLElement | null = null;
	editorServer: EditorServer | null = null;
	private editorPort: number | undefined;
	private ptySession: PtySession;
	private keyRouter: TerminalKeyRouter;
	private readonly lifecycle = new LifecycleQueue();
	private closing = false;

	constructor(leaf: WorkspaceLeaf, private plugin: OpencodePlugin) {
		super(leaf);
		this.ptySession = this.plugin.createPtySession();
		this.keyRouter = new TerminalKeyRouter();
	}

	getViewType() {
		return OPENCODE_TERMINAL_VIEW_TYPE;
	}

	getDisplayText() {
		return "Opencode";
	}

	getIcon(): string {
		return "terminal";
	}

	async onOpen() {
		const terminalCwd = this.plugin.sessionCwd
			|| this.plugin.settings.defaultWorkingDirectory
			|| this.plugin.vaultRoot;
		const terminalEnvironment = mergeEnvironmentVariables(
			process.env,
			this.plugin.settings.environmentVariables,
		);
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("opencode-terminal-container");
		this.container = container;

		const termContainer = container.createEl("div", {
			cls: "opencode-terminal",
		});

		// Get computed styles from Obsidian for theme integration
		const isDark = activeDocument.body.classList.contains("theme-dark") ||
		               ((this.app.vault as unknown as VaultWithConfig).getConfig?.("theme") === "obsidian");
		const fallbackBg = isDark ? "#1e1e1e" : "#ffffff";
		const fallbackFg = isDark ? "#d4d4d4" : "#333333";

		const computedStyle = getComputedStyle(activeDocument.body);
		const initialBg = computedStyle.getPropertyValue("--background-primary").trim();
		const initialFg = computedStyle.getPropertyValue("--text-normal").trim();
		const terminalBg = initialBg && initialBg !== "transparent" && initialBg !== "rgba(0, 0, 0, 0)"
			? initialBg
			: fallbackBg;
		const terminalFg = initialFg || fallbackFg;

		termContainer.style.backgroundColor = terminalBg;

		const terminal = new Terminal({
			fontSize: this.plugin.settings.terminalFontSize,
			fontFamily: this.plugin.settings.terminalFontFamily,
			lineHeight: 1.0,
			theme: {
				background: terminalBg,
				foreground: terminalFg,
				cursor: terminalFg,
				cursorAccent: terminalBg,
				selectionBackground: isDark ? "#264f78" : "#add6ff",
				black: "#666666",
				red: isDark ? "#f44747" : "#cd3131",
				green: isDark ? "#6a9955" : "#0bc765",
				yellow: isDark ? "#dcdcaa" : "#e5e510",
				blue: isDark ? "#569cd6" : "#2470fe",
				magenta: isDark ? "#c586c0" : "#bc3fbc",
				cyan: "#4ec9b0",
				white: terminalFg,
			},
			cursorBlink: true,
			scrollback: 10000,
			convertEol: false,
			windowsPty: process.platform === "win32"
				? { backend: "conpty", buildNumber: Number.parseInt(release().split(".")[2], 10) }
				: undefined,
			allowProposedApi: true,
		});

		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new WebLinksAddon());

		terminal.open(termContainer);
		let scrollbarRail: HTMLElement | null = null;
		let scrollbarThumb: HTMLElement | null = null;
		if (process.platform === "win32") {
			termContainer.addClass("is-windows");
			scrollbarRail = termContainer.createDiv({ cls: "opencode-terminal-scrollbar" });
			scrollbarThumb = scrollbarRail.createDiv({ cls: "opencode-terminal-scrollbar-thumb" });
		}
		if (process.platform === "win32") {
			try {
				const webglAddon = new WebglAddon();
				webglAddon.onContextLoss(() => {
					webglAddon.dispose();
					terminal.refresh(0, terminal.rows - 1);
				});
				terminal.loadAddon(webglAddon);
			} catch (e) {
				console.warn("WebGL renderer failed to load, falling back to DOM renderer", e);
			}
		} else {
			try {
				terminal.loadAddon(new CanvasAddon());
			} catch (e) {
				console.warn("Canvas renderer failed to load, falling back to DOM renderer", e);
			}
		}
		this.terminal = terminal;
		this.fitAddon = fitAddon;

		let themeInitialized = false;
		// Dynamic theme update to match Obsidian colors precisely once DOM is mounted
		const updateTheme = () => {
			if (!terminal || themeInitialized) return;
			const docBody = this.containerEl.ownerDocument.body;
			const computedStyle = getComputedStyle(docBody);
			const currentIsDark = docBody.classList.contains("theme-dark") ||
			                     ((this.app.vault as unknown as VaultWithConfig).getConfig?.("theme") === "obsidian");

			const bg = computedStyle.getPropertyValue("--background-primary").trim();
			const fg = computedStyle.getPropertyValue("--text-normal").trim();

			// Only update if we get valid computed values
			if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
				termContainer.style.backgroundColor = bg;

				terminal.options.theme = {
					background: bg,
					foreground: fg || (currentIsDark ? "#d4d4d4" : "#333333"),
					cursor: fg || (currentIsDark ? "#d4d4d4" : "#333333"),
					cursorAccent: bg,
					selectionBackground: computedStyle.getPropertyValue("--text-selection").trim() || (currentIsDark ? "#264f78" : "#add6ff"),
					black: computedStyle.getPropertyValue("--text-faint").trim() || "#666666",
					red: computedStyle.getPropertyValue("--text-error").trim() || (currentIsDark ? "#f44747" : "#cd3131"),
					green: computedStyle.getPropertyValue("--text-success").trim() || (currentIsDark ? "#6a9955" : "#0bc765"),
					yellow: computedStyle.getPropertyValue("--text-warning").trim() || (currentIsDark ? "#dcdcaa" : "#e5e510"),
					blue: computedStyle.getPropertyValue("--text-accent").trim() || (currentIsDark ? "#569cd6" : "#2470fe"),
					magenta: computedStyle.getPropertyValue("--text-accent-hover").trim() || (currentIsDark ? "#c586c0" : "#bc3fbc"),
					cyan: "#4ec9b0",
					white: fg || (currentIsDark ? "#d4d4d4" : "#333333"),
				};
				themeInitialized = true;
			}
		};

		// Debounced fit function to avoid excessive calls
		let fitTimeout: number | null = null;
		const fitDelay = process.platform === "win32" ? 150 : 50;
		const doFit = () => {
			if (fitTimeout) window.clearTimeout(fitTimeout);
			fitTimeout = window.setTimeout(() => {
				if (termContainer.clientWidth > 0 && termContainer.clientHeight > 0) {
					try {
						updateTheme();
						fitAddon.fit();
						this.ptySession.sendResize(terminal);
					} catch (err) {
						console.warn("Fit failed:", err);
					}
				}
			}, fitDelay);
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

		const terminalCellAt = (event: MouseEvent | WheelEvent) => {
			const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
			if (!screen) return null;
			const rect = screen.getBoundingClientRect();
			return {
				column: Math.floor((event.clientX - rect.left) / (rect.width / terminal.cols)),
				row: Math.max(0, Math.min(terminal.rows - 1,
					Math.floor((event.clientY - rect.top) / (rect.height / terminal.rows)))),
			};
		};

		let scrollbarDragRow: number | null = null;
		let scrollbarDragOffset = 0;
		let scrollbarDragTrackRows = terminal.rows;
		let scrollbarDragThumbRows = terminal.rows;
		const updateScrollbar = () => {
			if (!scrollbarRail || !scrollbarThumb) return;
			const thumb = findOpenCodeScrollbarThumb(terminal.buffer.active, terminal.rows);
			scrollbarRail.toggleClass("is-active", Boolean(thumb));
			if (!thumb || scrollbarRail.hasClass("is-dragging")) return;
			const trackRows = findOpenCodeScrollRegionRows(terminal.buffer.active, terminal.rows);
			scrollbarRail.style.height = `${trackRows / terminal.rows * 100}%`;
			scrollbarThumb.style.top = `${thumb.startRow / trackRows * 100}%`;
			scrollbarThumb.style.height = `${(thumb.endRow - thumb.startRow + 1) / trackRows * 100}%`;
		};
		const renderDisposable = terminal.onRender(updateScrollbar);
		this.register(() => renderDisposable.dispose());

		const handleMessageWheel = (event: WheelEvent) => {
			if (process.platform !== "win32" || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			terminal.input(event.deltaY < 0 ? SCROLL_PAGE_UP : SCROLL_PAGE_DOWN, true);
		};
		termContainer.addEventListener("wheel", handleMessageWheel, { capture: true, passive: false });
		this.register(() => termContainer.removeEventListener("wheel", handleMessageWheel, true));

		const handleScrollbarMouse = (event: MouseEvent) => {
			if (process.platform !== "win32" || event.button !== 0) return;
			if ((event.target as Element).closest(".opencode-terminal-scrollbar")) return;
			const cell = terminalCellAt(event);
			const thumb = findOpenCodeScrollbarThumb(terminal.buffer.active, terminal.rows);
			if (!cell || !thumb) return;
			if (Math.abs(cell.column - thumb.column) <= 3 && cell.row >= thumb.startRow && cell.row <= thumb.endRow) {
				scrollbarDragRow = cell.row;
				scrollbarDragTrackRows = findOpenCodeScrollRegionRows(terminal.buffer.active, terminal.rows);
				scrollbarDragThumbRows = thumb.endRow - thumb.startRow + 1;
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}
			const input = scrollbarPageInput(thumb, cell.column, cell.row);
			if (!input) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			terminal.input(input, true);
		};
		termContainer.addEventListener("mousedown", handleScrollbarMouse, true);
		const handleScrollbarRailMouse = (event: MouseEvent) => {
			if (event.button !== 0) return;
			const cell = terminalCellAt(event);
			const thumb = findOpenCodeScrollbarThumb(terminal.buffer.active, terminal.rows);
			if (!cell || !thumb) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if ((event.target as Element).closest(".opencode-terminal-scrollbar-thumb")) {
				scrollbarDragRow = cell.row;
				scrollbarDragTrackRows = findOpenCodeScrollRegionRows(terminal.buffer.active, terminal.rows);
				scrollbarDragThumbRows = thumb.endRow - thumb.startRow + 1;
				const thumbRect = scrollbarThumb?.getBoundingClientRect();
				scrollbarDragOffset = thumbRect ? event.clientY - thumbRect.top : 0;
				scrollbarRail?.addClass("is-dragging");
				return;
			}
			terminal.input(cell.row < thumb.startRow ? SCROLL_PAGE_UP : SCROLL_PAGE_DOWN, true);
		};
		scrollbarRail?.addEventListener("mousedown", handleScrollbarRailMouse);
		const handleScrollbarDrag = (event: MouseEvent) => {
			if (scrollbarDragRow === null) return;
			const cell = terminalCellAt(event);
			if (!cell) return;
			if (scrollbarRail?.hasClass("is-dragging") && scrollbarThumb) {
				const railRect = scrollbarRail.getBoundingClientRect();
				const maximumTop = Math.max(0, railRect.height - scrollbarThumb.offsetHeight);
				const top = Math.max(0, Math.min(maximumTop,
					event.clientY - railRect.top - scrollbarDragOffset));
				scrollbarThumb.style.top = `${top}px`;
			}
			const input = scrollbarDragInput(
				scrollbarDragRow,
				cell.row,
				scrollbarDragTrackRows,
				scrollbarDragThumbRows,
			);
			event.preventDefault();
			event.stopImmediatePropagation();
			if (!input) return;
			scrollbarDragRow = cell.row;
			terminal.input(input, true);
		};
		const stopScrollbarDrag = (event: MouseEvent) => {
			if (scrollbarDragRow === null) return;
			scrollbarDragRow = null;
			scrollbarRail?.removeClass("is-dragging");
			window.setTimeout(updateScrollbar, 50);
			event.preventDefault();
			event.stopImmediatePropagation();
		};
		const ownerDocument = termContainer.ownerDocument;
		ownerDocument.addEventListener("mousemove", handleScrollbarDrag, true);
		ownerDocument.addEventListener("mouseup", stopScrollbarDrag, true);
		this.register(() => {
			termContainer.removeEventListener("mousedown", handleScrollbarMouse, true);
			scrollbarRail?.removeEventListener("mousedown", handleScrollbarRailMouse);
			ownerDocument.removeEventListener("mousemove", handleScrollbarDrag, true);
			ownerDocument.removeEventListener("mouseup", stopScrollbarDrag, true);
		});

		const isMouseClickableTui = (): boolean => {
			return process.platform === "win32" && isOpenCodePicker(terminal.buffer.active);
		};
		const moveCursorOnMouseDown = (event: MouseEvent) => {
			if (process.platform !== "win32" || event.button !== 0 || isMouseClickableTui()) return;
			const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
			if (!screen) return;
			const rect = screen.getBoundingClientRect();
			const row = Math.floor((event.clientY - rect.top) / (rect.height / terminal.rows));
			const buffer = terminal.buffer.active;
			if (row !== buffer.cursorY) return;
			const column = Math.max(0, Math.min(terminal.cols - 1,
				Math.floor((event.clientX - rect.left) / (rect.width / terminal.cols))));
			const delta = column - buffer.cursorX;
			if (delta === 0) return;
			window.setTimeout(() => {
				terminal.input((delta < 0 ? "\x1b[D" : "\x1b[C").repeat(Math.abs(delta)), true);
			}, 0);
		};
		termContainer.addEventListener("mousedown", moveCursorOnMouseDown);
		this.register(() => termContainer.removeEventListener("mousedown", moveCursorOnMouseDown));

		const handlePickerMouse = (event: MouseEvent) => {
			if (process.platform !== "win32" || event.button !== 0 || !isMouseClickableTui()) return;
			const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
			if (!screen) return;
			const rect = screen.getBoundingClientRect();
			const clickedRow = Math.floor((event.clientY - rect.top) / (rect.height / terminal.rows));
			event.preventDefault();
			event.stopImmediatePropagation();
			if (event.type === "mouseup") {
				const targetText = pickerTargetAtRow(terminal.buffer.active, clickedRow);
				if (!targetText) return;
				terminal.input(CLEAR_PICKER_QUERY + targetText, true);
				window.setTimeout(() => terminal.input("\r", true), 300);
			}
		};
		termContainer.addEventListener("mousedown", handlePickerMouse, true);
		termContainer.addEventListener("mouseup", handlePickerMouse, true);
		this.register(() => {
			termContainer.removeEventListener("mousedown", handlePickerMouse, true);
			termContainer.removeEventListener("mouseup", handlePickerMouse, true);
		});

		// Keep this server private to the embedded OpenCode process. Publishing a
		// lock file would also connect unrelated OpenCode processes in this vault.
		this.editorServer = new EditorServer({ publishLock: false });
		try {
			this.editorPort = await this.editorServer.start(this.plugin.vaultRoot);
		} catch (err) {
			console.warn("OpenCode editor server failed to start:", err);
			this.editorServer = null;
			this.editorPort = undefined;
		}

		// Wait until the container has been fully mounted and has a non-zero size,
		// then fit the terminal and spawn the PTY with the exact correct initial size.
		// This is extremely important for Flatpak/sandboxed PTY compatibility!
		const spawnWithCorrectSize = () => {
			if (termContainer.clientWidth > 0 && termContainer.clientHeight > 0) {
				try {
					fitAddon.fit();
				} catch (e) {
					console.warn("Initial fit failed:", e);
				}
				this.spawnPty(terminal);
			} else {
				window.setTimeout(spawnWithCorrectSize, 50);
			}
		};
		spawnWithCorrectSize();

		// Register key interception and drag/drop
		this.keyRouter.register({
			app: this.app,
			terminal,
			container,
			reservedTerminalHotkeys: loadOpenCodeHotkeys(terminalCwd, terminalEnvironment),
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
				terminalInput: this.ptySession.getStdin() ? (data: string) => terminal.input(data, true) : undefined,
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

	async restartPty(): Promise<void> {
		await this.lifecycle.enqueue(async () => {
			if (this.closing) return;
			await this.ptySession.kill();
			if (this.terminal && !this.closing) {
				this.terminal.reset();
				try {
					this.fitAddon?.fit();
				} catch (error) {
					console.warn("Restart fit failed:", error);
				}
				this.spawnPty(this.terminal);
				this.ptySession.sendResize(this.terminal);
			}
		});
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
			environmentVariables: this.plugin.settings.environmentVariables,
			editorPort: this.editorPort,
		});
	}

	async onClose() {
		this.closing = true;
		await this.lifecycle.enqueue(async () => {
			if (this.editorServer) {
				await this.editorServer.stop();
				this.editorServer = null;
				this.editorPort = undefined;
			}
			await this.plugin.closePtySession(this.ptySession);
			if (this.terminal) {
				try {
					this.terminal.dispose();
				} catch {
					// xterm canvas addon may throw on dispose
				}
				this.terminal = null;
			}
			this.keyRouter.dispose();
		});
	}

	focusTerminal() {
		if (this.terminal) {
			this.terminal.focus();
		}
	}
}
