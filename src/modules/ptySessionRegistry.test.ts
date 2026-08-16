import { describe, expect, it, vi } from "vitest";
import { PtySessionRegistry } from "./ptySessionRegistry";
import type { PtySession } from "./ptySession";

describe("PtySessionRegistry", () => {
	it("waits for every active session during plugin shutdown", async () => {
		let finishFirst: (() => void) | undefined;
		const killFirst = vi.fn(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
		const killSecond = vi.fn().mockResolvedValue(undefined);
		const first = {
			kill: killFirst,
		} as unknown as PtySession;
		const second = {
			kill: killSecond,
		} as unknown as PtySession;
		const registry = new PtySessionRegistry();
		registry.register(first);
		registry.register(second);

		let stopped = false;
		const stopping = registry.closeAll().then(() => { stopped = true; });
		await Promise.resolve();
		expect(killFirst).toHaveBeenCalledOnce();
		expect(killSecond).toHaveBeenCalledOnce();
		expect(stopped).toBe(false);

		finishFirst!();
		await stopping;
		expect(stopped).toBe(true);
	});
});
