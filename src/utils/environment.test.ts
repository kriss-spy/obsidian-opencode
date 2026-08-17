import { describe, expect, it } from "vitest";
import { createChildEnvironment, mergeEnvironmentVariables, parseEnvironmentVariables } from "./environment";

describe("parseEnvironmentVariables", () => {
	it("parses literal values and preserves empty values", () => {
		expect(parseEnvironmentVariables("OPENCODE_CONFIG_DIR=/tmp/vault\nEMPTY=\nTOKEN=a=b", false)).toEqual({
			OPENCODE_CONFIG_DIR: "/tmp/vault",
			EMPTY: "",
			TOKEN: "a=b",
		});
	});

	it("rejects invalid names and duplicate keys", () => {
		expect(() => parseEnvironmentVariables("MISSING_VALUE", false)).toThrow("expected NAME=value");
		expect(() => parseEnvironmentVariables("BAD NAME=value", false)).toThrow("Line 1");
		expect(() => parseEnvironmentVariables("FOO=one\nFOO=two", false)).toThrow("duplicate");
	});

	it("treats key casing as duplicate on Windows", () => {
		expect(() => parseEnvironmentVariables("Path=one\nPATH=two", true)).toThrow("duplicate");
		expect(parseEnvironmentVariables("Path=one\nPATH=two", false)).toEqual({ Path: "one", PATH: "two" });
	});
});

describe("mergeEnvironmentVariables", () => {
	it("retains inherited variables and configured empty values", () => {
		expect(mergeEnvironmentVariables({ HOME: "/home/user", TOKEN: "old" }, { TOKEN: "", VAULT: "one" }, false)).toEqual({
			HOME: "/home/user",
			TOKEN: "",
			VAULT: "one",
		});
	});

	it("replaces inherited Windows keys case-insensitively", () => {
		expect(mergeEnvironmentVariables({ Path: "inherited", HOME: "kept" }, { PATH: "configured" }, true)).toEqual({
			HOME: "kept",
			PATH: "configured",
		});
	});
});

describe("createChildEnvironment", () => {
	it("augments an inherited PATH for desktop-launched processes", () => {
		expect(createChildEnvironment({ PATH: "/usr/bin" }, {}, "linux", "/home/user").PATH).toBe(
			"/home/user/.opencode/bin:/home/user/.local/bin:/home/user/bin:/usr/bin"
		);
	});

	it("preserves a configured PATH literally, including an empty value", () => {
		expect(createChildEnvironment({ PATH: "/usr/bin" }, { PATH: "" }, "linux", "/home/user").PATH).toBe("");
		expect(createChildEnvironment({ PATH: "inherited" }, { Path: "configured" }, "win32", "C:\\Users\\user")).toEqual({
			PATH: "configured",
		});
	});

	it("treats PATH casing as significant outside Windows", () => {
		expect(createChildEnvironment({ PATH: "/usr/bin" }, { Path: "literal" }, "linux", "/home/user")).toMatchObject({
			PATH: "/home/user/.opencode/bin:/home/user/.local/bin:/home/user/bin:/usr/bin",
			Path: "literal",
		});
	});
});
