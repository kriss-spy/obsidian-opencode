import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { OpencodeActivitySource, OpencodeStatusTracker } from "./opencodeStatus";

describe("OpencodeStatusTracker", () => {
	it("reports running while an OpenCode session is active", () => {
		const tracker = new OpencodeStatusTracker();

		tracker.updateSessions([
			{ id: "ses_1", directory: "/vault", files: [], running: true },
		]);

		expect(tracker.status).toEqual({ kind: "running", tooltip: "OpenCode is working" });
	});

	it("gives a touched note priority over the running state", () => {
		const tracker = new OpencodeStatusTracker();
		const vault = path.resolve("vault");
		tracker.updateActiveFile(path.join(vault, "Notes", "plan.md"));

		tracker.updateSessions([
			{ id: "ses_1", directory: vault, files: [path.join("Notes", "plan.md")], running: true },
		]);

		expect(tracker.status).toEqual({ kind: "touched", tooltip: "OpenCode changed this note" });
	});

	it("keeps the touched warning after the session becomes idle", () => {
		const tracker = new OpencodeStatusTracker();
		tracker.updateActiveFile("/vault/Notes/plan.md");

		tracker.updateSessions([
			{ id: "ses_1", directory: "/vault", files: ["/vault/Notes/plan.md"], running: false },
		]);

		expect(tracker.status).toEqual({ kind: "touched", tooltip: "OpenCode changed this note" });
	});

	it("returns to idle when only a completed session that did not touch the note remains", () => {
		const tracker = new OpencodeStatusTracker();
		tracker.updateActiveFile("/vault/Notes/other.md");

		tracker.updateSessions([
			{ id: "ses_1", directory: "/vault", files: ["Notes/plan.md"], running: false },
		]);

		expect(tracker.status).toEqual({ kind: "idle", tooltip: "OpenCode is idle" });
	});
});

describe("OpencodeActivitySource", () => {
	it("takes a final diff when a session becomes idle and retains it", async () => {
		let active = [{ id: "ses_1", directory: "/vault" }];
		const client = {
			listActiveSessions: async () => active,
			listSessionChangedFiles: async () => ["Notes/plan.md"],
		};
		const source = new OpencodeActivitySource(client);

		expect(await source.read()).toEqual([
			{ id: "ses_1", directory: "/vault", files: ["Notes/plan.md"], running: true },
		]);

		active = [];
		expect(await source.read()).toEqual([
			{ id: "ses_1", directory: "/vault", files: ["Notes/plan.md"], running: false },
		]);
		expect(await source.read()).toEqual([
			{ id: "ses_1", directory: "/vault", files: ["Notes/plan.md"], running: false },
		]);
	});

	it("drops a file that disappears from the final session diff", async () => {
		let active = [{ id: "ses_1", directory: "/vault" }];
		let files = ["Notes/Theo.md"];
		const source = new OpencodeActivitySource({
			listActiveSessions: async () => active,
			listSessionChangedFiles: async () => files,
		});

		expect(await source.read()).toEqual([
			{ id: "ses_1", directory: "/vault", files: ["Notes/Theo.md"], running: true },
		]);

		active = [];
		files = [];

		expect(await source.read()).toEqual([]);
	});

	it("still reports running when a new turn does not have a diff yet", async () => {
		const source = new OpencodeActivitySource({
			listActiveSessions: async () => [{ id: "ses_1", directory: "/vault" }],
			listSessionChangedFiles: async () => { throw new Error("no prompt to diff"); },
		});

		expect(await source.read()).toEqual([
			{ id: "ses_1", directory: "/vault", files: [], running: true },
		]);
	});

	it("starts fresh when the same session begins another turn", async () => {
		let active = [{ id: "ses_1", directory: "/vault" }];
		let files = ["Notes/plan.md"];
		const source = new OpencodeActivitySource({
			listActiveSessions: async () => active,
			listSessionChangedFiles: async () => files,
		});

		await source.read();
		active = [];
		await source.read();
		active = [{ id: "ses_1", directory: "/vault" }];
		files = [];

		expect(await source.read()).toEqual([
			{ id: "ses_1", directory: "/vault", files: [], running: true },
		]);

		active = [];
		expect(await source.read()).toEqual([]);
	});

	it("captures a recently completed session that was never observed running", async () => {
		const source = new OpencodeActivitySource({
			listActiveSessions: async () => [],
			listRecentlyUpdatedSessions: async () => [{ id: "ses_fast", directory: "/vault" }],
			listSessionChangedFiles: async () => ["Notes/quick.md"],
		});

		expect(await source.read()).toEqual([
			{ id: "ses_fast", directory: "/vault", files: ["Notes/quick.md"], running: false },
		]);
	});

	it("keeps a recent touched session visible while another session runs", async () => {
		let active = [
			{ id: "ses_touched", directory: "/vault" },
			{ id: "ses_other", directory: "/vault" },
		];
		const files = new Map([
			["ses_touched", ["Notes/plan.md"]],
			["ses_other", []],
		]);
		const source = new OpencodeActivitySource({
			listActiveSessions: async () => active,
			listSessionChangedFiles: async (sessionId) => files.get(sessionId) ?? [],
		});

		await source.read();
		active = [{ id: "ses_other", directory: "/vault" }];

		expect(await source.read()).toEqual([
			{ id: "ses_other", directory: "/vault", files: [], running: true },
			{ id: "ses_touched", directory: "/vault", files: ["Notes/plan.md"], running: false },
		]);
	});
});

// macOS launchers can hand Obsidian /var/... while child cwd resolves /private/var/....
describe("status through filesystem aliases", () => {
	it("recognizes running and touched sessions across a vault directory alias", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "opencode-status-alias-"));
		try {
			const vault = path.join(root, "vault");
			const alias = path.join(root, "alias");
			mkdirSync(vault);
			writeFileSync(path.join(vault, "Smoke.md"), "fixture");
			symlinkSync(vault, alias, process.platform === "win32" ? "junction" : "dir");
			const directory = realpathSync(vault);
			const source = new OpencodeActivitySource({
				listActiveSessions: async () => [{ id: "aliased", directory }],
				listSessionChangedFiles: async () => [],
			}, alias);
			const sessions = await source.read();
			expect(sessions).toHaveLength(1);
			const tracker = new OpencodeStatusTracker();
			tracker.updateActiveFile(path.join(alias, "Smoke.md"));
			tracker.updateSessions(sessions);
			expect(tracker.status.kind).toBe("running");
			tracker.updateSessions([{ ...sessions[0], files: ["Smoke.md"], running: false }]);
			expect(tracker.status.kind).toBe("touched");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
