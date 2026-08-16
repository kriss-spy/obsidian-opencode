import { App, PluginSettingTab, Setting } from "obsidian";
import OpencodePlugin from "./main";
import { parseEnvironmentVariables, serializeEnvironmentVariables } from "./utils/environment";

export class OpencodeSettingTab extends PluginSettingTab {
	plugin: OpencodePlugin;

	constructor(app: App, plugin: OpencodePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Opencode path")
			.setDesc("Full absolute path to the opencode executable. Obsidian may not inherit your shell path.")
			.addText((text) =>
				text
					.setPlaceholder("Opencode")
					.setValue(this.plugin.settings.opencodePath)
					.onChange(async (value) => {
						this.plugin.settings.opencodePath = value || "opencode";
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
			.setDesc("One NAME=value entry per line. Values are literal; empty values are allowed.")
			.addTextArea((text) => {
				text
					.setPlaceholder("OPENCODE_CONFIG_DIR=/home/user/.config/opencode-vault")
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
