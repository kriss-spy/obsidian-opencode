export class App {}

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
