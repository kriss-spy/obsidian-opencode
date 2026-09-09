import { describe, expect, it } from "vitest";
import { CliNotFoundError, MalformedCliOutputError, UnsupportedCliError } from "../utils/opencode";
import { sessionListErrorMessage } from "./conversationErrors";

describe("sessionListErrorMessage", () => {
	it("gives actionable messages for executable, compatibility, and output failures", () => {
		expect(sessionListErrorMessage(new CliNotFoundError("opencode"))).toContain("executable path");
		expect(sessionListErrorMessage(new UnsupportedCliError())).toContain("not supported");
		expect(sessionListErrorMessage(new MalformedCliOutputError())).toContain("invalid session data");
	});
});
