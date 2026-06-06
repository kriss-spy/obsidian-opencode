import type { PanelMode } from "../settings";
import type { SessionState } from "./sessionState";
import type { ViewCoordinator } from "./viewCoordinator";

export interface PanelMigratorDeps {
	sessionState: SessionState;
	viewCoordinator: ViewCoordinator;
	terminalViewType: string;
	bottomViewType: string;
}

export class PanelMigrator {
	constructor(private deps: PanelMigratorDeps) {}

	async migrateTo(mode: PanelMode): Promise<void> {
		const oldViewType = mode === "bottom"
			? this.deps.terminalViewType
			: this.deps.bottomViewType;
		this.deps.viewCoordinator.destroyLeaf(oldViewType);
		this.deps.sessionState.replayLastSession();
		await this.deps.viewCoordinator.activateInMode(mode);
	}

	async openInMode(mode: PanelMode): Promise<void> {
		const myViewType = mode === "bottom"
			? this.deps.bottomViewType
			: this.deps.terminalViewType;
		const focused = await this.deps.viewCoordinator.focusLeafOfType(myViewType);
		if (focused) return;
		await this.migrateTo(mode);
	}
}
