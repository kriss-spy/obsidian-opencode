import { execFileSync, spawnSync } from "node:child_process";

const route = execFileSync("ip", ["route", "show", "default"], { encoding: "utf8" });
const gateway = route.match(/\bvia\s+(\S+)/)?.[1];
if (!gateway) throw new Error("Unable to determine the Windows host address from WSL's default route.");

const environment = {
	...process.env,
	DISPLAY: process.env.DISPLAY_X410 || `${gateway}:0`,
	LIBGL_ALWAYS_SOFTWARE: process.env.LIBGL_ALWAYS_SOFTWARE || "1",
	OBSIDIAN_VERSION: process.env.OBSIDIAN_VERSION || "1.12.7",
	OBSIDIAN_INSTALLER_VERSION: process.env.OBSIDIAN_INSTALLER_VERSION || "1.12.7",
	OPENCODE_REAL_E2E: "1",
};
delete environment.WAYLAND_DISPLAY;

const result = spawnSync(process.execPath, [
	"./node_modules/@wdio/cli/bin/wdio.js",
	"run",
	"./wdio.conf.mts",
], {
	cwd: process.cwd(),
	env: environment,
	stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
