import { PluginSettings } from './models/types';
export { PluginSettings };

import { App, PluginSettingTab, Setting } from 'obsidian';
import { ProviderProfile } from './models/types';
import { Logger } from './utils/logger';

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



const DEFAULT_PROFILES: ProviderProfile[] = [
  {
    id: 'profile-openai',
    adapterId: 'openai',
    displayName: 'OpenAI (Default)',
    enabled: true,
    credentialRef: '', // stores API key
    selectedModels: {
      handwriting: 'gpt-4o',
      diagram: 'gpt-4o',
      mixed: 'gpt-4o'
    },
    options: {}
  },
  {
    id: 'profile-ollama',
    adapterId: 'ollama',
    displayName: 'Ollama (Local)',
    enabled: false,
    baseUrl: 'http://localhost:11434',
    selectedModels: {
      handwriting: 'llava',
      diagram: 'llava',
      mixed: 'llava'
    },
    options: {}
  },
  {
    id: 'profile-openrouter',
    adapterId: 'openrouter',
    displayName: 'OpenRouter',
    enabled: false,
    credentialRef: '',
    selectedModels: {},
    options: {
        requireDataPrivacy: true,
        allowUpstreamFallback: false,
        allowedUpstreamProviders: []
    }
  }
];

export const DEFAULT_SETTINGS: PluginSettings = {
  version: 2, // Bumped to 2 for new schema
  profiles: JSON.parse(JSON.stringify(DEFAULT_PROFILES)),
  activeProfileId: 'profile-openai',

  taskDefaults: {
    handwriting: { profileId: 'profile-openai', modelId: 'gpt-4o' },
    diagram: { profileId: 'profile-openai', modelId: 'gpt-4o' },
    mixed: { profileId: 'profile-openai', modelId: 'gpt-4o' }
  },

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
};

// Migration Logic
export function migrateSettings(data: any): PluginSettings {
  if (!data) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

  const settings = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), data);

  if (!settings.version || settings.version < 2) {
    Logger.log('Migration', 'Migrating settings to version 2 schema');

    const profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES));

    // Migrate OpenAI
    const openAIProfile = profiles.find((p: any) => p.id === 'profile-openai');
    if (data.apiKey) openAIProfile.credentialRef = data.apiKey;
    if (data.selectedModel) {
      openAIProfile.selectedModels = {
        handwriting: data.selectedModel,
        diagram: data.selectedModel,
        mixed: data.selectedModel
      };
    }

    // Migrate Ollama
    const ollamaProfile = profiles.find((p: any) => p.id === 'profile-ollama');
    if (data.ollamaBaseUrl) ollamaProfile.baseUrl = data.ollamaBaseUrl;
    if (data.enableOllama) ollamaProfile.enabled = true;
    if (data.ollamaSelectedModel) {
      ollamaProfile.selectedModels = {
        handwriting: data.ollamaSelectedModel,
        diagram: data.ollamaSelectedModel,
        mixed: data.ollamaSelectedModel
      };
    }

    settings.profiles = profiles;

    // Set active profile based on legacy activeProvider
    if (data.activeProvider === 'ollama' && data.enableOllama) {
      settings.activeProfileId = 'profile-ollama';
    } else {
      settings.activeProfileId = 'profile-openai';
    }

    settings.version = 2;

    // Cleanup legacy fields if desired, or keep them around.
    delete settings.apiKey;
    delete settings.selectedModel;
    delete settings.availableModels;
    delete settings.ollamaBaseUrl;
    delete settings.ollamaSelectedModel;
    delete settings.ollamaAvailableModels;
    delete settings.activeProvider;
    delete settings.enableOllama;
    delete settings.providerConnectionStatus;
    delete settings.providerConnectionMessage;
    delete settings.providerModelProbeStatus;
    delete settings.recommendedModels;
    delete settings.ollamaRecommendedDownload;
  }

  return settings;
}

