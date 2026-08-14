export class LifecycleQueue {
	private tail: Promise<void> = Promise.resolve();

	enqueue(operation: () => void | Promise<void>): Promise<void> {
		const result = this.tail.then(operation, operation);
		this.tail = result.catch(() => undefined);
		return result;
	}
}
