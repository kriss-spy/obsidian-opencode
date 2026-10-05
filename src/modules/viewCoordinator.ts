import { WorkspaceLeaf, Workspace } from "obsidian";

export interface ViewCoordinatorConfig {
	terminalViewType: string;
	conversationViewType: string;
}

interface TerminalFocusView {
	focusTerminal(): void;
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
		if (leaf) await this.revealTerminal(leaf);
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
			if (leaf) await this.revealTerminal(leaf);
			return leaf;
		}
	}

	async closeTerminal(): Promise<void> {
		const leaves = [...this.workspace.getLeavesOfType(this.config.terminalViewType)];
		leaves.forEach((leaf) => leaf.detach());
	}

	async openOrRestartTerminal(restartFn: () => void | Promise<void>): Promise<WorkspaceLeaf | null> {
		let leaf = this.workspace.getLeavesOfType(this.config.terminalViewType)[0];
		if (leaf) {
			// Reveal and focus before the asynchronous restart. Finishing a slow
			// process replacement must not pull the user back from another note.
			await this.revealTerminal(leaf);
			await restartFn();
			return leaf;
		} else {
			const rightLeaf = this.workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({ type: this.config.terminalViewType, active: true });
				await this.revealTerminal(rightLeaf);
				return rightLeaf;
			}
		}
		return null;
	}

	private async revealTerminal(leaf: WorkspaceLeaf): Promise<void> {
		await this.workspace.revealLeaf(leaf);
		const view = leaf.view as unknown as Partial<TerminalFocusView>;
		view.focusTerminal?.();
	}

}
