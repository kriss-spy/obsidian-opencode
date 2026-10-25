import { config as base } from "./wdio.conf.mts";

export const config: WebdriverIO.Config = {
	...base,
	specs: ["./test/specs/windows-terminal-links.e2e.ts"],
	exclude: [],
	mochaOpts: {
		...base.mochaOpts,
		grep: undefined,
		invert: false,
		forbidPending: true,
		failZero: true,
	},
};
