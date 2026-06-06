import { WorkspaceLeaf, Workspace } from "obsidian";
import type { PanelMode } from "../settings";
import { BottomPanelDocking } from "./bottomPanelDocking";
import { decideToggleAction } from "./toggleAction";

export interface ViewCoordinatorConfig {
	terminalViewType: string;
	bottomViewType: string;
	conversationViewType: string;
	getPanelMode?: () => PanelMode;
}

export class ViewCoordinator {
	private readonly getPanelMode: () => PanelMode;
	private readonly bottomDocking: BottomPanelDocking;

	constructor(
		private workspace: Workspace,
		private config: ViewCoordinatorConfig
	) {
		this.getPanelMode = config.getPanelMode ?? (() => "sidebar");
		this.bottomDocking = new BottomPanelDocking(workspace);
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
		let leaf = this.workspace.getLeavesOfType(this.config.bottomViewType)[0];
		if (leaf) {
			await this.workspace.revealLeaf(leaf);
			return leaf;
		}
		this.bottomDocking.enter();
		const newLeaf = this.bottomDocking.createBottomLeaf();
		await newLeaf.setViewState({ type: this.config.bottomViewType, active: true });
		await this.workspace.revealLeaf(newLeaf);
		return newLeaf;
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
		if (viewType === this.config.bottomViewType) {
			this.bottomDocking.maybeExit();
		}
	}

	async focusLeafOfType(viewType: string): Promise<WorkspaceLeaf | null> {
		const leaf = this.workspace.getLeavesOfType(viewType)[0];
		if (leaf) {
			await this.workspace.revealLeaf(leaf);
			return leaf;
		}
		return null;
	}

	async toggleTerminal(): Promise<WorkspaceLeaf | null> {
		const active = this.getActiveTerminalLeaf();
		if (!active) {
			return this.activateTerminalView();
		}
		const mode = (active as unknown as { viewType: string }).viewType === this.config.bottomViewType ? "bottom" : "sidebar";
		const isFocused = this.workspace.activeLeaf === active;
		const isCollapsed = mode === "bottom"
			? active.view?.containerEl?.classList?.contains("opencode-terminal-collapsed") ?? false
			: this.workspace.rightSplit?.collapsed ?? false;
		const action = decideToggleAction({ hasLeaf: true, isCollapsed, isFocused });

		if (mode === "sidebar") {
			if (action === "reveal") {
				if (this.workspace.rightSplit?.collapsed) {
					this.workspace.rightSplit.collapsed = false;
				}
				await this.workspace.revealLeaf(active);
			} else if (action === "collapse") {
				this.workspace.rightSplit?.toggle();
			} else {
				await this.workspace.revealLeaf(active);
			}
			return active;
		}

		// bottom mode
		if (action === "reveal") {
			active.view?.containerEl?.classList?.remove?.("opencode-terminal-collapsed");
			await this.workspace.revealLeaf(active);
		} else if (action === "collapse") {
			active.view?.containerEl?.classList?.add?.("opencode-terminal-collapsed");
		} else {
			await this.workspace.revealLeaf(active);
		}
		return active;
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

	async openOrRestartTerminal(restartFn: () => void): Promise<WorkspaceLeaf | null> {
		const viewType = this.viewTypeForMode(this.getPanelMode());
		let leaf = this.workspace.getLeavesOfType(viewType)[0];
		if (leaf) {
			restartFn();
			await this.workspace.revealLeaf(leaf);
			return leaf;
		}
		return this.getPanelMode() === "bottom"
			? this.activateBottomTerminalView()
			: this.activateSidebarTerminalView();
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
