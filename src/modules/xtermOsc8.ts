import type { IBufferCellPosition, Terminal } from "@xterm/xterm";

/**
 * xterm 5.5 exposes cell contents but not OSC 8 metadata in its public API.
 * Keep this version-sensitive read-only adapter here; its own OscLinkProvider
 * uses the same CellData URL id and registry. A missing registry fails closed.
 */
export function currentOsc8Link(terminal: Terminal, cell: IBufferCellPosition): { present: boolean; uri?: string } {
	const data = terminal.buffer.active.getLine(cell.y - 1)?.getCell(cell.x - 1) as unknown as {
		extended?: { urlId?: number };
	} | undefined;
	const id = data?.extended?.urlId;
	if (!id) return { present: false };
	const core = terminal as unknown as { _core?: { _oscLinkService?: { getLinkData?: (id: number) => { uri?: string } | undefined } } };
	const service = core._core?._oscLinkService;
	return { present: true, uri: typeof service?.getLinkData === "function" ? service.getLinkData(id)?.uri : undefined };
}
