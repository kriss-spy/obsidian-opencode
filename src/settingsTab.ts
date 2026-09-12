import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import OpencodePlugin from "./main";
import { parseEnvironmentVariables, serializeEnvironmentVariables } from "./utils/environment";

const environmentVariableFormat = "NAME=value";
const environmentVariableExample = [
	"EDITOR=/usr/bin/nvim",
	"VISUAL=/usr/bin/nvim",
	"GIT_EDITOR=/usr/bin/nvim",
	"OPENCODE_DISABLE_TERMINAL_TITLE=1",
].join("\n");

export class OpencodeSettingTab extends PluginSettingTab {
	plugin: OpencodePlugin;

	constructor(app: App, plugin: OpencodePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Opencode path",
				desc: "Leave empty to auto-detect opencode, or enter an executable name, ~/ path, or full path.",
				control: { type: "text", key: "opencodePath", placeholder: "Opencode" },
			},
			{
				name: "Default working directory",
				desc: "Default directory to start opencode in. Leave empty to use the vault root.",
				control: { type: "text", key: "defaultWorkingDirectory", placeholder: "/path/to/project" },
			},
			{
				name: "Environment variables",
				desc: `One environment variable per line in ${environmentVariableFormat} format. Values are literal; empty values are allowed.`,
				control: {
					type: "textarea",
					key: "environmentVariables",
					placeholder: environmentVariableExample,
					rows: 5,
					validate: (value) => {
						try {
							parseEnvironmentVariables(value);
						} catch (error) {
							return error instanceof Error ? error.message : "Invalid environment variables.";
						}
					},
				},
			},
			{
				name: "Terminal font size",
				desc: "Font size for the integrated terminal.",
				control: { type: "slider", key: "terminalFontSize", min: 8, max: 32, step: 1 },
			},
			{
				name: "Terminal font family",
				desc: "Font family for the integrated terminal.",
				control: { type: "text", key: "terminalFontFamily", placeholder: "Monospace" },
			},
			{
				name: "New session arguments",
				desc: "Additional arguments to pass when starting a new opencode session (e.g. --model provider/model).",
				control: { type: "text", key: "newSessionArgs", placeholder: "--model opencode-go/kimi-k2.6" },
			},
		];
	}

	getControlValue(key: string): unknown {
		switch (key) {
			case "opencodePath": return this.plugin.settings.opencodePath;
			case "defaultWorkingDirectory": return this.plugin.settings.defaultWorkingDirectory;
			case "environmentVariables": return serializeEnvironmentVariables(this.plugin.settings.environmentVariables);
			case "terminalFontSize": return this.plugin.settings.terminalFontSize;
			case "terminalFontFamily": return this.plugin.settings.terminalFontFamily;
			case "newSessionArgs": return this.plugin.settings.newSessionArgs;
			default: return undefined;
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key) {
			case "opencodePath":
				if (typeof value === "string") this.plugin.settings.opencodePath = value.trim();
				break;
			case "defaultWorkingDirectory":
				if (typeof value === "string") this.plugin.settings.defaultWorkingDirectory = value;
				break;
			case "environmentVariables":
				if (typeof value === "string") this.plugin.settings.environmentVariables = parseEnvironmentVariables(value);
				break;
			case "terminalFontSize":
				if (typeof value === "number") this.plugin.settings.terminalFontSize = value;
				break;
			case "terminalFontFamily":
				if (typeof value === "string") this.plugin.settings.terminalFontFamily = value || "monospace";
				break;
			case "newSessionArgs":
				if (typeof value === "string") this.plugin.settings.newSessionArgs = value;
				break;
			default:
				return;
		}
		await this.plugin.saveSettings();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Opencode path")
			.setDesc("Leave empty to auto-detect opencode, or enter an executable name, ~/ path, or full path.")
			.addText((text) =>
				text
					.setPlaceholder("Opencode")
					.setValue(this.plugin.settings.opencodePath)
					.onChange(async (value) => {
						this.plugin.settings.opencodePath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Default working directory")
			.setDesc("Default directory to start opencode in. Leave empty to use the vault root.")
			.addText((text) =>
				text
					.setPlaceholder("/path/to/project")
					.setValue(this.plugin.settings.defaultWorkingDirectory)
					.onChange(async (value) => {
						this.plugin.settings.defaultWorkingDirectory = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Environment variables")
			.setDesc(`One environment variable per line in ${environmentVariableFormat} format. Values are literal; empty values are allowed.`)
			.addTextArea((text) => {
				text
					.setPlaceholder(environmentVariableExample)
					.setValue(serializeEnvironmentVariables(this.plugin.settings.environmentVariables))
					.onChange(async (value) => {
						try {
							const variables = parseEnvironmentVariables(value);
							text.inputEl.setCustomValidity("");
							this.plugin.settings.environmentVariables = variables;
							await this.plugin.saveSettings();
						} catch (error) {
							text.inputEl.setCustomValidity(error instanceof Error ? error.message : String(error));
							text.inputEl.reportValidity();
						}
					});
				text.inputEl.rows = 5;
			});

		new Setting(containerEl)
			.setName("Terminal font size")
			.setDesc("Font size for the integrated terminal.")
			.addSlider((slider) =>
				slider
					.setLimits(8, 32, 1)
					.setValue(this.plugin.settings.terminalFontSize)
					.onChange(async (value) => {
						this.plugin.settings.terminalFontSize = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Terminal font family")
			.setDesc("Font family for the integrated terminal.")
			.addText((text) =>
				text
					.setPlaceholder("Monospace")
					.setValue(this.plugin.settings.terminalFontFamily)
					.onChange(async (value) => {
						this.plugin.settings.terminalFontFamily = value || "monospace";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("New session arguments")
			.setDesc("Additional arguments to pass when starting a new opencode session (e.g. --model provider/model).")
			.addText((text) =>
				text
					.setPlaceholder("--model opencode-go/kimi-k2.6")
					.setValue(this.plugin.settings.newSessionArgs)
					.onChange(async (value) => {
						this.plugin.settings.newSessionArgs = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
