import { Workspace, WorkspaceLeaf } from "obsidian";

type Direction = "horizontal" | "vertical";

interface RootSplitShape {
	direction: Direction;
	children: unknown[];
	setDirection?: (d: Direction) => void;
	containerEl?: {
		classList?: {
			add: (cls: string) => void;
			remove: (cls: string) => void;
		};
	};
}

interface WorkspaceInternals {
	rootSplit: RootSplitShape;
	createLeafInParent(parent: RootSplitShape, index: number): WorkspaceLeaf;
}

export class BottomPanelDocking {
	private readonly workspace: WorkspaceInternals;
	private readonly rootSplit: RootSplitShape;
	private originalDirection: Direction | null = null;

	constructor(workspace: Workspace) {
		this.workspace = (workspace as unknown as WorkspaceInternals);
		this.rootSplit = this.workspace.rootSplit;
	}

	isActive(): boolean {
		return this.originalDirection !== null;
	}

	enter(): void {
		if (this.originalDirection !== null) return;
		this.originalDirection = this.rootSplit.direction;
		this.setDirection("horizontal");
	}

	maybeExit(): void {
		if (this.originalDirection === null) return;
		if (this.rootSplit.children.length === 0) {
			this.setDirection(this.originalDirection);
			this.originalDirection = null;
		}
	}

	createBottomLeaf(): WorkspaceLeaf {
		return this.workspace.createLeafInParent(this.rootSplit, this.rootSplit.children.length);
	}

	private setDirection(d: Direction): void {
		if (typeof this.rootSplit.setDirection === "function") {
			this.rootSplit.setDirection(d);
			return;
		}
		this.rootSplit.direction = d;
		this.rootSplit.containerEl?.classList?.remove?.("mod-vertical");
		this.rootSplit.containerEl?.classList?.add?.("mod-horizontal");
	}
}
