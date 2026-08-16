import { describe, expect, it } from "vitest";
import { mergeEnvironmentVariables, parseEnvironmentVariables } from "./environment";

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