export class PDFTranscriberSettingTab extends PluginSettingTab {
  plugin: any;

  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '🌐 Provider Settings' });

    new Setting(containerEl)
      .setName('Active Provider')
      .setDesc('Select which AI provider to use for transcription.')
      .addDropdown((dropdown) => {
        this.plugin.settings.profiles.forEach((p: ProviderProfile) => {
            if(p.enabled || p.adapterId === 'openai' || p.adapterId === 'openrouter') {
                dropdown.addOption(p.id, p.displayName);
            }
        });
        dropdown.setValue(this.plugin.settings.activeProfileId)
          .onChange(async (value: string) => {
            this.plugin.settings.activeProfileId = value;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    const activeProfile = this.plugin.settings.profiles.find((p: ProviderProfile) => p.id === this.plugin.settings.activeProfileId);

    if (activeProfile) {
      if (activeProfile.adapterId === 'openai') {
        containerEl.createEl('h3', { text: '🤖 OpenAI Configuration' });
        new Setting(containerEl)
          .setName('OpenAI API Key')
          .setDesc('Get your key from https://platform.openai.com/api-keys')
          .addText((text) =>
            text
              .setPlaceholder('sk-...')
              .setValue(activeProfile.credentialRef || '')
              .onChange(async (value) => {
                activeProfile.credentialRef = value;
                await this.plugin.saveSettings();
              })
          );

          this.addProfileActions(containerEl, activeProfile);
      } else if (activeProfile.adapterId === 'ollama') {
         containerEl.createEl('h3', { text: '🦙 Ollama Configuration' });
         new Setting(containerEl)
            .setName('Enable Local Ollama Provider')
            .setDesc('Toggle to enable local transcription using Ollama.')
            .addToggle((toggle) =>
                toggle
                .setValue(activeProfile.enabled)
                .onChange(async (value) => {
                    activeProfile.enabled = value;
                    if (!value) {
                         this.plugin.settings.activeProfileId = 'profile-openai';
                    }
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

         new Setting(containerEl)
            .setName('Ollama Base URL')
            .setDesc('The URL where your local Ollama instance is running.')
            .addText((text) =>
              text
                .setPlaceholder('http://localhost:11434')
                .setValue(activeProfile.baseUrl || 'http://localhost:11434')
                .onChange(async (value) => {
                  activeProfile.baseUrl = value;
                  await this.plugin.saveSettings();
                })
            );

            this.addProfileActions(containerEl, activeProfile);
      } else if (activeProfile.adapterId === 'openrouter') {
          containerEl.createEl('h3', { text: '🔄 OpenRouter Configuration' });

          new Setting(containerEl)
            .setName('Enable OpenRouter Provider')
            .addToggle((toggle) =>
                toggle
                .setValue(activeProfile.enabled)
                .onChange(async (value) => {
                    activeProfile.enabled = value;
                    if (!value) {
                         this.plugin.settings.activeProfileId = 'profile-openai';
                    }
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

          new Setting(containerEl)
          .setName('OpenRouter API Key')
          .setDesc('Get your key from https://openrouter.ai/keys')
          .addText((text) =>
            text
              .setPlaceholder('sk-or-v1-...')
              .setValue(activeProfile.credentialRef || '')
              .onChange(async (value) => {
                activeProfile.credentialRef = value;
                await this.plugin.saveSettings();
              })
          );

          new Setting(containerEl)
          .setName('Require Data Privacy')
          .setDesc('Enforce strict zero-data-retention routing policies. If enabled, only upstream providers that do not store your data will be used.')
          .addToggle((toggle) =>
            toggle
              .setValue(activeProfile.options?.requireDataPrivacy as boolean ?? true)
              .onChange(async (value) => {
                if(!activeProfile.options) activeProfile.options = {};
                activeProfile.options.requireDataPrivacy = value;
                await this.plugin.saveSettings();
              })
          );

          new Setting(containerEl)
          .setName('Allow Upstream Fallback')
          .setDesc('Allow OpenRouter to route your request to a different upstream inference provider for the same model if the primary fails.')
          .addToggle((toggle) =>
            toggle
              .setValue(activeProfile.options?.allowUpstreamFallback as boolean ?? false)
              .onChange(async (value) => {
                if(!activeProfile.options) activeProfile.options = {};
                activeProfile.options.allowUpstreamFallback = value;
                await this.plugin.saveSettings();
              })
          );

          this.addProfileActions(containerEl, activeProfile);
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

  private addProfileActions(containerEl: HTMLElement, activeProfile: ProviderProfile) {
        // Will implement connection test and catalogue refresh
        new Setting(containerEl)
        .setName('Test Connection')
        .setDesc(`Verify that Obsidian can connect to ${activeProfile.displayName}.`)
        .addButton((button) =>
          button.setButtonText('Test Connection').onClick(async () => {
             await this.plugin.testProviderConnection(activeProfile.id);
             this.display();
          })
        );

        new Setting(containerEl)
        .setName('Refresh Catalogue')
        .setDesc(`Fetch the latest models for ${activeProfile.displayName}.`)
        .addButton((button) =>
          button.setButtonText('Refresh Models').onClick(async () => {
             await this.plugin.refreshProviderModels(activeProfile.id);
             this.display();
          })
        );
  }
}
