import { config as base } from "./wdio.conf.mts";

export const config: WebdriverIO.Config = {
	...base,
	specs: ["./test/specs/real-opencode.e2e.ts"],
	exclude: [],
	mochaOpts: {
		...base.mochaOpts,
		timeout: 120_000,
		grep: undefined,
		invert: false,
		forbidPending: true,
		failZero: true,
	},
};
