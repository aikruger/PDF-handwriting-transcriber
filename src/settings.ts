import { PluginSettings, ProviderProfile } from './models/types';
import { App, PluginSettingTab, Setting } from 'obsidian';
import type PDFTranscriberPlugin from './main';

export const DEFAULT_SETTINGS: PluginSettings = {
      version: 2,
      profiles: [
        { id: 'profile-openai', adapterId: 'openai', displayName: 'OpenAI', enabled: true, credentialRef: '', selectedModels: { handwriting: 'gpt-4o', diagram: 'gpt-4o', mixed: 'gpt-4o' }, options: {} },
        { id: 'profile-ollama', adapterId: 'ollama', displayName: 'Ollama (Local)', enabled: false, baseUrl: 'http://localhost:11434', selectedModels: { handwriting: 'llava', diagram: 'llava', mixed: 'llava' }, options: {} },
        { id: 'profile-openrouter', adapterId: 'openrouter', displayName: 'OpenRouter', enabled: false, credentialRef: '', selectedModels: { handwriting: '', diagram: '', mixed: '' }, options: { requireDataPrivacy: true, allowUpstreamFallback: false, allowedUpstreamProviders: [] } }
      ],
      activeProfileId: 'profile-openai',
      taskDefaults: {
        handwriting: { profileId: 'profile-openai', modelId: 'gpt-4o' },
        diagram: { profileId: 'profile-openai', modelId: 'gpt-4o' },
        mixed: { profileId: 'profile-openai', modelId: 'gpt-4o' }
      },
      defaultPdfFolder: '', maxPages: 50, pageStart: 1, pageEnd: 0, batchSize: 1, renderScale: 2.0, imageQuality: 0.9,
      defaultTextPrompt: `You are a precise handwriting transcription assistant. Your ONLY task is to transcribe the exact handwritten text visible in this image.\n\nSTRICT RULES:\n- Transcribe ONLY what is physically written — do not add, infer, complete, or embellish\n- If a word is illegible, write [illegible] rather than guessing\n- Preserve the original line breaks and paragraph structure\n- Do not describe the image, paper, pen, or writing style\n- Do not add headings, summaries, or commentary\n- If the page is blank or has no handwriting, reply only with: [No handwritten content detected]\n\nBegin transcription now:`,
      defaultDiagramPrompt: `You are a diagram analysis assistant. Convert the diagram or drawing in this image into Mermaid syntax.\n\nSTRICT RULES:\n- Only describe what is visibly present in the diagram — do not add nodes, arrows, or labels that are not shown\n- Use the correct Mermaid diagram type: flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, or mindmap\n- If labels are handwritten and illegible, use [illegible] as the label text\n- Do not describe the drawing style or medium\n- If no diagram is present, reply only with: [No diagram detected]\n\nOutput Mermaid syntax now:`,
      defaultMixedPrompt: `You are a precise document transcription assistant. This image may contain handwritten text, diagrams, or both.\n\nSTRICT RULES:\n- Transcribe ALL handwritten text exactly as written — do not add, infer, complete, or embellish\n- If a word is illegible, write [illegible]\n- Convert any diagrams or drawings to Mermaid syntax, wrapped in triple backticks with the mermaid label\n- Do not describe the page, paper, or writing instrument\n- Preserve the logical reading order and spatial layout\n- If the page is blank, reply only with: [No content detected]\n\nProcess this document now:`,
      detectDiagrams: true, useMermaid: true, contentMode: 'mixed'
  };

