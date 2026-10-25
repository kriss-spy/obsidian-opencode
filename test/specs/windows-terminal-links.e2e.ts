import * as path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { browser, expect } from "@wdio/globals";
import { resolveOpencodeExecutable } from "../../src/utils/opencodeExecutable";

// Keep this independent of the developer's real-CLI suite and configuration.
// CI explicitly enables it, so an absent executable or failed repro is a failure.
describe("Windows ConPTY terminal link responsiveness", function () {
	it("[issue #70] keeps real OpenCode responsive while hovering after reflow", async function () {
		if (process.platform !== "win32" ||
			(process.env.OPENCODE_WINDOWS_REGRESSION !== "1" && process.env.OPENCODE_REAL_E2E !== "1")) this.skip();
		this.timeout(120_000);
		const executable = resolveOpencodeExecutable(process.env.OPENCODE_WINDOWS_EXECUTABLE ?? "opencode");
		const profile = mkdtempSync(path.join(tmpdir(), "obsidian-opencode-hover-"));
		const artifacts = path.resolve("test-results/obsidian/windows-terminal-links");
		mkdirSync(artifacts, { recursive: true });
		const windowSize = await browser.execute(() => (window as any).electron.remote.getCurrentWindow().getSize() as number[]);
		const previous = await browser.execute(() => {
			const settings = (window as any).app.plugins.plugins.opencode.settings;
			return { ...settings, environmentVariables: { ...settings.environmentVariables } };
		});
		try {
			const environment = await browser.executeObsidian(({ obsidian }) => ({
				appVersion: obsidian.apiVersion, userAgent: navigator.userAgent,
			}));
			writeFileSync(path.join(artifacts, "environment.json"), JSON.stringify({
				...environment, requestedApp: process.env.OBSIDIAN_VERSION ?? "latest",
				requestedInstaller: process.env.OBSIDIAN_INSTALLER_VERSION ?? "latest", executable,
			}, null, 2));
			await browser.execute(() => (window as any).electron.remote.getCurrentWindow().setSize(1400, 1100));
			await browser.execute(async (opencodePath: string, profilePath: string) => {
				const plugin = (window as any).app.plugins.plugins.opencode;
				await plugin.viewCoordinator.closeTerminal();
				plugin.settings.opencodePath = opencodePath;
				plugin.settings.defaultWorkingDirectory = "";
				plugin.settings.newSessionArgs = "--standalone";
				plugin.settings.environmentVariables = {
					XDG_CONFIG_HOME: `${profilePath}/config`, XDG_DATA_HOME: `${profilePath}/data`,
					XDG_CACHE_HOME: `${profilePath}/cache`, XDG_STATE_HOME: `${profilePath}/state`,
					OPENCODE_CONFIG_DIR: `${profilePath}/config/opencode`,
				};
				await plugin.saveSettings();
				plugin.sessionArgs = null;
				await plugin.activateTerminalView();
			}, executable, profile);
			await browser.waitUntil(() => browser.execute(() => {
				const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view.terminal;
				const buffer = terminal?.buffer.active;
				return buffer && Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? "")
					.join("\n").includes("Ask anything");
			}), { timeout: 30_000, timeoutMsg: "Real OpenCode did not render its home prompt" });

			await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				if (view.terminal.options.windowsPty?.backend !== "conpty") throw new Error("Regression requires real ConPTY");
				// Widen the actual sidebar as well as the terminal: expanding only
				// its child leaves pointer targets clipped by the 300px sidebar.
				(window as any).app.workspace.rightSplit.containerEl.style.width = "700px";
				view.terminal.options.fontSize = 8;
				view.terminal.options.lineHeight = 1;
				const container = document.querySelector<HTMLElement>(".opencode-terminal")!;
				container.style.width = "100%";
				container.style.height = "750px";
				const provider = view.terminalLinks;
				const original = provider.provideLinks;
				const trace: any = (window as any).__hover70 = {
					calls: [] as Array<{ row: number; duration: number }>, maxWrappedSpan: 0,
					keyAt: 0, echoedAt: 0, maxTickGap: 0, lastTick: performance.now(),
					original, provider,
				};
				provider.provideLinks = function (row: number, callback: any) {
					const start = performance.now();
					try { return original.call(this, row, callback); }
					finally { trace.calls.push({ row, duration: performance.now() - start }); }
				};
				trace.keydown = (event: KeyboardEvent) => {
					if (event.isTrusted && event.key === "h" && !trace.keyAt) trace.keyAt = performance.now();
				};
				document.addEventListener("keydown", trace.keydown, true);
				trace.write = view.terminal.onWriteParsed(() => {
					if (!trace.keyAt || trace.echoedAt) return;
					const buffer = view.terminal.buffer.active;
					const text = Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? "").join("");
					if (text.includes("hover70")) trace.echoedAt = performance.now();
				});
			});

			// Exercise real ConPTY reflow; never fabricate or mutate isWrapped flags.
			for (const cols of [109, 80, 120, 109, 80, 109]) {
				await browser.execute((width: number) => {
					const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
					view.terminal.resize(width, 81);
					view.ptySession.sendResize(view.terminal);
				}, cols);
				await browser.pause(500);
				await browser.execute(() => {
					const terminal = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
					let span = 0;
					for (let row = 0; row < terminal.buffer.active.length; row++) {
						span = terminal.buffer.active.getLine(row)?.isWrapped ? span + 1 : 1;
						(window as any).__hover70.maxWrappedSpan = Math.max((window as any).__hover70.maxWrappedSpan, span);
					}
				});
			}
			const points = await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				const terminal = view.terminal, rect = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
				if (terminal.cols !== 109 || terminal.rows !== 81) throw new Error("Expected the reporter's 109 by 81 geometry");
				if (rect.bottom > innerHeight || rect.right > innerWidth) throw new Error("Terminal must be visible for trusted pointer events");
				const trace = (window as any).__hover70;
				let span = 0, wrappedSpan = 0;
				for (let row = 0; row < terminal.buffer.active.length; row++) {
					span = terminal.buffer.active.getLine(row)?.isWrapped ? span + 1 : 1;
					wrappedSpan = Math.max(wrappedSpan, span);
				}
				trace.wrappedSpanAtHover = wrappedSpan;
				// A passing test must exercise the pathological state, not just a
				// healthy home screen. Fail explicitly if upstream reflow changes.
				if (wrappedSpan < 64) throw new Error(`ConPTY repro did not produce a screen-sized wrapped block (largest span: ${wrappedSpan})`);
				trace.calls = [];
				trace.lastTick = performance.now();
				trace.timer = setInterval(() => {
					const now = performance.now();
					trace.maxTickGap = Math.max(trace.maxTickGap, now - trace.lastTick);
					trace.lastTick = now;
				}, 20);
				terminal.focus();
				return [2, 20, 36, 43, 60, 80, 43, 36].map(row => ({
					x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + (row - 0.5) * rect.height / 81),
				}));
			});
			// Queue native pointer moves and typing together, so input competes with
			// hover work on the renderer thread rather than waiting for a WDIO round trip.
			const pointer = browser.action("pointer");
			for (const point of points) pointer.move({ ...point, origin: "viewport", duration: 30 });
			const key = browser.action("key");
			for (let i = 0; i < points.length - 1; i++) key.pause(30);
			key.down("h").up("h");
			const dispatchedAt = Date.now();
			await browser.actions([pointer, key]);
			await browser.keys("over70"); // Rendered input only; never submit a model prompt.
			await browser.waitUntil(() => browser.execute(() => Boolean((window as any).__hover70.echoedAt)), {
				timeout: 3000, interval: 50, timeoutMsg: "Typing after terminal hover was not rendered within three seconds",
			});
			const wallTime = Date.now() - dispatchedAt;
			const trace = await browser.execute(() => {
				const trace = (window as any).__hover70;
				return { calls: trace.calls, maxWrappedSpan: trace.maxWrappedSpan,
					keyAt: trace.keyAt, echoedAt: trace.echoedAt, maxTickGap: trace.maxTickGap };
			});
			writeFileSync(path.join(artifacts, "timings.json"), JSON.stringify({ ...trace, wallTime }, null, 2));
			// No silent green if the driver never exercised xterm's link provider.
			expect(new Set(trace.calls.map((call: { row: number }) => call.row)).size).toBeGreaterThanOrEqual(4);
			expect(Math.max(...trace.calls.map((call: { duration: number }) => call.duration))).toBeLessThan(200);
			expect(trace.maxTickGap).toBeLessThan(500);
			expect(trace.keyAt).toBeGreaterThan(0);
			expect(trace.echoedAt - trace.keyAt).toBeLessThan(1000);
			expect(wallTime).toBeLessThan(3000);
		} finally {
			try {
				await browser.saveScreenshot(path.join(artifacts, "terminal.png"));
				const state = await browser.execute(() => {
					const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view;
					const terminal = view?.terminal, trace = (window as any).__hover70;
					if (trace) {
						clearInterval(trace.timer);
						document.removeEventListener("keydown", trace.keydown, true);
						trace.write.dispose();
						trace.provider.provideLinks = trace.original;
					}
					return { cols: terminal?.cols, rows: terminal?.rows, maxWrappedSpan: trace?.maxWrappedSpan, wrappedSpanAtHover: trace?.wrappedSpanAtHover,
						calls: trace?.calls, maxTickGap: trace?.maxTickGap, keyAt: trace?.keyAt, echoedAt: trace?.echoedAt,
						lines: terminal && Array.from({ length: terminal.buffer.active.length }, (_, row) => ({
							text: terminal.buffer.active.getLine(row)?.translateToString(true),
							wrapped: terminal.buffer.active.getLine(row)?.isWrapped,
						})) };
				});
				writeFileSync(path.join(artifacts, "buffer.json"), JSON.stringify(state, null, 2));
			} finally {
				await browser.execute(async (settings: typeof previous) => {
					const plugin = (window as any).app.plugins.plugins.opencode;
					await plugin.viewCoordinator.closeTerminal();
					Object.assign(plugin.settings, settings);
					await plugin.saveSettings();
					delete (window as any).__hover70;
				}, previous);
				await browser.execute((size: number[]) => (window as any).electron.remote.getCurrentWindow().setSize(size[0], size[1]), windowSize);
				rmSync(profile, { recursive: true, force: true });
			}
		}
	});
});
