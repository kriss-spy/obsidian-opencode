import { WorkspaceLeaf, Workspace } from "obsidian";

export interface ViewCoordinatorConfig {
	terminalViewType: string;
	conversationViewType: string;
}

export class ViewCoordinator {
	constructor(
		private workspace: Workspace,
		private config: ViewCoordinatorConfig
	) {}

	async activateTerminalView(): Promise<WorkspaceLeaf | null> {
		let leaf = this.workspace.getLeavesOfType(this.config.terminalViewType)[0];
		if (!leaf) {
			const rightLeaf = this.workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: this.config.terminalViewType, active: true });
			}
		}
		if (leaf) await this.workspace.revealLeaf(leaf);
		return leaf;
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
			// Right sidebar is visible — collapse it (leaf stays alive)
			rightSplit?.toggle();
			return null;
		} else {
			// Right sidebar is collapsed — ensure leaf exists, then reveal
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

	async openOrRestartTerminal(restartFn: () => void | Promise<void>): Promise<WorkspaceLeaf | null> {
		let leaf = this.workspace.getLeavesOfType(this.config.terminalViewType)[0];
		if (leaf) {
			await restartFn();
			await this.workspace.revealLeaf(leaf);
			return leaf;
		} else {
			const rightLeaf = this.workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({ type: this.config.terminalViewType, active: true });
				await this.workspace.revealLeaf(rightLeaf);
				return rightLeaf;
			}
		}
		return null;
	}

	async closeTerminalViews(): Promise<void> {
		const leaves = [...this.workspace.getLeavesOfType(this.config.terminalViewType)];
		await Promise.all(leaves.map((leaf) => leaf.detach()));
	}
}
