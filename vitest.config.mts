import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./__mocks__/obsidian.ts', import.meta.url)),
		},
	},
});
