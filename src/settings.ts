import { App, PluginSettingTab, Setting, Notice } from 'obsidian';

export interface PluginSettings {
  // ===== PROVIDER SETTINGS (NEW) =====
  activeProvider: 'openai' | 'ollama';  // Which provider is active
  enableOllama: boolean;                 // Feature flag — false by default, hides Ollama from UI

  // ===== OPENAI SETTINGS (unchanged from original) =====
  apiKey: string;
  selectedModel: string;
  availableModels: string[];

  // ===== OLLAMA SETTINGS (NEW) =====
  ollamaBaseUrl: string;
  ollamaSelectedModel: string;
  ollamaAvailableModels: string[];

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
}

export const DEFAULT_SETTINGS: PluginSettings = {
  // Provider
  activeProvider: 'openai',
  enableOllama: false,

  // OpenAI — preserve original defaults exactly
  apiKey: '',
  selectedModel: 'gpt-4-vision',
  availableModels: ['gpt-4-vision', 'gpt-4o', 'gpt-4-turbo'],

  // Ollama
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaSelectedModel: 'llava',
  ollamaAvailableModels: ['llava', 'llava:13b', 'bakllava'],

  // PDF processing — preserve original defaults exactly
  defaultPdfFolder: '',
  maxPages: 50,
  pageStart: 1,
  pageEnd: 0,
  batchSize: 1,
  renderScale: 2.0,
  imageQuality: 0.9,

  // Prompts — preserve original defaults exactly
  defaultTextPrompt: "Please transcribe all handwritten text from this image. Format it cleanly with proper paragraphs, lists, and line breaks as they appear in the original.",
  defaultDiagramPrompt: "This image contains a diagram or drawing. Please analyze it carefully and convert it to a mermaid diagram. Use the appropriate mermaid syntax based on the type of diagram (flowchart, sequence diagram, etc.). Focus on capturing the structure, relationships, and any text labels.",
  defaultMixedPrompt: "This image may contain both handwritten text and diagrams/drawings. Please:\n\n1. Transcribe all handwritten text accurately, maintaining paragraphs and formatting.\n\n2. For any diagrams or drawings, convert them to mermaid syntax. Wrap the mermaid code in triple backticks with 'mermaid' label.\n\nEnsure you maintain the logical flow of the document, placing the mermaid diagrams in the appropriate locations relative to the text.",
  detectDiagrams: true,
  useMermaid: true,
  contentMode: 'mixed'
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
          this.plugin.settings.ollamaAvailableModels.forEach((model: string) => {
            dropdown.addOption(model, model);
          });
          dropdown.setValue(this.plugin.settings.ollamaSelectedModel)
            .onChange(async (value) => {
              this.plugin.settings.ollamaSelectedModel = value;
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName('Refresh Ollama Models')
        .setDesc('Fetch the list of installed vision models from your Ollama instance.')
        .addButton((button) =>
          button.setButtonText('Refresh Models').onClick(async () => {
            const success = await this.plugin.fetchAvailableModels();
            if (success) {
              new Notice('Ollama models refreshed successfully');
              this.display();
            }
          })
        );

      new Setting(containerEl)
        .setName('Test Connection')
        .setDesc('Verify that Obsidian can connect to your local Ollama instance.')
        .addButton((button) =>
          button.setButtonText('Test Connection').onClick(async () => {
            try {
              const response = await fetch(`${this.plugin.settings.ollamaBaseUrl}/api/tags`);
              if (response.ok) {
                new Notice('Successfully connected to Ollama!');
              } else {
                new Notice(`Connected to Ollama, but got error: ${response.status}`);
              }
            } catch (e: any) {
              new Notice(`Failed to connect to Ollama: ${e.message}`);
            }
          })
        );
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
          this.plugin.settings.availableModels.forEach((model: string) => {
            dropdown.addOption(model, model);
          });
          dropdown.setValue(this.plugin.settings.selectedModel)
            .onChange(async (value) => {
              this.plugin.settings.selectedModel = value;
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName('Refresh OpenAI Models')
        .setDesc('Fetch the latest available models from OpenAI.')
        .addButton((button) =>
          button.setButtonText('Refresh Models').onClick(async () => {
            if (!this.plugin.settings.apiKey) {
              new Notice('Please enter an API key first');
              return;
            }
            const success = await this.plugin.fetchAvailableModels();
            if (success) {
              new Notice('OpenAI models refreshed successfully');
              this.display();
            }
          })
        );
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