export function migrateSettings(raw: unknown): PluginSettings {
  if (!raw || typeof raw !== 'object') return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const data = raw as any;

  if (data.version === 2) {
     const settings = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), data);
     // Recover from hybrid states
     const openAIProfile = settings.profiles.find((p: any) => p.id === 'profile-openai');
     if (openAIProfile && !openAIProfile.credentialRef && data.legacyApiKey) openAIProfile.credentialRef = data.legacyApiKey;

     const ollamaProfile = settings.profiles.find((p: any) => p.id === 'profile-ollama');
     if (ollamaProfile && !ollamaProfile.baseUrl && data.ollamaBaseUrl) ollamaProfile.baseUrl = data.ollamaBaseUrl;
     if (ollamaProfile && !ollamaProfile.enabled && data.enableOllama !== undefined) ollamaProfile.enabled = data.enableOllama;
     return settings;
  }

  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

  if (data.defaultPdfFolder !== undefined) settings.defaultPdfFolder = data.defaultPdfFolder;
  if (data.maxPages !== undefined) settings.maxPages = data.maxPages;
  if (data.pageStart !== undefined) settings.pageStart = data.pageStart;
  if (data.pageEnd !== undefined) settings.pageEnd = data.pageEnd;
  if (data.batchSize !== undefined) settings.batchSize = data.batchSize;
  if (data.renderScale !== undefined) settings.renderScale = data.renderScale;
  if (data.imageQuality !== undefined) settings.imageQuality = data.imageQuality;
  if (data.defaultTextPrompt !== undefined) settings.defaultTextPrompt = data.defaultTextPrompt;
  if (data.defaultDiagramPrompt !== undefined) settings.defaultDiagramPrompt = data.defaultDiagramPrompt;
  if (data.defaultMixedPrompt !== undefined) settings.defaultMixedPrompt = data.defaultMixedPrompt;
  if (data.detectDiagrams !== undefined) settings.detectDiagrams = data.detectDiagrams;
  if (data.useMermaid !== undefined) settings.useMermaid = data.useMermaid;
  if (data.contentMode !== undefined) settings.contentMode = data.contentMode;

  const openAIProfile = settings.profiles.find((p: any) => p.id === 'profile-openai');
  let openAIModel = 'gpt-4o';
  if (data.apiKey) openAIProfile.credentialRef = data.apiKey;
  if (data.selectedModel) { openAIModel = data.selectedModel; openAIProfile.selectedModels = { handwriting: data.selectedModel, diagram: data.selectedModel, mixed: data.selectedModel }; }

  const ollamaProfile = settings.profiles.find((p: any) => p.id === 'profile-ollama');
  let ollamaModel = 'llava';
  if (data.ollamaBaseUrl) ollamaProfile.baseUrl = data.ollamaBaseUrl;
  if (data.enableOllama !== undefined) ollamaProfile.enabled = data.enableOllama;
  if (data.ollamaSelectedModel) { ollamaModel = data.ollamaSelectedModel; ollamaProfile.selectedModels = { handwriting: data.ollamaSelectedModel, diagram: data.ollamaSelectedModel, mixed: data.ollamaSelectedModel }; }

  if (data.activeProvider === 'ollama' && data.enableOllama) {
    settings.activeProfileId = 'profile-ollama';
    settings.taskDefaults = { handwriting: { profileId: 'profile-ollama', modelId: ollamaModel }, diagram: { profileId: 'profile-ollama', modelId: ollamaModel }, mixed: { profileId: 'profile-ollama', modelId: ollamaModel } };
  } else {
    settings.activeProfileId = 'profile-openai';
    settings.taskDefaults = { handwriting: { profileId: 'profile-openai', modelId: openAIModel }, diagram: { profileId: 'profile-openai', modelId: openAIModel }, mixed: { profileId: 'profile-openai', modelId: openAIModel } };
  }
  return settings;
}

