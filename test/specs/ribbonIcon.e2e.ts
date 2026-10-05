import * as path from "node:path";
import { mkdirSync } from "node:fs";
import { browser, expect } from "@wdio/globals";

describe("OpenCode ribbon icon", function () {
	it("[smoke] [issue #63] renders the brand mark at ribbon size in both themes", async function () {
		const ribbon = browser.$('.side-dock-ribbon-action[aria-label="Opencode terminal"]');
		await expect(ribbon).toExist();
		await expect(ribbon.$("svg")).toExist();
		await expect(browser.$('.side-dock-ribbon-action[aria-label="Opencode conversations"] svg')).toExist();

		const originalTheme = await browser.execute(() => ({
			light: document.body.classList.contains("theme-light"),
			dark: document.body.classList.contains("theme-dark"),
		}));
		const artifactsDir = path.resolve("test-results/obsidian");
		mkdirSync(artifactsDir, { recursive: true });

		try {
			for (const theme of ["light", "dark"]) {
				await browser.execute((theme: string) => {
					document.body.classList.toggle("theme-light", theme === "light");
					document.body.classList.toggle("theme-dark", theme === "dark");
				}, theme);

				const icon = await browser.execute(() => {
					const ribbon = document.querySelector('.side-dock-ribbon-action[aria-label="Opencode terminal"]')!;
					const svg = ribbon.querySelector("svg")!;
					const bounds = svg.getBBox();
					const rect = svg.getBoundingClientRect();
					const paths = Array.from(svg.querySelectorAll("path"));
					const conversation = document.querySelector('.side-dock-ribbon-action[aria-label="Opencode conversations"] svg')!;
					return {
						viewBox: svg.getAttribute("viewBox"),
						width: rect.width,
						height: rect.height,
						bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
						pathCount: paths.length,
						fill: getComputedStyle(paths[1]).fill,
						color: getComputedStyle(ribbon).color,
						insetOpacity: getComputedStyle(paths[0]).opacity,
						conversationIsDistinct: conversation.innerHTML !== svg.innerHTML,
					};
				});
				expect(icon.viewBox).toBe("0 0 100 100");
				expect(icon.width).toBeGreaterThanOrEqual(14);
				expect(icon.height).toBeGreaterThanOrEqual(14);
				expect(icon.bounds.x).toBeCloseTo(16.666667, 3);
				expect(icon.bounds.y).toBeCloseTo(8.333333, 3);
				expect(icon.bounds.width).toBeCloseTo(66.666667, 3);
				expect(icon.bounds.height).toBeCloseTo(83.333333, 3);
				expect(icon.pathCount).toBe(2);
				expect(icon.fill).toBe(icon.color);
				expect(icon.insetOpacity).toBe("0.35");
				expect(icon.conversationIsDistinct).toBe(true);
				await browser.saveScreenshot(path.join(artifactsDir, `ribbon-icon-${theme}.png`));
			}
		} finally {
			await browser.execute((theme: { light: boolean; dark: boolean }) => {
				document.body.classList.toggle("theme-light", theme.light);
				document.body.classList.toggle("theme-dark", theme.dark);
			}, originalTheme);
		}
	});
});
