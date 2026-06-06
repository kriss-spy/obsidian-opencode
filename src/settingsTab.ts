import { App, PluginSettingTab, Setting } from "obsidian";
import OpencodePlugin from "./main";
import type { PanelMode } from "./settings";

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
			.setName("OpenCode path") // eslint-disable-line obsidianmd/ui/sentence-case
			.setDesc("Path to the opencode executable. Leave as 'opencode' to use PATH.") // eslint-disable-line obsidianmd/ui/sentence-case
			.addText((text) =>
				text
					.setPlaceholder("opencode") // eslint-disable-line obsidianmd/ui/sentence-case
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

		new Setting(containerEl)
			.setName("Panel mode")
			.setDesc("Where the OpenCode terminal is docked. \"sidebar\" uses the right rail; \"bottom\" uses a bottom panel.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("sidebar", "Sidebar")
					.addOption("bottom", "Bottom panel")
					.setValue(this.plugin.settings.panelMode)
					.onChange(async (value) => {
						const newMode = value as PanelMode;
						if (newMode === this.plugin.settings.panelMode) return;
						this.plugin.settings.panelMode = newMode;
						await this.plugin.saveSettings();
						await this.plugin.handlePanelModeChange(newMode);
					})
			);
	}
}