export class PDFTranscriberSettingTab extends PluginSettingTab {
  plugin: PDFTranscriberPlugin;
  private editingProfileId: string;
  constructor(app: App, plugin: PDFTranscriberPlugin) { super(app, plugin); this.plugin = plugin; this.editingProfileId = this.plugin.settings.activeProfileId; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '🌐 Provider Settings' });

    new Setting(containerEl)
      .setName('Global Active Provider')
      .setDesc('Select which AI provider is the default for transcription jobs.')
      .addDropdown((dropdown) => {
        this.plugin.settings.profiles.forEach((p: ProviderProfile) => {
             dropdown.addOption(p.id, p.enabled ? p.displayName : p.displayName + ' — disabled');
        });
        dropdown.setValue(this.plugin.settings.activeProfileId)
          .onChange(async (value: string) => {
            this.plugin.settings.activeProfileId = value;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    containerEl.createEl('br');

    new Setting(containerEl)
      .setName('Configure Profile')
      .setDesc('Select a profile below to edit its configuration or enable/disable it.')
      .addDropdown((dropdown) => {
        this.plugin.settings.profiles.forEach((p: ProviderProfile) => {
             dropdown.addOption(p.id, p.enabled ? p.displayName : p.displayName + ' (disabled)');
        });
        dropdown.setValue(this.editingProfileId)
          .onChange(async (value: string) => {
            this.editingProfileId = value;
            this.display();
          });
      });

    const activeProfile = this.plugin.settings.profiles.find((p: ProviderProfile) => p.id === this.editingProfileId);

    if (activeProfile) {
       // Profile controls rendered below.
       new Setting(containerEl)
            .setName(`Enable ${activeProfile.displayName}`)
            .addToggle((toggle) =>
                toggle.setValue(activeProfile.enabled)
                .onChange(async (value) => {
                    activeProfile.enabled = value;
                    if (!value && this.plugin.settings.activeProfileId === activeProfile.id) {
                         this.plugin.settings.activeProfileId = 'profile-openai';
                    }
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

      if (activeProfile.adapterId === 'openai') {
        containerEl.createEl('h3', { text: '🤖 OpenAI Configuration' });
        new Setting(containerEl).setName('OpenAI API Key').addText((text) => text.setPlaceholder('sk-...').setValue(activeProfile.credentialRef || '').onChange(async (value) => { activeProfile.credentialRef = value; await this.plugin.saveSettings(); }));
        this.addModelControls(containerEl, activeProfile);
        this.addProfileActions(containerEl, activeProfile);
      } else if (activeProfile.adapterId === 'ollama') {
         containerEl.createEl('h3', { text: '🦙 Ollama Configuration' });
         new Setting(containerEl).setName('Ollama Base URL').addText((text) => text.setPlaceholder('http://localhost:11434').setValue(activeProfile.baseUrl || 'http://localhost:11434').onChange(async (value) => { activeProfile.baseUrl = value; await this.plugin.saveSettings(); }));
         this.addModelControls(containerEl, activeProfile);
         this.addProfileActions(containerEl, activeProfile);
      } else if (activeProfile.adapterId === 'openrouter') {
          containerEl.createEl('h3', { text: '🔄 OpenRouter Configuration' });
          new Setting(containerEl).setName('OpenRouter API Key').addText((text) => text.setPlaceholder('sk-or-v1-...').setValue(activeProfile.credentialRef || '').onChange(async (value) => { activeProfile.credentialRef = value; await this.plugin.saveSettings(); }));
          new Setting(containerEl).setName('Require Data Privacy').addToggle((toggle) => toggle.setValue(activeProfile.options?.requireDataPrivacy as boolean ?? true).onChange(async (value) => { if(!activeProfile.options) activeProfile.options = {}; activeProfile.options.requireDataPrivacy = value; await this.plugin.saveSettings(); }));
          new Setting(containerEl).setName('Allow Upstream Fallback').addToggle((toggle) => toggle.setValue(activeProfile.options?.allowUpstreamFallback as boolean ?? false).onChange(async (value) => { if(!activeProfile.options) activeProfile.options = {}; activeProfile.options.allowUpstreamFallback = value; await this.plugin.saveSettings(); }));
          this.addModelControls(containerEl, activeProfile);
          this.addProfileActions(containerEl, activeProfile);
      }
    }

    containerEl.createEl('h2', { text: '📄 PDF Processing' });
    new Setting(containerEl).setName('Default PDF Folder').addText((text) => text.setPlaceholder('Attachments').setValue(this.plugin.settings.defaultPdfFolder).onChange(async (value) => { this.plugin.settings.defaultPdfFolder = value; await this.plugin.saveSettings(); }));
    containerEl.createEl('h2', { text: '📝 Content Settings' });
    new Setting(containerEl).setName('Default Content Mode').addDropdown((dropdown) => dropdown.addOption('mixed', 'Mixed (Text & Diagrams)').addOption('text', 'Text Only').addOption('diagram', 'Diagrams Only').setValue(this.plugin.settings.contentMode).onChange(async (value: string) => { this.plugin.settings.contentMode = value as any; await this.plugin.saveSettings(); }));
    containerEl.createEl('h2', { text: '💬 Prompts' });
    new Setting(containerEl).setName('Default Text Prompt').addTextArea((text) => text.setPlaceholder('Enter instructions...').setValue(this.plugin.settings.defaultTextPrompt).onChange(async (value) => { this.plugin.settings.defaultTextPrompt = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Default Diagram Prompt').addTextArea((text) => text.setPlaceholder('Enter instructions...').setValue(this.plugin.settings.defaultDiagramPrompt).onChange(async (value) => { this.plugin.settings.defaultDiagramPrompt = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Default Mixed Prompt').addTextArea((text) => text.setPlaceholder('Enter instructions...').setValue(this.plugin.settings.defaultMixedPrompt).onChange(async (value) => { this.plugin.settings.defaultMixedPrompt = value; await this.plugin.saveSettings(); }));
    containerEl.createEl('h2', { text: '⚙️ Advanced Options' });
    new Setting(containerEl).setName('Batch Size').addText((text) => text.setPlaceholder('1').setValue(String(this.plugin.settings.batchSize)).onChange(async (value) => { const parsed = parseInt(value, 10); if (!isNaN(parsed) && parsed > 0) { this.plugin.settings.batchSize = parsed; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName('Render Scale').addText((text) => text.setPlaceholder('2.0').setValue(String(this.plugin.settings.renderScale)).onChange(async (value) => { const parsed = parseFloat(value); if (!isNaN(parsed) && parsed > 0 && parsed <= 4.0) { this.plugin.settings.renderScale = parsed; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName('Image Quality').addText((text) => text.setPlaceholder('0.9').setValue(String(this.plugin.settings.imageQuality)).onChange(async (value) => { const parsed = parseFloat(value); if (!isNaN(parsed) && parsed > 0 && parsed <= 1.0) { this.plugin.settings.imageQuality = parsed; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName('Max Pages (Fallback)').addText((text) => text.setPlaceholder('50').setValue(String(this.plugin.settings.maxPages)).onChange(async (value) => { const parsed = parseInt(value, 10); if (!isNaN(parsed) && parsed > 0) { this.plugin.settings.maxPages = parsed; await this.plugin.saveSettings(); } }));
  }

  private addModelControls(containerEl: HTMLElement, activeProfile: ProviderProfile) {
    const createModelSelector = (task: 'handwriting' | 'diagram' | 'mixed', label: string) => {
        new Setting(containerEl).setName(`${label} Model`).addDropdown((dropdown) => {
             const discovered = activeProfile.options?.discoveredModels as any[];
             if (discovered && discovered.length > 0) { discovered.forEach(m => dropdown.addOption(m.id, m.displayName)); }
             else if (activeProfile.selectedModels && activeProfile.selectedModels[task]) { dropdown.addOption(activeProfile.selectedModels[task] as string, activeProfile.selectedModels[task] as string); }
             dropdown.setValue((activeProfile.selectedModels && activeProfile.selectedModels[task]) || '');
             dropdown.onChange(async (val) => {
                 if (!activeProfile.selectedModels) activeProfile.selectedModels = {};
                 activeProfile.selectedModels[task] = val;
                 if (this.plugin.settings.activeProfileId === activeProfile.id) {
                     if (!this.plugin.settings.taskDefaults) this.plugin.settings.taskDefaults = {};
                     this.plugin.settings.taskDefaults[task] = { profileId: activeProfile.id, modelId: val };
                 }
                 await this.plugin.saveSettings();
             });
          });
    };
    createModelSelector('handwriting', 'Handwriting');
    createModelSelector('diagram', 'Diagram');
    createModelSelector('mixed', 'Mixed');
  }

  private addProfileActions(containerEl: HTMLElement, activeProfile: ProviderProfile) {
        new Setting(containerEl).setName('Test Connection').addButton((button) => button.setButtonText('Test Connection').onClick(async () => { await this.plugin.testProviderConnection(activeProfile.id); this.display(); }));
        new Setting(containerEl).setName('Refresh Catalogue').addButton((button) => button.setButtonText('Refresh Models').onClick(async () => { await this.plugin.refreshProviderModels(activeProfile.id); this.display(); }));
  }
}