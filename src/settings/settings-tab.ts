import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import { OPENAI_AVAILABLE_MODELS, RECOMMENDED_OLLAMA_MODELS } from '../constants';

export class PDFTranscriberSettingTab extends PluginSettingTab {
  private plugin: any;

  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h1', { text: '📄 PDF Handwriting Transcriber' });

    // ── AI PROVIDER ──────────────────────────────────────────────
    containerEl.createEl('h2', { text: '🤖 AI Provider' });

    new Setting(containerEl)
      .setName('Provider')
      .setDesc('Choose between OpenAI (cloud) or Ollama (local, fully private).')
      .addDropdown((dropdown) => {
        dropdown.addOption('openai', 'OpenAI (cloud)');
        dropdown.addOption('ollama', 'Ollama (local)');
        dropdown.setValue(this.plugin.settings.aiProvider);
        dropdown.onChange(async (value) => {
          this.plugin.settings.aiProvider = value;
          await this.plugin.saveSettings();
          this.display(); // re-render to show/hide relevant sections
        });
      });

    // ── OPENAI (shown only when provider = openai) ───────────────
    if (this.plugin.settings.aiProvider === 'openai') {
      containerEl.createEl('h2', { text: '🔑 OpenAI Configuration' });

      new Setting(containerEl)
        .setName('API Key')
        .setDesc('Your OpenAI API key. Get one at https://platform.openai.com/api-keys')
        .addText((text) =>
          text
            .setPlaceholder('sk-...')
            .setValue(this.plugin.settings.openaiApiKey)
            .onChange(async (value) => {
              this.plugin.settings.openaiApiKey = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Model')
        .setDesc('GPT-4o is recommended. All listed models support vision/image input.')
        .addDropdown((dropdown) => {
          OPENAI_AVAILABLE_MODELS.forEach((m) => dropdown.addOption(m, m));
          dropdown.setValue(this.plugin.settings.openaiModel);
          dropdown.onChange(async (value) => {
            this.plugin.settings.openaiModel = value;
            await this.plugin.saveSettings();
          });
        });
    }

    // ── OLLAMA (shown only when provider = ollama) ───────────────
    if (this.plugin.settings.aiProvider === 'ollama') {
      containerEl.createEl('h2', { text: '🦙 Ollama Configuration' });

      new Setting(containerEl)
        .setName('Ollama server URL')
        .setDesc('URL of your local Ollama instance. Default: http://localhost:11434')
        .addText((text) =>
          text
            .setPlaceholder('http://localhost:11434')
            .setValue(this.plugin.settings.ollamaUrl)
            .onChange(async (value) => {
              this.plugin.settings.ollamaUrl = value.replace(/\/$/, '');
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Model')
        .setDesc(
          'Must be a vision-capable model. Recommended: llava, minicpm-v, llama3.2-vision. ' +
            'Pull a model with: ollama pull <model-name>'
        )
        .addText((text) =>
          text
            .setPlaceholder('llava')
            .setValue(this.plugin.settings.ollamaModel)
            .onChange(async (value) => {
              this.plugin.settings.ollamaModel = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Request timeout (seconds)')
        .setDesc(
          'How long to wait for Ollama per page. Increase for slow hardware. Default: 120s'
        )
        .addSlider((slider) =>
          slider
            .setLimits(30, 600, 30)
            .setValue(this.plugin.settings.ollamaTimeoutMs / 1000)
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.ollamaTimeoutMs = value * 1000;
              await this.plugin.saveSettings();
            })
        );

      // Test connection button
      new Setting(containerEl)
        .setName('Test Ollama connection')
        .setDesc('Verify Ollama is running and the selected model is installed.')
        .addButton((btn) =>
          btn
            .setButtonText('Test connection')
            .setCta()
            .onClick(async () => {
              btn.setButtonText('Testing...');
              btn.setDisabled(true);
              try {
                const url = `${this.plugin.settings.ollamaUrl}/api/tags`;
                const resp = await fetch(url);
                if (!resp.ok) {
                  new Notice(`❌ Ollama responded with HTTP ${resp.status}`);
                  return;
                }
                const data = await resp.json() as { models: Array<{ name: string }> };
                const models = (data.models ?? []).map((m) => m.name);
                const selected = this.plugin.settings.ollamaModel;
                const found = models.some((m) => m.startsWith(selected.split(':')[0] as string));
                if (found) {
                  new Notice(`✅ Connected! Model "${selected}" is available. (${models.length} model(s) installed)`);
                } else {
                  new Notice(
                    `⚠️ Connected to Ollama but "${selected}" not found.\nAvailable: ${models.join(', ') || 'none'}\nRun: ollama pull ${selected}`,
                    10000
                  );
                }
              } catch {
                new Notice(
                  `❌ Cannot reach Ollama at ${this.plugin.settings.ollamaUrl}.\nRun: ollama serve`,
                  8000
                );
              } finally {
                btn.setButtonText('Test connection');
                btn.setDisabled(false);
              }
            })
        );

      containerEl.createEl('h3', { text: 'Recommended vision models' });
      const modelList = containerEl.createEl('ul');
      RECOMMENDED_OLLAMA_MODELS.forEach((m) => modelList.createEl('li', { text: m }));
      containerEl.createEl('p', {
        text: 'Install any model with: ollama pull <model-name>',
      }).style.color = 'var(--text-muted)';
    }

    // ── PDF PROCESSING ───────────────────────────────────────────
    containerEl.createEl('h2', { text: '📄 PDF Processing' });

    new Setting(containerEl)
      .setName('Max pages')
      .setDesc('Maximum number of pages to process per run.')
      .addSlider((s) =>
        s.setLimits(1, 100, 1)
          .setValue(this.plugin.settings.maxPages)
          .setDynamicTooltip()
          .onChange(async (v) => { this.plugin.settings.maxPages = v; await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName('Start page')
      .setDesc('First page to process (1-based). Override per-job in the modal.')
      .addText((text) =>
        text
          .setPlaceholder('1')
          .setValue(String(this.plugin.settings.pageStart))
          .onChange(async (v) => {
            const n = parseInt(v);
            if (!isNaN(n) && n > 0) { this.plugin.settings.pageStart = n; await this.plugin.saveSettings(); }
          })
      );

    new Setting(containerEl)
      .setName('End page')
      .setDesc('Last page to process (0 = process up to max pages).')
      .addText((text) =>
        text
          .setPlaceholder('0')
          .setValue(String(this.plugin.settings.pageEnd))
          .onChange(async (v) => {
            const n = parseInt(v);
            if (!isNaN(n) && n >= 0) { this.plugin.settings.pageEnd = n; await this.plugin.saveSettings(); }
          })
      );

    new Setting(containerEl)
      .setName('Batch size')
      .setDesc('How many pages to render before sending to AI. Keep at 1 for most cases.')
      .addSlider((s) =>
        s.setLimits(1, 5, 1)
          .setValue(this.plugin.settings.batchSize)
          .setDynamicTooltip()
          .onChange(async (v) => { this.plugin.settings.batchSize = v; await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName('Render scale')
      .setDesc('Resolution multiplier for page images. 2.0 recommended. Higher = slower but better quality.')
      .addSlider((s) =>
        s.setLimits(1.0, 4.0, 0.5)
          .setValue(this.plugin.settings.renderScale)
          .setDynamicTooltip()
          .onChange(async (v) => { this.plugin.settings.renderScale = v; await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName('Image quality')
      .setDesc('JPEG compression quality for rendered pages (0.5–1.0). 0.9 recommended.')
      .addSlider((s) =>
        s.setLimits(0.5, 1.0, 0.05)
          .setValue(this.plugin.settings.imageQuality)
          .setDynamicTooltip()
          .onChange(async (v) => { this.plugin.settings.imageQuality = v; await this.plugin.saveSettings(); })
      );

    // ── CONTENT & PROMPTS ────────────────────────────────────────
    containerEl.createEl('h2', { text: '✏️ Content & Prompts' });

    new Setting(containerEl)
      .setName('Default content mode')
      .setDesc('Can be overridden per-job in the transcription modal.')
      .addDropdown((d) => {
        d.addOption('mixed', 'Mixed (Text & Diagrams)');
        d.addOption('text', 'Text Only');
        d.addOption('diagram', 'Diagrams Only');
        d.setValue(this.plugin.settings.contentMode);
        d.onChange(async (v) => {
          this.plugin.settings.contentMode = v as 'text' | 'diagram' | 'mixed';
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Text transcription prompt')
      .setDesc('Default prompt used in Text Only mode.')
      .addTextArea((ta) => {
        ta.setValue(this.plugin.settings.defaultTextPrompt)
          .onChange(async (v) => { this.plugin.settings.defaultTextPrompt = v; await this.plugin.saveSettings(); });
        ta.inputEl.rows = 4;
        ta.inputEl.style.width = '100%';
      });

    new Setting(containerEl)
      .setName('Mixed content prompt')
      .setDesc('Default prompt used in Mixed mode (text + diagrams).')
      .addTextArea((ta) => {
        ta.setValue(this.plugin.settings.defaultMixedPrompt)
          .onChange(async (v) => { this.plugin.settings.defaultMixedPrompt = v; await this.plugin.saveSettings(); });
        ta.inputEl.rows = 6;
        ta.inputEl.style.width = '100%';
      });

    new Setting(containerEl)
      .setName('Diagram prompt')
      .setDesc('Default prompt used in Diagram Only mode.')
      .addTextArea((ta) => {
        ta.setValue(this.plugin.settings.defaultDiagramPrompt)
          .onChange(async (v) => { this.plugin.settings.defaultDiagramPrompt = v; await this.plugin.saveSettings(); });
        ta.inputEl.rows = 4;
        ta.inputEl.style.width = '100%';
      });

    // ── ABOUT ────────────────────────────────────────────────────
    containerEl.createEl('h2', { text: 'ℹ️ About' });
    containerEl.createEl('p', {
      text: 'PDF Handwriting Transcriber — transcribes handwritten PDFs using OpenAI or a local Ollama vision model.',
    });
    containerEl.createEl('p', {
      text: 'For Ollama: install from https://ollama.com, then run: ollama pull llava',
    }).style.color = 'var(--text-muted)';
  }
}