import { config as base } from "./wdio.conf.mts";

export const config: WebdriverIO.Config = {
	...base,
	specs: ["./test/specs/real-v2-workflow.e2e.ts", "./test/specs/folder-drop.e2e.ts"],
	exclude: [],
	mochaOpts: {
		...base.mochaOpts,
		grep: "\\[real V2\\]",
		invert: false,
		forbidPending: true,
		failZero: true,
	},
};
