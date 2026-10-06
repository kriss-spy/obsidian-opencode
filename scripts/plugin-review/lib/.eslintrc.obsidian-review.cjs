// ESLint flat config for the local review script.
// Best-effort approximation of public reviewer rules:
//   - eslint-plugin-obsidianmd (Obsidian-specific rules)
//   - @typescript-eslint (TypeScript safety rules)
//
// We start from the obsidianmd plugin's `recommended` config, which
// already pulls in:
//   - the recommended obsidianmd ruleset
//   - typescript-eslint recommended-type-checked (so no-explicit-any,
//     no-floating-promises, no-unsafe-*, etc. are wired up)
//   - import/no-nodejs-modules, depend/ban-dependencies, sdl/no-inner-html
//
// We only add what's *not* in that config:
//   - the Obsidian runtime globals (app, Plugin, Modal, etc.)
//   - a couple of severity overrides to match the reviewer's choices
//
// Output is consumed by scripts/lib/report.sh which reshapes the JSON
// findings into the reviewer's three-section markdown format.
//
// Install in the skill's scripts/lib/ directory with:
//   cd scripts/lib && npm install
//
// The runner uses the eslint binary at:
//   scripts/lib/node_modules/.bin/eslint
// (or wherever $ESLINT_BIN points).

// eslint-plugin-obsidianmd is ESM-only; in a CJS config file we have
// to dig into the namespace's `default` export.
const obsidianmdModule = require("eslint-plugin-obsidianmd");
const obsidianmd = obsidianmdModule.default || obsidianmdModule;

// The runner cd's into the plugin root before invoking eslint, so
// process.cwd() is the absolute path we need for tsconfigRootDir.
const PLUGIN_ROOT = process.cwd();

module.exports = [
  // ── Base: the obsidianmd recommended config ──────────────────────
  // This already includes:
  //   - obsidianmd/* rules
  //   - @typescript-eslint/* recommended-type-checked rules
  //   - import/no-nodejs-modules, depend/ban-dependencies
  //   - the Obsidian browser globals
  ...obsidianmd.configs.recommended,

  // ── Project-wide ignores ──────────────────────────────────────────
  {
    ignores: [
      "**/node_modules/**",
      "**/.obsidian/**",
      "**/dist/**",
      "**/build/**",
      "**/*.d.ts",
    ],
  },

  // ── Add Obsidian-specific runtime globals + parser project ─────────
  // The recommended config registers a default set of browser/Node
  // globals; we add the Obsidian plugin globals on top. We also
  // enable type-aware linting by pointing the parser at tsconfig.json
  // — required by the `recommended-type-checked` ruleset.
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: [`${PLUGIN_ROOT}/tsconfig.json`],
        tsconfigRootDir: PLUGIN_ROOT,
      },
      globals: {
        app: "readonly",
        Plugin: "readonly",
        Modal: "readonly",
        Setting: "readonly",
        PluginSettingTab: "readonly",
        WorkspaceLeaf: "readonly",
        Editor: "readonly",
        MarkdownView: "readonly",
        TFile: "readonly",
        TFolder: "readonly",
        TAbstractFile: "readonly",
        Notice: "readonly",
        ItemView: "readonly",
        TextComponent: "readonly",
        ToggleComponent: "readonly",
        DropdownComponent: "readonly",
        SliderComponent: "readonly",
        TextAreaComponent: "readonly",
        ButtonComponent: "readonly",
        ExtraButtonComponent: "readonly",
        AbstractInputSuggest: "readonly",
        PluginManifest: "readonly",
        requireApiVersion: "readonly",
        Platform: "readonly",
        normalizePath: "readonly",
      },
    },
  },

  // ── Severity overrides to match the reviewer's choices ───────────
  // The obsidianmd recommended config sets some of these to Error and
  // some to Warning. We override a few that the reviewer treats
  // differently.
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // The recommended config has these as Error; reviewer agrees.
      // (no-op; documented for clarity)

      // Recommended config has these as Error; reviewer has them as Warning.
      "obsidianmd/commands/no-plugin-id-in-command-id": "warn",
      "obsidianmd/commands/no-plugin-name-in-command-name": "warn",
      "obsidianmd/commands/no-default-hotkeys": "warn",
      "obsidianmd/commands/no-command-in-command-id": "warn",
      "obsidianmd/commands/no-command-in-command-name": "warn",
      "obsidianmd/hardcoded-config-path": "warn",
      "obsidianmd/prefer-active-doc": "warn",
      "obsidianmd/prefer-window-timers": "warn",
      "obsidianmd/prefer-abstract-input-suggest": "warn",
      "obsidianmd/prefer-file-manager-trash-file": "warn",
      "obsidianmd/object-assign": "warn",
      "obsidianmd/no-sample-code": "warn",
      "obsidianmd/no-tfile-tfolder-cast": "warn",
      "obsidianmd/platform": "warn",
      "obsidianmd/vault/iterate": "warn",
      "obsidianmd/ui/sentence-case": ["warn"],

      // Recommended config sets no-explicit-any to Error; reviewer
      // has it as Warning.
      "@typescript-eslint/no-explicit-any": "warn",

      // Recommended config has ban-ts-comment off; reviewer treats as Error.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": true,
          "ts-expect-error": "allow-with-description",
          "ts-nocheck": true,
          "ts-check": false,
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts"],
    // Node-only unit fixtures explicitly provide timer hosts; no browser globals exist.
    rules: { "obsidianmd/no-global-this": "off" },
  },
];
