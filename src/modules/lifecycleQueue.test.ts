import { describe, expect, it, vi } from "vitest";
import { LifecycleQueue } from "./lifecycleQueue";

describe("LifecycleQueue", () => {
	it("does not start a replacement operation until shutdown finishes", async () => {
		let finishShutdown: (() => void) | undefined;
		const queue = new LifecycleQueue();
		const first = queue.enqueue(() => new Promise<void>((resolve) => { finishShutdown = resolve; }));
		const replacement = vi.fn();
		const second = queue.enqueue(replacement);

		await Promise.resolve();
		expect(replacement).not.toHaveBeenCalled();
		finishShutdown!();
		await Promise.all([first, second]);
		expect(replacement).toHaveBeenCalledOnce();
	});

	it("continues after a failed operation", async () => {
		const queue = new LifecycleQueue();
		await expect(queue.enqueue(() => { throw new Error("failed"); })).rejects.toThrow("failed");
		const next = vi.fn();
		await queue.enqueue(next);
		expect(next).toHaveBeenCalledOnce();
	});
});
