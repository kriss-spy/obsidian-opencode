import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { OpencodeClient } from "./opencode";

describe.skipIf(process.platform === "win32")("OpenCode compatibility wrappers", () => {
	let temporaryDirectory = "";

	afterEach(() => {
		if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
	});

	it("accepts a symlink to a wrapper whose help identifies OpenCode", async () => {
		temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "obsidian-opencode-compatibility-"));
		const wrapper = path.join(temporaryDirectory, "custom-agent-wrapper");
		const symlink = path.join(temporaryDirectory, "renamed-cli");
		writeFileSync(wrapper, "#!/bin/sh\nprintf 'opencode [project]  start opencode tui\\n'\n", { mode: 0o700 });
		chmodSync(wrapper, 0o700);
		symlinkSync(wrapper, symlink);

		await expect(new OpencodeClient(symlink, temporaryDirectory).checkCompatibility())
			.resolves.toEqual({ generation: "stable", executable: symlink });
	});

	it("resumes a session when the CLI resolves a working-directory symlink", async () => {
		temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "obsidian-opencode-session-alias-"));
		const alias = path.join(temporaryDirectory, "vault-alias");
		symlinkSync(temporaryDirectory, alias, "dir");
		const client = new OpencodeClient(path.resolve("test/fixtures/opencode-stub"), alias, {
			OBSIDIAN_OPENCODE_SESSION_LINKS: "1",
		});
		await expect(client.requireSession("ses_fixture", "stable")).resolves.toBeUndefined();
	});
});
