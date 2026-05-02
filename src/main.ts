import { Plugin, Notice } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS, PDFTranscriberSettingTab } from './settings';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { OllamaProvider } from './providers/OllamaProvider';
import { BaseProvider } from './providers/BaseProvider';
import { PDFSelectorModal } from './modals/PDFSelectorModal';
import { readPDFFile, ensurePdfJsLoaded, renderPageToDataUrl } from './utils/pdfUtils';
import { formatMermaidDiagrams, areConsecutive } from './utils/textUtils';

export default class PDFTranscriberPlugin extends Plugin {
  settings!: PluginSettings;
  private openaiProvider!: OpenAIProvider;
  private ollamaProvider!: OllamaProvider;

  // Returns the currently active provider based on settings
  get activeProvider(): BaseProvider {
    if (this.settings.activeProvider === 'ollama' && this.settings.enableOllama) {
      return this.ollamaProvider;
    }
    return this.openaiProvider;
  }

  async onload() {
    await this.loadSettings();
    this.initProviders();

    this.addCommand({
      id: 'transcribe-pdf',
      name: 'Transcribe PDF with handwritten notes',
      editorCallback: (editor: any) => {
        new PDFSelectorModal(this.app, this, (pdfPath: string, customOptions: any) => {
          this.transcribePDF(pdfPath, editor, customOptions);
        }).open();
      }
    });

    this.addSettingTab(new PDFTranscriberSettingTab(this.app, this));
  }

  onunload() {}

