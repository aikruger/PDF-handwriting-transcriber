/**
 * Settings Tab for PDF Transcriber
 * User configuration panel
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import { PDFTranscriberSettings } from '../types';

export class PDFTranscriberSettingTab extends PluginSettingTab {
  private plugin: any;

  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // === OPENAI CONFIGURATION ===
    containerEl.createEl('h2', { text: '🤖 OpenAI Configuration' });

    new Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc('Get your key from https://platform.openai.com/api-keys')
      .addText((text) =>
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Select Model')
      .setDesc('Choose OpenAI model for transcription')
      .addDropdown((dropdown) => {
        this.plugin.settings.availableModels.forEach((model: string) => {
          dropdown.addOption(model, model);
        });
        dropdown.setValue(this.plugin.settings.selectedModel);
        dropdown.onChange(async (value) => {
          this.plugin.settings.selectedModel = value;
          await this.plugin.saveSettings();
        });
      });

    // === PDF PROCESSING ===
    containerEl.createEl('h2', { text: '📄 PDF Processing' });

    new Setting(containerEl)
      .setName('Max Pages')
      .setDesc('Maximum pages to process per PDF')
      .addSlider((slider) =>
        slider
          .setLimits(1, 100, 1)
          .setValue(this.plugin.settings.maxPages)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxPages = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Start Page')
      .setDesc('First page to process (1-based)')
      .addText((text) =>
        text
          .setPlaceholder('1')
          .setValue(String(this.plugin.settings.pageStart))
          .onChange(async (value) => {
            const pageStart = parseInt(value);
            if (!isNaN(pageStart) && pageStart > 0) {
              this.plugin.settings.pageStart = pageStart;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('End Page')
      .setDesc('Last page to process (0 = all)')
      .addText((text) =>
        text
          .setPlaceholder('0')
          .setValue(String(this.plugin.settings.pageEnd))
          .onChange(async (value) => {
            const pageEnd = parseInt(value);
            if (!isNaN(pageEnd) && pageEnd >= 0) {
              this.plugin.settings.pageEnd = pageEnd;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('Batch Size')
      .setDesc('Pages per processing batch')
      .addSlider((slider) =>
        slider
          .setLimits(1, 5, 1)
          .setValue(this.plugin.settings.batchSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.batchSize = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Render Scale')
      .setDesc('PDF to image quality (1.0 - 3.0)')
      .addSlider((slider) =>
        slider
          .setLimits(1.0, 3.0, 0.1)
          .setValue(this.plugin.settings.renderScale)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.renderScale = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Image Quality')
      .setDesc('JPEG quality (0.5 - 1.0)')
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 1.0, 0.05)
          .setValue(this.plugin.settings.imageQuality)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.imageQuality = value;
            await this.plugin.saveSettings();
          })
      );

    // === CONTENT PROCESSING ===
    containerEl.createEl('h2', { text: '✏️ Content Processing' });

    new Setting(containerEl)
      .setName('Default Content Mode')
      .setDesc('How to process PDF content')
      .addDropdown((dropdown) => {
        dropdown.addOption('mixed', 'Mixed (Text & Diagrams)');
        dropdown.addOption('text', 'Text Only');
        dropdown.addOption('diagram', 'Diagrams Only');
        dropdown.addOption('audio-sync', 'Audio-Sync (With Timestamps)');
        dropdown.setValue(this.plugin.settings.contentMode);
        dropdown.onChange(async (value) => {
          this.plugin.settings.contentMode = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName('Text Transcription Prompt')
      .setDesc('Customize text transcription')
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.defaultTextPrompt)
          .onChange(async (value) => {
            this.plugin.settings.defaultTextPrompt = value;
            await this.plugin.saveSettings();
          })
      );

    // === AUDIO SETTINGS ===
    containerEl.createEl('h2', { text: '🎵 Audio Settings' });

    new Setting(containerEl)
      .setName('Extract Embedded Audio')
      .setDesc('Automatically extract audio from PDFs')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.extractAudio)
          .onChange(async (value) => {
            this.plugin.settings.extractAudio = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Audio Output Folder')
      .setDesc('Where to save extracted audio')
      .addText((text) =>
        text
          .setPlaceholder('Audio')
          .setValue(this.plugin.settings.audioFolder)
          .onChange(async (value) => {
            this.plugin.settings.audioFolder = value || 'Audio';
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Auto Extract Before Transcription')
      .setDesc('Extract audio when starting transcription')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoExtractBeforeTranscription)
          .onChange(async (value) => {
            this.plugin.settings.autoExtractBeforeTranscription = value;
            await this.plugin.saveSettings();
          })
      );

    // === ABOUT ===
    containerEl.createEl('h3', { text: 'About' });
    containerEl.createEl('p', {
      text: 'PDF Transcriber v1.0.0 - Transcribe handwritten notes from PDFs with audio extraction.',
    });
  }
}
