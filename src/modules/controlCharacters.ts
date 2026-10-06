/** C0 controls and DEL cannot be part of terminal links or autocomplete paths. */
export function hasControlCharacter(text: string): boolean {
	return Array.from(text).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
