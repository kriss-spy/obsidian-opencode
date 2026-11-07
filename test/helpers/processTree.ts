export type ProcessRow = { pid: number; parent: number; name: string; state?: string; created?: number };

export function descendantProcesses(rows: ProcessRow[], roots: number[]): ProcessRow[] {
	const byPid = new Map(rows.map(row => [row.pid, row]));
	const owned = new Set(roots);
	let previousSize = -1;
	while (previousSize !== owned.size) {
		previousSize = owned.size;
		for (const row of rows) {
			const parent = byPid.get(row.parent);
			// Windows retains a parent's numeric PID after it exits. That PID
			// can later belong to our test process; older children are unrelated.
			if (owned.has(row.parent) && (row.created === undefined || parent?.created === undefined || row.created >= parent.created)) owned.add(row.pid);
		}
	}
	return rows.filter(row => owned.has(row.pid));
}

export function survivingProcesses(owned: ProcessRow[], current: ProcessRow[]): ProcessRow[] {
	return owned.filter(before => current.some(now => now.pid === before.pid && !now.state?.startsWith("Z")
		&& (before.created === undefined || now.created === before.created)));
}
