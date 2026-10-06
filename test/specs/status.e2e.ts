import * as path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { browser, expect } from "@wdio/globals";

describe("OpenCode touched-note status in a fresh vault", function () {
	it("[smoke] [issue #21] retains a successful edit warning with an empty API diff and resets on a new turn", async function () {
		const directory = mkdtempSync(path.join(tmpdir(), "opencode-status-e2e-"));
		const stateFile = path.join(directory, "state.json");
		const stub = path.resolve(`test/fixtures/opencode-status-stub${process.platform === "win32" ? ".cmd" : ""}`);
		const setPhase = (phase: string) => writeFileSync(stateFile, JSON.stringify({ phase }));
		const refresh = () => browser.execute(async () => {
			const plugin = (window as any).app.plugins.plugins.opencode;
			while (plugin.statusRefreshPending) await new Promise((resolve) => setTimeout(resolve, 25));
			await plugin.refreshStatus();
		});
		try {
			setPhase("running");
			await browser.execute(async (stubPath: string, fixtureState: string) => {
				const app = (window as any).app;
				const plugin = app.plugins.plugins.opencode;
				(window as any).__statusFixturePrevious = {
					settings: { ...plugin.settings }, source: plugin.statusSource,
				};
				plugin.settings = { ...plugin.settings, opencodePath: stubPath, environmentVariables: {
					OBSIDIAN_OPENCODE_STATUS_STATE: fixtureState,
				} };
				await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath("Smoke.md"));
				await plugin.startStatusTracking();
			}, stub, stateFile);
			const status = browser.$(".opencode-status");
			await expect(status).toHaveElementClass("is-running");
			setPhase("completed");
			await refresh();
			await expect(status).toHaveElementClass("is-touched");
			await expect(status).toHaveAttribute("title", "OpenCode changed this note");
			await expect(status.$(".opencode-status-badge")).toHaveText("!");
			await refresh();
			await expect(status).toHaveElementClass("is-touched");
			setPhase("new-turn");
			await refresh();
			await expect(status).toHaveElementClass("is-running");
			await expect(status.$(".opencode-status-badge")).toHaveText("");
			setPhase("new-turn-idle");
			await refresh();
			await expect(status).toHaveElementClass("is-idle");
		} finally {
			await browser.execute(async () => {
				const plugin = (window as any).app.plugins.plugins.opencode;
				const previous = (window as any).__statusFixturePrevious;
				if (!previous) return;
				while (plugin.statusRefreshPending) await new Promise((resolve) => setTimeout(resolve, 25));
				plugin.settings = previous.settings;
				plugin.statusSource = previous.source;
				plugin.statusTracker.updateSessions([]);
				plugin.renderStatus(plugin.statusTracker.status);
				delete (window as any).__statusFixturePrevious;
			});
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
