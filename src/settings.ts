import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
// import { remoteJsonRequest } from './utils/http';

export interface StoredModelInfo {
  id: string;
  displayName: string;
  supportsVision: boolean;
  recommended?: boolean;
  tested?: boolean;
  testStatus?: 'passed' | 'failed' | 'untested';
  score?: number;
  reason?: string;
  provider?: string;
}

export interface PluginSettings {
  activeProvider: 'openai' | 'ollama';
  enableOllama: boolean;

  apiKey: string;
  selectedModel: string;
  availableModels: StoredModelInfo[];

  ollamaBaseUrl: string;
  ollamaSelectedModel: string;
  ollamaAvailableModels: StoredModelInfo[];

  // ===== PDF PROCESSING SETTINGS (unchanged from original) =====
  defaultPdfFolder: string;
  maxPages: number;
  pageStart: number;
  pageEnd: number;
  batchSize: number;
  renderScale: number;
  imageQuality: number;

  // ===== PROMPT SETTINGS (unchanged from original) =====
  defaultTextPrompt: string;
  defaultDiagramPrompt: string;
  defaultMixedPrompt: string;
  detectDiagrams: boolean;
  useMermaid: boolean;
  contentMode: 'text' | 'diagram' | 'mixed';

  providerConnectionStatus: Record<string, 'unknown' | 'passed' | 'failed'>;
  providerConnectionMessage: Record<string, string>;
  providerModelProbeStatus: Record<string, 'unknown' | 'running' | 'complete' | 'failed'>;
  recommendedModels: Record<string, string>;
  ollamaRecommendedDownload: null | { id: string; reason: string };
}

export const DEFAULT_SETTINGS: PluginSettings = {
  activeProvider: 'openai',
  enableOllama: false,

  apiKey: '',
  selectedModel: 'gpt-4.1',
  availableModels: [
    { id: 'gpt-4.1', displayName: 'gpt-4.1', supportsVision: true, provider: 'openai', recommended: true, testStatus: 'untested', score: 100 },
    { id: 'gpt-4o', displayName: 'gpt-4o', supportsVision: true, provider: 'openai', recommended: false, testStatus: 'untested', score: 90 },
    { id: 'gpt-4-turbo', displayName: 'gpt-4-turbo', supportsVision: true, provider: 'openai', recommended: false, testStatus: 'untested', score: 75 }
  ],

  ollamaBaseUrl: 'http://localhost:11434',
  ollamaSelectedModel: 'llava',
  ollamaAvailableModels: [
    { id: 'llava', displayName: 'llava', supportsVision: true, provider: 'ollama', recommended: true, testStatus: 'untested', score: 100 },
    { id: 'llava:13b', displayName: 'llava:13b', supportsVision: true, provider: 'ollama', recommended: false, testStatus: 'untested', score: 95 },
    { id: 'bakllava', displayName: 'bakllava', supportsVision: true, provider: 'ollama', recommended: false, testStatus: 'untested', score: 85 }
  ],

  // PDF processing — preserve original defaults exactly
  defaultPdfFolder: '',
  maxPages: 50,
  pageStart: 1,
  pageEnd: 0,
  batchSize: 1,
  renderScale: 2.0,
  imageQuality: 0.9,

  // Prompts — preserve original defaults exactly
  defaultTextPrompt: `You are a precise handwriting transcription assistant. Your ONLY task is to transcribe the exact handwritten text visible in this image.

STRICT RULES:
- Transcribe ONLY what is physically written — do not add, infer, complete, or embellish
- If a word is illegible, write [illegible] rather than guessing
- Preserve the original line breaks and paragraph structure
- Do not describe the image, paper, pen, or writing style
- Do not add headings, summaries, or commentary
- If the page is blank or has no handwriting, reply only with: [No handwritten content detected]

Begin transcription now:`,

  defaultDiagramPrompt: `You are a diagram analysis assistant. Convert the diagram or drawing in this image into Mermaid syntax.

STRICT RULES:
- Only describe what is visibly present in the diagram — do not add nodes, arrows, or labels that are not shown
- Use the correct Mermaid diagram type: flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, or mindmap
- If labels are handwritten and illegible, use [illegible] as the label text
- Do not describe the drawing style or medium
- If no diagram is present, reply only with: [No diagram detected]

Output Mermaid syntax now:`,

  defaultMixedPrompt: `You are a precise document transcription assistant. This image may contain handwritten text, diagrams, or both.

STRICT RULES:
- Transcribe ALL handwritten text exactly as written — do not add, infer, complete, or embellish
- If a word is illegible, write [illegible]
- Convert any diagrams or drawings to Mermaid syntax, wrapped in triple backticks with the mermaid label
- Do not describe the page, paper, or writing instrument
- Preserve the logical reading order and spatial layout
- If the page is blank, reply only with: [No content detected]

Process this document now:`,

  detectDiagrams: true,
  useMermaid: true,
  contentMode: 'mixed',

  providerConnectionStatus: {
    openai: 'unknown',
    ollama: 'unknown'
  },
  providerConnectionMessage: {
    openai: '',
    ollama: ''
  },
  providerModelProbeStatus: {
    openai: 'unknown',
    ollama: 'unknown'
  },
  recommendedModels: {
    openai: 'gpt-4.1',
    ollama: 'llava'
  },
  ollamaRecommendedDownload: null
};

