import * as path from "node:path";

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	specs: ["./test/specs/**/*.e2e.ts"],
	maxInstances: 1,
	capabilities: [{
		browserName: "obsidian",
		browserVersion: process.env.OBSIDIAN_VERSION ?? "latest",
		"wdio:obsidianOptions": {
			installerVersion: process.env.OBSIDIAN_INSTALLER_VERSION ?? "latest",
			plugins: ["."],
			vault: "test/vault",
		},
	}],
	services: ["obsidian"],
	reporters: ["obsidian"],
	cacheDir: path.resolve(".obsidian-cache"),
	mochaOpts: {
		ui: "bdd",
		timeout: 60_000,
		grep: process.env.OBSIDIAN_TEST_GREP,
	},
	waitforInterval: 250,
	waitforTimeout: 10_000,
	logLevel: "warn",
	injectGlobals: false,
};
