import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

const proof = path.resolve("test-results/obsidian/real-opencode/passed.json");
// A previous local run must never make an empty/skipped invocation pass.
rmSync(proof, { force: true });
const result = spawnSync(process.execPath, ["./node_modules/@wdio/cli/bin/wdio.js", "run", "./wdio.real.conf.mts"], {
	stdio: "inherit", env: process.env,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const evidence = JSON.parse(readFileSync(proof, "utf8"));
if (evidence.platform !== process.platform || evidence.status !== "passed" ||
	(process.env.CI_EXPECTED_SHA && evidence.commit !== process.env.CI_EXPECTED_SHA)) {
	throw new Error("Real OpenCode did not complete on the expected platform and commit");
}
for (const check of ["launch", "input", "resize", "close", "reopen", "cleanup"]) {
	if (!evidence.checks.includes(check)) throw new Error(`Missing mandatory real OpenCode check: ${check}`);
}
console.log(`Mandatory real OpenCode checks completed: ${evidence.platform}, Obsidian ${evidence.appVersion}, ${evidence.cliVersion}`);
