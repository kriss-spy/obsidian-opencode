// onData includes terminal negotiation as well as prompt input. Exclude only
// complete replies in their own events; never strip bytes from a mixed chunk.
export function promptInputWrites(writes: readonly string[]): string[] {
	return writes.filter(data => data !== "\x1b[I" && data !== "\x1b[O"
		&& !/^\x1b\[\?[0-9]+(?:;[0-9]+)*c$/.test(data));
}
