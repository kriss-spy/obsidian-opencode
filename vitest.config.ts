import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, '__mocks__/obsidian.ts'),
		},
	},
});
