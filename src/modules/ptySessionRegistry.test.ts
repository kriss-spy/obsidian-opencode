import { describe, expect, it, vi } from "vitest";
import { PtySessionRegistry } from "./ptySessionRegistry";
import type { PtySession } from "./ptySession";

describe("PtySessionRegistry", () => {
	it("waits for every active session during plugin shutdown", async () => {
		let finishFirst: (() => void) | undefined;
		const first = {
			kill: vi.fn(() => new Promise<void>((resolve) => { finishFirst = resolve; })),
		} as unknown as PtySession;
		const second = {
			kill: vi.fn().mockResolvedValue(undefined),
		} as unknown as PtySession;
		const registry = new PtySessionRegistry();
		registry.register(first);
		registry.register(second);

		let stopped = false;
		const stopping = registry.closeAll().then(() => { stopped = true; });
		await Promise.resolve();
		expect(first.kill).toHaveBeenCalledOnce();
		expect(second.kill).toHaveBeenCalledOnce();
		expect(stopped).toBe(false);

		finishFirst!();
		await stopping;
		expect(stopped).toBe(true);
	});
});