  private initProviders() {
    this.openaiProvider = new OpenAIProvider({
      apiKey: this.settings.apiKey,
      selectedModel: this.settings.selectedModel
    });

    this.ollamaProvider = new OllamaProvider({
      baseUrl: this.settings.ollamaBaseUrl,
      selectedModel: this.settings.ollamaSelectedModel
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Sync provider configs after any setting change
    this.openaiProvider.updateConfig({
      apiKey: this.settings.apiKey,
      selectedModel: this.settings.selectedModel
    });
    this.ollamaProvider.updateConfig({
      baseUrl: this.settings.ollamaBaseUrl,
      selectedModel: this.settings.ollamaSelectedModel
    });
  }

  async fetchAvailableModels(): Promise<boolean> {
    // Preserve original method — delegates to active provider
    const provider = this.activeProvider;
    if (!provider.isConfigured() && provider.providerName === 'openai') {
      new Notice('API key required to fetch models');
      return false;
    }

    try {
      const models = await provider.fetchModels();
      if (models.length > 0) {
        if (provider.providerName === 'openai') {
          this.settings.availableModels = models.map(m => m.id);
        } else {
          this.settings.ollamaAvailableModels = models.map(m => m.id);
        }
        await this.saveSettings();
        return true;
      }
      new Notice('No vision models found, using defaults');
      return false;
    } catch (error: any) {
      new Notice(`Failed to fetch models: ${error.message}`);
      return false;
    }
  }

  async transcribePDF(pdfPath: string, editor: any, customOptions: any = {}) {
    try {
      const provider = this.activeProvider;

      // Check provider is configured — new guard using abstraction
      if (!provider.isConfigured()) {
        new Notice(provider.getConfigurationStatus());
        return;
      }

      // Merge options — preserve original logic exactly
      const options = {
        textPrompt: customOptions.textPrompt || this.settings.defaultTextPrompt,
        diagramPrompt: customOptions.diagramPrompt || this.settings.defaultDiagramPrompt,
        mixedPrompt: customOptions.mixedPrompt || this.settings.defaultMixedPrompt,
        detectDiagrams: customOptions.detectDiagrams !== undefined
          ? customOptions.detectDiagrams : this.settings.detectDiagrams,
        contentMode: customOptions.contentMode || this.settings.contentMode,
        selectedPages: customOptions.selectedPages || null
      };

      const status = new Notice('Reading PDF...', 0);

      const pdfBuffer = await readPDFFile(this.app, pdfPath);
      if (!pdfBuffer) {
        status.hide();
        new Notice('Failed to read PDF file');
        return;
      }

      status.setMessage('Loading PDF and preparing for processing...');
      await ensurePdfJsLoaded();

      const loadingTask = (window as any).pdfjsLib.getDocument({ data: pdfBuffer });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;

      // Determine pages to process — preserve original logic exactly
      let pagesToProcess: number[] = [];

      if (options.selectedPages && options.selectedPages.length > 0) {
        pagesToProcess = options.selectedPages.filter((p: number) => p > 0 && p <= numPages);
      } else {
        const start = Math.max(1, this.settings.pageStart || 1);
        const maxPossiblePages = Math.min(numPages, this.settings.maxPages || 50);
        const end = this.settings.pageEnd > 0
          ? Math.min(this.settings.pageEnd, maxPossiblePages)
          : maxPossiblePages;

        if (start > end) {
          status.hide();
          new Notice(`Invalid page range: ${start} to ${end}`);
          return;
        }

        for (let i = start; i <= end; i++) pagesToProcess.push(i);
      }

      if (pagesToProcess.length === 0) {
        status.hide();
        new Notice('No pages selected for processing');
        return;
      }

      status.setMessage(`Processing ${pagesToProcess.length} pages in ${options.contentMode} mode...`);

      const batchSize = Math.max(1, this.settings.batchSize || 1);
      let fullTranscription = '';

      // Header — preserve original format exactly
      fullTranscription += `# Transcription of ${pdfPath.split('/').pop()}\n`;
      if (pagesToProcess.length === 1) {
        fullTranscription += `Page ${pagesToProcess[0]} of ${numPages}\n\n`;
      } else if (pagesToProcess.length === numPages) {
        fullTranscription += `All ${numPages} pages\n\n`;
      } else if (areConsecutive(pagesToProcess)) {
        fullTranscription += `Pages ${pagesToProcess[0]} to ${pagesToProcess[pagesToProcess.length - 1]} of ${numPages}\n\n`;
      } else {
        fullTranscription += `Selected pages: ${pagesToProcess.join(', ')} (of ${numPages} total)\n\n`;
      }

      // Active model from settings — used for display, provider handles actual routing
      const activeModel = provider.providerName === 'ollama'
        ? this.settings.ollamaSelectedModel
        : this.settings.selectedModel;

      // Batch processing — preserve original loop structure exactly
      for (let batchIndex = 0; batchIndex < pagesToProcess.length; batchIndex += batchSize) {
        const batchPageNums = pagesToProcess.slice(batchIndex, batchIndex + batchSize);
        status.setMessage(`Converting pages ${batchPageNums.join(', ')}...`);

        const batchPages: { pageNum: number; imageDataUrl: string }[] = [];

        for (const pageNum of batchPageNums) {
          const imageDataUrl = await renderPageToDataUrl(
            pdf, pageNum, this.settings.renderScale, this.settings.imageQuality
          );
          batchPages.push({ pageNum, imageDataUrl });
        }

        for (const { pageNum, imageDataUrl } of batchPages) {
          status.setMessage(`Transcribing page ${pageNum}...`);

          let pageTranscription = '';

          // Content mode routing — preserve original exactly
          if (options.contentMode === 'mixed') {
            const result = await provider.transcribe({
              imageDataUrl, prompt: options.mixedPrompt, model: activeModel
            });
            pageTranscription = formatMermaidDiagrams(result.text);

          } else if (options.contentMode === 'text') {
            const result = await provider.transcribe({
              imageDataUrl, prompt: options.textPrompt, model: activeModel
            });
            pageTranscription = result.text;

          } else if (options.contentMode === 'diagram') {
            const result = await provider.transcribe({
              imageDataUrl, prompt: options.diagramPrompt, model: activeModel
            });
            pageTranscription = formatMermaidDiagrams(result.text);

          } else {
            // Legacy diagram detection mode — preserve original exactly
            if (options.detectDiagrams) {
              status.setMessage(`Analyzing page ${pageNum} for diagrams...`);
              const containsDiagram = await this.checkForDiagrams(imageDataUrl, activeModel);

              if (containsDiagram) {
                status.setMessage(`Converting diagram on page ${pageNum}...`);
                const result = await provider.transcribe({
                  imageDataUrl, prompt: options.diagramPrompt, model: activeModel
                });
                pageTranscription = formatMermaidDiagrams(result.text);
              } else {
                const result = await provider.transcribe({
                  imageDataUrl, prompt: options.textPrompt, model: activeModel
                });
                pageTranscription = result.text;
              }
            } else {
              const result = await provider.transcribe({
                imageDataUrl, prompt: options.textPrompt, model: activeModel
              });
              pageTranscription = result.text;
            }
          }

          fullTranscription += `## Page ${pageNum}\n\n`;
          fullTranscription += pageTranscription;
          fullTranscription += '\n\n';
        }
      }

      status.hide();
      editor.replaceSelection(fullTranscription);
      new Notice(`Transcription complete! Processed ${pagesToProcess.length} pages.`);

    } catch (error: any) {
      console.error('Transcription error:', error);
      new Notice(`Error: ${error.message || 'Failed to transcribe PDF'}`);
    }
  }

  // Preserve original checkForDiagrams method — routes through provider abstraction
  private async checkForDiagrams(imageDataUrl: string, model: string): Promise<boolean> {
    try {
      const result = await this.activeProvider.transcribe({
        imageDataUrl,
        prompt: "Does this image contain a diagram, chart, drawing, or visual representation? Answer only with 'yes' or 'no'.",
        model,
        maxTokens: 10
      });
      return result.text.toLowerCase().includes('yes');
    } catch (error) {
      return false; // Default to false on error, same as original
    }
  }

  // Expose readPDFFile for use by the modal (same as original plugin.readPDFFile)
  async readPDFFile(filePath: string): Promise<ArrayBuffer | null> {
    return readPDFFile(this.app, filePath);
  }
}
