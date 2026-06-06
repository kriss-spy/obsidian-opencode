export type ToggleAction = "reveal" | "collapse" | "focus";

export interface ToggleState {
	hasLeaf: boolean;
	isCollapsed: boolean;
	isFocused: boolean;
}

export function decideToggleAction(state: ToggleState): ToggleAction {
	if (!state.hasLeaf) return "reveal";
	if (state.isCollapsed) return "reveal";
	if (state.isFocused) return "collapse";
	return "focus";
}
