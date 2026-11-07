import { describe, expect, it } from "vitest";
import { descendantProcesses, survivingProcesses } from "./processTree";

describe("real CLI process ownership", () => {
	it("excludes older processes whose exited parent PID was reused by a test descendant", () => {
		const rows = [
			{ pid: 9172, parent: 24560, name: "node", created: 200 },
			{ pid: 1900, parent: 9172, name: "conhost", created: 201 },
			{ pid: 4764, parent: 9172, name: "opencode", created: 202 },
			{ pid: 1928, parent: 1900, name: "csrss", created: 10 },
			{ pid: 1696, parent: 1900, name: "winlogon", created: 11 },
			{ pid: 1760, parent: 1696, name: "fontdrvhost", created: 12 },
		];
		expect(descendantProcesses(rows, [9172]).map(row => row.pid)).toEqual([9172, 1900, 4764]);
	});
	it("distinguishes a surviving child from a newly created process reusing its PID", () => {
		const child = { pid: 7, parent: 1, name: "opencode", created: 100 };
		expect(survivingProcesses([child], [child])).toEqual([child]);
		expect(survivingProcesses([child], [{ ...child, created: 200 }])).toEqual([]);
	});
});
