import { App, PluginSettingTab, Setting } from "obsidian";
import OpencodePlugin from "./main";

export class OpencodeSettingTab extends PluginSettingTab {
	plugin: OpencodePlugin;

	constructor(app: App, plugin: OpencodePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "OpenCode Settings" });

		new Setting(containerEl)
			.setName("OpenCode path")
			.setDesc("Path to the opencode executable. Leave as 'opencode' to use PATH.")
			.addText((text) =>
				text
					.setPlaceholder("opencode")
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
			.setName("Terminal font size")
			.setDesc("Font size for the integrated terminal.")
			.addSlider((slider) =>
				slider
					.setLimits(8, 32, 1)
					.setValue(this.plugin.settings.terminalFontSize)
					.setDynamicTooltip()
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
					.setPlaceholder("monospace")
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