export class PDFTranscriberSettingTab extends PluginSettingTab {
  plugin: any;

  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // === Section 1: Provider Selection (NEW) ===
    containerEl.createEl('h2', { text: '🌐 Provider Settings' });

    new Setting(containerEl)
      .setName('Active Provider')
      .setDesc('Select which AI provider to use for transcription.')
      .addDropdown((dropdown) => {
        dropdown.addOption('openai', 'OpenAI');
        if (this.plugin.settings.enableOllama) {
          dropdown.addOption('ollama', 'Ollama (Local)');
        }
        dropdown.setValue(this.plugin.settings.activeProvider)
          .onChange(async (value: string) => {
            this.plugin.settings.activeProvider = value;
            await this.plugin.saveSettings();
            this.display(); // re-render to show/hide provider specific settings
          });
      });

    new Setting(containerEl)
      .setName('Enable Local Ollama Provider')
      .setDesc('Toggle to enable local transcription using Ollama.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableOllama)
          .onChange(async (value) => {
            this.plugin.settings.enableOllama = value;
            if (!value && this.plugin.settings.activeProvider === 'ollama') {
              this.plugin.settings.activeProvider = 'openai';
            }
            await this.plugin.saveSettings();
            this.display(); // re-render conditional sections
          })
      );

    // Conditional block for Ollama settings
    if (this.plugin.settings.activeProvider === 'ollama' && this.plugin.settings.enableOllama) {
      containerEl.createEl('h3', { text: '🦙 Ollama Configuration' });

      new Setting(containerEl)
        .setName('Ollama Base URL')
        .setDesc('The URL where your local Ollama instance is running.')
        .addText((text) =>
          text
            .setPlaceholder('http://localhost:11434')
            .setValue(this.plugin.settings.ollamaBaseUrl)
            .onChange(async (value) => {
              this.plugin.settings.ollamaBaseUrl = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Ollama Model')
        .setDesc('Select an installed vision-capable Ollama model.')
        .addDropdown((dropdown) => {
          this.plugin.settings.ollamaAvailableModels.forEach((model: StoredModelInfo) => {
            let label = model.displayName;
            if (model.recommended) label += ' — Recommended';
            else if (model.testStatus === 'passed') label += ' — Compatible';
            else if (model.testStatus === 'failed') label += ' — Failed probe';

            dropdown.addOption(model.id, label);
          });
          dropdown.setValue(this.plugin.settings.ollamaSelectedModel)
            .onChange(async (value) => {
              this.plugin.settings.ollamaSelectedModel = value;
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName('Test Connection')
        .setDesc('Verify that Obsidian can connect to your local Ollama instance.')
        .addButton((button) =>
          button.setButtonText('Test Connection').onClick(async () => {
            await this.plugin.testProviderConnection('ollama');
            this.display();
          })
        );

      new Setting(containerEl)
        .setName('Refresh & Recommend')
        .setDesc('Fetch installed vision models from your Ollama instance and test their compatibility.')
        .addButton((button) =>
          button.setButtonText('Refresh & Recommend').onClick(async () => {
            const ok = await this.plugin.testProviderConnection('ollama');
            if (ok) {
              await this.plugin.refreshAndRecommendModels('ollama');
            }
            this.display();
          })
        );

      if (this.plugin.settings.providerConnectionMessage.ollama) {
        containerEl.createEl('p', {
          text: `Status: ${this.plugin.settings.providerConnectionMessage.ollama}`,
          cls: 'setting-item-description'
        });
      }
      if (this.plugin.settings.providerModelProbeStatus.ollama !== 'unknown') {
        containerEl.createEl('p', {
          text: `Probe Status: ${this.plugin.settings.providerModelProbeStatus.ollama}`,
          cls: 'setting-item-description'
        });
      }

      const betterModel = this.plugin.settings.ollamaRecommendedDownload;
      if (betterModel) {
        const downloadEl = containerEl.createEl('div');
        downloadEl.style.padding = '10px';
        downloadEl.style.marginTop = '8px';
        downloadEl.style.backgroundColor = 'var(--background-secondary)';
        downloadEl.style.borderRadius = '6px';
        downloadEl.style.border = '1px solid var(--background-modifier-border)';

        downloadEl.createEl('p', {
          text: `💡 Better model available: ${betterModel.id} — ${betterModel.reason}`
        });

        const dlButton = downloadEl.createEl('button', { text: `⬇️ Download ${betterModel.id}` });
        dlButton.addEventListener('click', async () => {
          await this.plugin.pullOllamaModel(betterModel.id);
          this.display();
        });
      }
    }

    // === Section 2: API Settings ===
    if (this.plugin.settings.activeProvider === 'openai') {
      containerEl.createEl('h3', { text: '🤖 OpenAI Configuration' });

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
        .setName('OpenAI Model')
        .setDesc('Select the model to use for transcription.')
        .addDropdown((dropdown) => {
          this.plugin.settings.availableModels.forEach((model: StoredModelInfo) => {
            let label = model.displayName;
            if (model.recommended) label += ' — Recommended';
            else if (model.testStatus === 'passed') label += ' — Compatible';
            else if (model.testStatus === 'failed') label += ' — Failed probe';

            dropdown.addOption(model.id, label);
          });
          dropdown.setValue(this.plugin.settings.selectedModel)
            .onChange(async (value) => {
              this.plugin.settings.selectedModel = value;
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName('Test Connection')
        .setDesc('Verify that Obsidian can connect to OpenAI.')
        .addButton((button) =>
          button.setButtonText('Test Connection').onClick(async () => {
            await this.plugin.testProviderConnection('openai');
            this.display();
          })
        );

      new Setting(containerEl)
        .setName('Refresh & Recommend Models')
        .setDesc('Fetch the latest available models from OpenAI and recommend the best compatible model.')
        .addButton((button) =>
          button.setButtonText('Refresh & Recommend').onClick(async () => {
            if (!this.plugin.settings.apiKey) {
              new Notice('Please enter an API key first');
              return;
            }
            const ok = await this.plugin.testProviderConnection('openai');
            if (ok) {
              await this.plugin.refreshAndRecommendModels('openai');
            }
            this.display();
          })
        );

      if (this.plugin.settings.providerConnectionMessage.openai) {
        containerEl.createEl('p', {
          text: `Status: ${this.plugin.settings.providerConnectionMessage.openai}`,
          cls: 'setting-item-description'
        });
      }
      if (this.plugin.settings.providerModelProbeStatus.openai !== 'unknown') {
        containerEl.createEl('p', {
          text: `Probe Status: ${this.plugin.settings.providerModelProbeStatus.openai}`,
          cls: 'setting-item-description'
        });
      }
    }

    // === Section 3: PDF Processing ===
    containerEl.createEl('h2', { text: '📄 PDF Processing' });

    new Setting(containerEl)
      .setName('Default PDF Folder')
      .setDesc('Default folder to look for PDFs (e.g., "Attachments/PDFs"). Leave blank for vault root.')
      .addText((text) =>
        text
          .setPlaceholder('Attachments')
          .setValue(this.plugin.settings.defaultPdfFolder)
          .onChange(async (value) => {
            this.plugin.settings.defaultPdfFolder = value;
            await this.plugin.saveSettings();
          })
      );

    // === Section 4: Content Settings ===
    containerEl.createEl('h2', { text: '📝 Content Settings' });

    new Setting(containerEl)
      .setName('Default Content Mode')
      .setDesc('Choose what the AI should focus on extracting by default.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('mixed', 'Mixed (Text & Diagrams)')
          .addOption('text', 'Text Only')
          .addOption('diagram', 'Diagrams Only')
          .setValue(this.plugin.settings.contentMode)
          .onChange(async (value: string) => {
            this.plugin.settings.contentMode = value;
            await this.plugin.saveSettings();
          })
      );

    // === Section 5: Prompts ===
    containerEl.createEl('h2', { text: '💬 Prompts' });

    new Setting(containerEl)
      .setName('Default Text Prompt')
      .setDesc('Prompt used when extracting handwritten text.')
      .addTextArea((text) =>
        text
          .setPlaceholder('Enter instructions for text transcription')
          .setValue(this.plugin.settings.defaultTextPrompt)
          .onChange(async (value) => {
            this.plugin.settings.defaultTextPrompt = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Default Diagram Prompt')
      .setDesc('Prompt used when converting drawings to Mermaid diagrams.')
      .addTextArea((text) =>
        text
          .setPlaceholder('Enter instructions for diagram conversion')
          .setValue(this.plugin.settings.defaultDiagramPrompt)
          .onChange(async (value) => {
            this.plugin.settings.defaultDiagramPrompt = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Default Mixed Prompt')
      .setDesc('Prompt used when extracting both text and diagrams.')
      .addTextArea((text) =>
        text
          .setPlaceholder('Enter instructions for mixed content extraction')
          .setValue(this.plugin.settings.defaultMixedPrompt)
          .onChange(async (value) => {
            this.plugin.settings.defaultMixedPrompt = value;
            await this.plugin.saveSettings();
          })
      );

    // === Section 7: Advanced Options ===
    containerEl.createEl('h2', { text: '⚙️ Advanced Options' });

    new Setting(containerEl)
      .setName('Batch Size')
      .setDesc('Number of pages to process before pausing. Higher values use more memory.')
      .addText((text) =>
        text
          .setPlaceholder('1')
          .setValue(String(this.plugin.settings.batchSize))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0) {
              this.plugin.settings.batchSize = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('Render Scale')
      .setDesc('Scale factor for PDF rendering. Higher = better quality but larger image size (max 4.0).')
      .addText((text) =>
        text
          .setPlaceholder('2.0')
          .setValue(String(this.plugin.settings.renderScale))
          .onChange(async (value) => {
            const parsed = parseFloat(value);
            if (!isNaN(parsed) && parsed > 0 && parsed <= 4.0) {
              this.plugin.settings.renderScale = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('Image Quality')
      .setDesc('JPEG quality for the uploaded image (0.1 to 1.0). Higher = better quality but larger file size.')
      .addText((text) =>
        text
          .setPlaceholder('0.9')
          .setValue(String(this.plugin.settings.imageQuality))
          .onChange(async (value) => {
            const parsed = parseFloat(value);
            if (!isNaN(parsed) && parsed > 0 && parsed <= 1.0) {
              this.plugin.settings.imageQuality = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('Max Pages (Fallback)')
      .setDesc('Maximum number of pages to process if no range is specified.')
      .addText((text) =>
        text
          .setPlaceholder('50')
          .setValue(String(this.plugin.settings.maxPages))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0) {
              this.plugin.settings.maxPages = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('Legacy Diagram Detection')
      .setDesc('Use the legacy two-pass system: first asking the AI if a diagram exists, then transcribing. Often slower and less reliable than the Mixed Prompt approach.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.detectDiagrams)
          .onChange(async (value) => {
            this.plugin.settings.detectDiagrams = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
