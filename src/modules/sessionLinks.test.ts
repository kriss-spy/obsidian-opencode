import { describe, expect, it, vi } from "vitest";
import { copySessionUrl, createSessionUrl, parseSessionParams } from "./sessionLinks";

describe("session links", () => {
	it("accepts parameters after Obsidian consumes the vault routing parameter", () => {
		expect(parseSessionParams({ action: "opencode", session: "ses_123", directory: "/project" }, "CloudNotes"))
			.toEqual({ id: "ses_123", directory: "/project" });
	});
	it.each(["/projects/中文 space/a+b%#&?", "C:\\Users\\用户\\My Project", "\\\\server\\share\\项目"])('round trips %s', (directory) => {
		const session = { id: "ses_123-abc", directory };
		const url = createSessionUrl("Vault 空格 & +%", session);
		expect(url).not.toMatch(/[ ()]/);
		expect(parseSessionParams(Object.fromEntries(new URL(url).searchParams), "Vault 空格 & +%")).toEqual(session);
	});
	it.each([
		{ vault: "Other", session: "ses_123", directory: "/project" },
		{ vault: "Vault", session: "", directory: "/project" },
		{ vault: "Vault", session: "--continue", directory: "/project" },
		{ vault: "Vault", session: "ses_123", directory: "relative" },
		{ vault: "Vault", session: "ses_123", directory: "/a\u0000b" },
	])("rejects malformed or foreign parameters", (params) => {
		expect(() => parseSessionParams(params, "Vault")).toThrow();
	});
	it("announces success only after writing and reports clipboard rejection", async () => {
		const notice = vi.fn();
		let complete!: () => void;
		const pending = copySessionUrl("Vault", { id: "ses_1", directory: "/project" }, () => new Promise<void>((resolve) => { complete = resolve; }), notice);
		expect(notice).not.toHaveBeenCalled();
		complete();
		await pending;
		expect(notice).toHaveBeenCalledWith("Session link copied");
		notice.mockClear();
		await copySessionUrl("Vault", { id: "ses_1", directory: "/project" }, () => Promise.reject(new Error("denied")), notice);
		expect(notice).toHaveBeenCalledOnce();
		expect(notice.mock.calls[0][0]).toContain("Unable to copy");
	});
});
