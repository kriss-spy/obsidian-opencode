// Destination paths and wrapping from session ses_ef07f9a7affeA2ezHBLKsUB6Yy.
const records = [
	{ note: "extracurricular/efficiency/apps/media/video editing/Premiere.md",
		fragments: ["extracurricular/", "efficiency/apps/media/", "video editing/", "Premiere.md"],
		section: ["Pr剪辑基本流", "程"], changes: ["Expand the existing tool note", "with the eight-step workflow."] },
	{ note: "extracurricular/creation/video/craft/editing and pacing.md",
		fragments: ["extracurricular/", "creation/video/craft/", "editing and pacing.md"],
		section: ["预览"], changes: ["Add preview/playback guidance,", "including reducing preview", "resolution when playback", "struggles."] },
	{ note: "study/CS/Systems/Operating System/Graphics API/OpenGL.md",
		fragments: ["study/CS/Systems/", "Operating System/", "Graphics API/OpenGL.md"],
		section: ["OpenGL"], changes: ["Fill the existing empty note", "with the definition,", "applications, history, and", "rendering capabilities."] },
	{ note: "study/CS/Systems/Operating System/Graphics API/OpenGL ES.md",
		fragments: ["study/CS/Systems/", "Operating System/", "Graphics API/OpenGL", "ES.md"],
		section: ["OpenGL ES", "subsection"], changes: ["Fill the existing empty note", "and link it to OpenGL."] },
	{ note: "extracurricular/creation/video/craft/encoding and export.md",
		fragments: ["extracurricular/", "creation/video/craft/", "encoding and export.md"],
		section: ["关于编码"], changes: ["Create a reusable guide", "covering codecs, bitrate,", "hardware acceleration,", "resolution/frame rate, presets,", "and export checks."] },
];
const pad = (text: string, width: number) => text + " ".repeat(width - Array.from(text).reduce((total, char) => total + (/[\u2e80-\u9fff]/.test(char) ? 2 : 1), 0));
export const separator = " ".repeat(21) + "├" + "─".repeat(15) + "┼" + "─".repeat(24) + "┼" + "─".repeat(33) + "┤    ";
export default records.map(record => ({ ...record, lines: [separator, ...Array.from({ length: Math.max(record.fragments.length, record.changes.length) }, (_, row) =>
	`${row % 2 ? "   Recent session".padEnd(21) : " ".repeat(21)}│ ${pad(record.section[row] ?? "", 13)} │ ${pad(record.fragments[row] ?? "", 22)} │ ${pad(record.changes[row] ?? "", 31)} │    `), separator] }));
