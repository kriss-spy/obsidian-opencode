export class App {}

export class Scope {
	readonly handlers: Array<{
		modifiers: string[] | null;
		key: string | null;
		callback: (event: KeyboardEvent, context: unknown) => unknown;
	}> = [];

	register(
		modifiers: string[] | null,
		key: string | null,
		callback: (event: KeyboardEvent, context: unknown) => unknown,
	) {
		const handler = { modifiers, key, callback, scope: this };
		this.handlers.push(handler);
		return handler;
	}

	unregister(handler: { callback: (event: KeyboardEvent, context: unknown) => unknown }): void {
		const index = this.handlers.indexOf(handler as typeof this.handlers[number]);
		if (index >= 0) this.handlers.splice(index, 1);
	}
}

export class TFile {
	path: string = '';
	name: string = '';
}

export class Notice {
	constructor(public message: string) {}
}

export function moment(timestamp: number) {
	return {
		format: (fmt: string) => '2024-01-01 12:00:00',
	};
}
