// Transcribed from the user-input screenshot in issue #68. OpenCode draws
// these as hard rows, with the next URL following a continuation on row 2.
const userInputHttp = {
	cols: 59,
	lines: [
		"     add knowledge https://en.wikipedia.org/wiki/",
		"     OpenGL_Shading_Language, https://docs.unity3d.com/",
		"     6000.1/Documentation/Manual/SL-Reference.html,",
		"     https://en.wikipedia.org/wiki/High-",
		"     Level_Shader_Language",
	],
	urls: [
		"https://en.wikipedia.org/wiki/OpenGL_Shading_Language",
		"https://docs.unity3d.com/6000.1/Documentation/Manual/SL-Reference.html",
		"https://en.wikipedia.org/wiki/High-Level_Shader_Language",
	],
};
export default userInputHttp;

// Captured from CloudNotes after shrinking the alternate buffer. xterm keeps
// 111 cells per row although only the first 66 are visible; the tail is stale.
export const resizedUserInputHttp = {
	cols: 66,
	lines: [
		"  ┃  add knowledge https://en.wikipedia.org/wiki/              █  Documentation/Manual/SL-Reference.html,   █  ",
		"  ┃  OpenGL_Shading_Language, https://docs.unity3d.com/6000.1/ ▀  gh-Level_Shader_Language                     ",
		"  ┃  Documentation/Manual/SL-Reference.html, https://en.                                                       ",
		"  ┃  wikipedia.org/wiki/High-Level_Shader_Language                                                             ",
	],
	urls: userInputHttp.urls,
};

export const wrappedBlockUserInputHttp = {
	cols: 90,
	lines: [
		"  ┃  add knowledge https://en.wikipedia.org/wiki/OpenGL_Shading_Language, https://",
		"  ┃  docs.unity3d.com/6000.1/Documentation/Manual/SL-Reference.html, https://en.",
		"  ┃  wikipedia.org/wiki/High-Level_Shader_Language",
	],
	urls: userInputHttp.urls,
};

export const sidebarUserInputHttp = {
	cols: 96,
	lines: [
		"    cloudnotes                 ┃  add knowledge https://en.wikipedia.org/wiki/",
		"                               ┃  OpenGL_Shading_Language, https://docs.unity3d.com/6000.1/",
		"    Lucid dreaming knowledge   ┃  Documentation/Manual/SL-Reference.html, https://en.",
		"    cloudnotes                 ┃  wikipedia.org/wiki/High-Level_Shader_Language",
	],
	urls: userInputHttp.urls,
};
