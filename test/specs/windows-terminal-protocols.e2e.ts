import * as path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { browser, expect } from "@wdio/globals";

describe("Windows terminal graphics and mouse", () => {
	it("[issue #83] decodes SIXEL and delivers native clicks to Skills and other pickers", async function () {
		if (process.platform !== "win32") this.skip();
		this.timeout(60_000);
		const artifacts = path.resolve("test-results/obsidian/windows-protocols");
		mkdirSync(artifacts, { recursive: true });
		await browser.execute(async (executable: string) => {
			const plugin = (window as any).app.plugins.plugins.opencode;
			await plugin.viewCoordinator.closeTerminal();
			plugin.settings.opencodePath = executable;
			plugin.settings.environmentVariables = {};
			plugin.settings.newSessionArgs = "";
			await plugin.activateTerminalView();
		}, path.resolve("test/fixtures/windows-protocol-stub.cmd"));
		try {
			await browser.waitUntil(() => browser.execute(() => {
				const buffer = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view.terminal?.buffer.active;
				return buffer && Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true)).join("\n").includes("PROTOCOL_READY");
			}), { timeout: 20_000 });
			const capture = await browser.execute(() => {
				const t = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
				const b = t.buffer.active;
				return { version: 1, cols: t.cols, rows: t.rows, buffer: b.type, baseY: b.baseY,
					viewportY: b.viewportY, cursorX: b.cursorX, cursorY: b.cursorY, mouseTrackingMode: t.modes.mouseTrackingMode,
					lines: Array.from({ length: b.length }, (_, i) => { const line = b.getLine(i); return {
						text: line.translateToString(false), isWrapped: line.isWrapped,
						cells: Array.from({ length: line.length }, (_, j) => { const c = line.getCell(j); return [c.getChars(), c.getWidth()]; }),
					}; }),
				};
			});
			writeFileSync(path.join(artifacts, "skills-buffer.json"), JSON.stringify(capture, null, 2));
			await browser.saveScreenshot(path.join(artifacts, "sixel-and-skills.png"));
			const image = await browser.execute(() => {
				const v = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				for (let y = 0; y < v.terminal.buffer.active.length; y++) for (let x = 0; x < v.terminal.cols; x++) {
					const image = v.imageAddon.getImageAtBufferCell(x, y);
					if (image) {
						const canvas = document.createElement("canvas");
						canvas.width = image.width; canvas.height = image.height;
						const context = canvas.getContext("2d")!;
						context.drawImage(image, 0, 0);
						return { width: image.width, height: image.height,
							first: Array.from(context.getImageData(0, 0, 1, 1).data),
							last: Array.from(context.getImageData(0, 15, 1, 1).data) };
					}
				}
				return null;
			});
			expect(image).toEqual({ width: 32, height: 16, first: [255, 0, 0, 255], last: [0, 0, 255, 255] });
			expect(capture.mouseTrackingMode).not.toBe("none");
			for (const title of ["Skills", "Select model", "Sessions"]) {
				const point = await browser.execute(() => {
					const t = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal;
					const rect = t.element.querySelector(".xterm-screen").getBoundingClientRect();
					return { x: Math.round(rect.left + rect.width / t.cols * 5), y: Math.round(rect.top + rect.height / t.rows * 4.5) };
				});
				await browser.action("pointer").move(point).down().up().perform();
				await browser.waitUntil(() => browser.execute((expected: string) => {
					const b = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.terminal.buffer.active;
					return Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true)).join("\n").includes(expected);
				}, `CLICKED:${title}:beta`), { timeout: 3000, timeoutMsg: `Native click did not select beta in ${title}` });
				await browser.keys("n");
			}
		} finally {
			await browser.execute(async () => { await (window as any).app.plugins.plugins.opencode.viewCoordinator.closeTerminal(); });
		}
	});
});
