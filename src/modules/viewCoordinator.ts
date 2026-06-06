import { WorkspaceLeaf, Workspace } from "obsidian";
import type { PanelMode } from "../settings";

export interface ViewCoordinatorConfig {
	terminalViewType: string;
	bottomViewType: string;
	conversationViewType: string;
	getPanelMode?: () => PanelMode;
}

export class ViewCoordinator {
	private readonly getPanelMode: () => PanelMode;

	constructor(
		private workspace: Workspace,
		private config: ViewCoordinatorConfig
	) {
		this.getPanelMode = config.getPanelMode ?? (() => "sidebar");
	}

	private viewTypeForMode(mode: PanelMode): string {
		return mode === "bottom" ? this.config.bottomViewType : this.config.terminalViewType;
	}

	async activateTerminalView(): Promise<WorkspaceLeaf | null> {
		return this.getPanelMode() === "bottom"
			? this.activateBottomTerminalView()
			: this.activateSidebarTerminalView();
	}

	async activateSidebarTerminalView(): Promise<WorkspaceLeaf | null> {
		return this.activateViewOfType(this.config.terminalViewType, () => this.workspace.getRightLeaf(false));
	}

	async activateBottomTerminalView(): Promise<WorkspaceLeaf | null> {
		return this.activateViewOfType(this.config.bottomViewType, () => this.workspace.getLeaf("split"));
	}

	async activateInMode(mode: PanelMode): Promise<WorkspaceLeaf | null> {
		return mode === "bottom"
			? this.activateBottomTerminalView()
			: this.activateSidebarTerminalView();
	}

	getActiveTerminalLeaf(): WorkspaceLeaf | null {
		const sidebar = this.workspace.getLeavesOfType(this.config.terminalViewType)[0];
		if (sidebar) return sidebar;
		return this.workspace.getLeavesOfType(this.config.bottomViewType)[0] ?? null;
	}

	getPanelModeSnapshot(): PanelMode {
		return this.getPanelMode();
	}

	destroyLeaf(viewType: string): void {
		for (const leaf of this.workspace.getLeavesOfType(viewType)) {
			leaf.detach();
		}
	}

	async activateConversationView(): Promise<WorkspaceLeaf | null> {
		let leaf = this.workspace.getLeavesOfType(this.config.conversationViewType)[0];
		if (!leaf) {
			const rightLeaf = this.workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: this.config.conversationViewType, active: true });
			}
		}
		if (leaf) await this.workspace.revealLeaf(leaf);
		return leaf;
	}

	async toggleTerminalSidebar(): Promise<WorkspaceLeaf | null> {
		const rightSplit = this.workspace.rightSplit;
		const isCollapsed = rightSplit?.collapsed ?? true;

		if (!isCollapsed) {
			rightSplit?.toggle();
			return null;
		} else {
			let leaf = this.workspace.getLeavesOfType(this.config.terminalViewType)[0];
			if (!leaf) {
				const newLeaf = this.workspace.getRightLeaf(false);
				if (newLeaf) {
					leaf = newLeaf;
					await leaf.setViewState({ type: this.config.terminalViewType, active: true });
				}
			}
			if (leaf) await this.workspace.revealLeaf(leaf);
			return leaf;
		}
	}

	async openOrRestartTerminal(restartFn: () => void): Promise<WorkspaceLeaf | null> {
		const viewType = this.viewTypeForMode(this.getPanelMode());
		let leaf = this.workspace.getLeavesOfType(viewType)[0];
		if (leaf) {
			restartFn();
			await this.workspace.revealLeaf(leaf);
			return leaf;
		} else {
			const newLeaf = this.getPanelMode() === "bottom"
				? this.workspace.getLeaf("split")
				: this.workspace.getRightLeaf(false);
			if (newLeaf) {
				await newLeaf.setViewState({ type: viewType, active: true });
				await this.workspace.revealLeaf(newLeaf);
				return newLeaf;
			}
		}
		return null;
	}

	private async activateViewOfType(
		viewType: string,
		leafFactory: () => WorkspaceLeaf | null
	): Promise<WorkspaceLeaf | null> {
		let leaf = this.workspace.getLeavesOfType(viewType)[0];
		if (!leaf) {
			const candidate = leafFactory();
			if (candidate) {
				leaf = candidate;
				await leaf.setViewState({ type: viewType, active: true });
			}
		}
		if (leaf) await this.workspace.revealLeaf(leaf);
		return leaf;
	}
}
