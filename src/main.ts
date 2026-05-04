import { Plugin, Notice } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS, PDFTranscriberSettingTab } from './settings';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { OllamaProvider } from './providers/OllamaProvider';
import { BaseProvider } from './providers/BaseProvider';
import { PDFSelectorModal } from './modals/PDFSelectorModal';
import { readPDFFile, ensurePdfJsLoaded, renderPageToDataUrl, RANKING_PLACEHOLDER_IMAGE } from './utils/pdfUtils';
import { readImageFile } from './utils/imageUtils';
import { formatMermaidDiagrams, areConsecutive } from './utils/textUtils';

export default class PDFTranscriberPlugin extends Plugin {
  settings!: PluginSettings;
  private openaiProvider!: OpenAIProvider;
  private ollamaProvider!: OllamaProvider;

  getProviderByName(providerName: 'openai' | 'ollama'): BaseProvider {
    return providerName === 'ollama' ? this.ollamaProvider : this.openaiProvider;
  }

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
        new PDFSelectorModal(
          this.app,
          this,
          (pdfPath: string, customOptions: any) => {
            this.transcribePDF(pdfPath, editor, customOptions);
          },
          (imagePath: string, customOptions: any) => {
            this.transcribeImage(imagePath, editor, customOptions);
          }
        ).open();
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
    const loaded = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    if (Array.isArray(loaded.availableModels) && typeof loaded.availableModels[0] === 'string') {
      loaded.availableModels = loaded.availableModels.map((id: string) => ({
        id,
        displayName: id,
        supportsVision: true,
        provider: 'openai',
        recommended: false,
        tested: false,
        testStatus: 'untested',
        score: this.providerModelScoreFallback('openai', id)
      }));
    }

    if (Array.isArray(loaded.ollamaAvailableModels) && typeof loaded.ollamaAvailableModels[0] === 'string') {
      loaded.ollamaAvailableModels = loaded.ollamaAvailableModels.map((id: string) => ({
        id,
        displayName: id,
        supportsVision: true,
        provider: 'ollama',
        recommended: false,
        tested: false,
        testStatus: 'untested',
        score: this.providerModelScoreFallback('ollama', id)
      }));
    }

    const OLD_TEXT_PROMPT = 'Please transcribe all handwritten text from this image. Format it cleanly with proper paragraphs, lists, and line breaks as they appear in the original.';
    const OLD_DIAGRAM_PROMPT = 'This image contains a diagram or drawing. Please analyze it carefully and convert it to a mermaid diagram. Use the appropriate mermaid syntax based on the type of diagram (flowchart, sequence diagram, etc.). Focus on capturing the structure, relationships, and any text labels.';
    const OLD_MIXED_PROMPT = "This image may contain both handwritten text and diagrams/drawings. Please:\n\n1. Transcribe all handwritten text accurately, maintaining paragraphs and formatting.\n\n2. For any diagrams or drawings, convert them to mermaid syntax. Wrap the mermaid code in triple backticks with 'mermaid' label.\n\nEnsure you maintain the logical flow of the document, placing the mermaid diagrams in the appropriate locations relative to the text.";

    if (loaded.defaultTextPrompt === OLD_TEXT_PROMPT) {
      loaded.defaultTextPrompt = DEFAULT_SETTINGS.defaultTextPrompt;
    }
    if (loaded.defaultDiagramPrompt === OLD_DIAGRAM_PROMPT) {
      loaded.defaultDiagramPrompt = DEFAULT_SETTINGS.defaultDiagramPrompt;
    }
    if (loaded.defaultMixedPrompt === OLD_MIXED_PROMPT) {
      loaded.defaultMixedPrompt = DEFAULT_SETTINGS.defaultMixedPrompt;
    }

    this.settings = loaded;
  }

  private providerModelScoreFallback(provider: string, id: string): number {
    const model = id.toLowerCase();

    if (provider === 'openai') {
      if (model === 'gpt-4.1') return 100;
      if (model.startsWith('gpt-4.1')) return 95;
      if (model === 'gpt-4o') return 90;
      if (model.startsWith('gpt-4o')) return 85;
      if (model === 'gpt-4-turbo') return 75;
      if (model.startsWith('gpt-4')) return 60;
      return 0;
    }

    if (provider === 'ollama') {
      if (model === 'llava') return 100;
      if (model.startsWith('llava:13b')) return 95;
      if (model.startsWith('llava:34b')) return 90;
      if (model.startsWith('bakllava')) return 85;
      if (model.startsWith('llava-phi3')) return 80;
      if (model.startsWith('moondream')) return 75;
      if (model.includes('vision')) return 60;
      return 0;
    }

    return 0;
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

  // @ts-ignore

  async pullOllamaModel(modelId: string): Promise<void> {
    const notice = new Notice(`Pulling ${modelId}...`, 0);

    const ok = await this.ollamaProvider.pullModel(modelId, (status) => {
      notice.setMessage(`Pulling ${modelId}: ${status}`);
    });

    notice.hide();

    if (ok) {
      new Notice(`${modelId} downloaded successfully`);
      await this.refreshAndRecommendModels('ollama');
    } else {
      new Notice(`Failed to pull ${modelId}`);
    }
  }
  // @ts-ignore
  private getModelsForProvider(providerName: string) {
    return providerName === 'ollama'
      ? this.settings.ollamaAvailableModels
      : this.settings.availableModels;
  }

  private setModelsForProvider(providerName: string, models: any[]) {
    if (providerName === 'ollama') {
      this.settings.ollamaAvailableModels = models;
    } else {
      this.settings.availableModels = models;
    }
  }

  private getSelectedModelForProvider(providerName: string): string {
    return providerName === 'ollama'
      ? this.settings.ollamaSelectedModel
      : this.settings.selectedModel;
  }

  private setSelectedModelForProvider(providerName: string, model: string) {
    if (providerName === 'ollama') {
      this.settings.ollamaSelectedModel = model;
    } else {
      this.settings.selectedModel = model;
    }
  }

  async testProviderConnection(providerName: 'openai' | 'ollama'): Promise<boolean> {
    const provider = this.getProviderByName(providerName);

    try {
      const result = await provider.testConnection();

      this.settings.providerConnectionStatus[providerName] = result.ok ? 'passed' : 'failed';
      this.settings.providerConnectionMessage[providerName] = result.message;
      await this.saveSettings();

      new Notice(result.message);
      return result.ok;
    } catch (error: any) {
      this.settings.providerConnectionStatus[providerName] = 'failed';
      this.settings.providerConnectionMessage[providerName] =
        error?.message || `Connection test failed for ${provider.displayName}`;
      await this.saveSettings();

      new Notice(this.settings.providerConnectionMessage[providerName]);
      return false;
    }
  }

  async refreshAndRecommendModels(providerName: 'openai' | 'ollama'): Promise<boolean> {
    const provider = this.getProviderByName(providerName);

    if (!provider.isConfigured()) {
      new Notice(provider.getConfigurationStatus());
      return false;
    }

    this.settings.providerModelProbeStatus[providerName] = 'running';
    await this.saveSettings();

    try {
      let fetchedModels = await provider.fetchModels();

      // NEW: for Ollama, use OpenAI to rank if available
      if (providerName === 'ollama' && this.openaiProvider.isConfigured()) {
        new Notice('Using OpenAI to rank local models for handwriting quality...');

        fetchedModels = await (this.ollamaProvider as OllamaProvider)
          .rankModelsWithCloudAssistance(fetchedModels, async (prompt: string) => {
            const result = await this.openaiProvider.transcribe({
              model: this.settings.selectedModel,
              prompt,
              imageDataUrl: RANKING_PLACEHOLDER_IMAGE, // a plain white JPEG
              maxTokens: 500
            });
            return result.text;
          });

        new Notice('Cloud ranking complete');
      }
      const topCandidates = [...fetchedModels]
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5);

      const probeResults: any[] = [];
      if (provider.supportsModelProbe()) {
        for (const model of topCandidates) {
          const probe = await provider.probeModelCompatibility(model.id);
          probeResults.push(probe);
        }
      }

      const bestModel = this.pickBestRecommendedModel(fetchedModels, probeResults);

      const mergedModels = fetchedModels
        .map((model) => {
          const probe = probeResults.find((p) => p.model === model.id);
          const passed = probe?.ok === true;

          return {
            ...model,
            tested: !!probe,
            testStatus: probe ? (passed ? 'passed' : 'failed') : 'untested',
            recommended: model.id === bestModel,
            reason: probe?.reason
          };
        })
        .sort((a, b) => {
          const aRank = a.recommended ? 1000 : a.testStatus === 'passed' ? 500 : 0;
          const bRank = b.recommended ? 1000 : b.testStatus === 'passed' ? 500 : 0;
          return (bRank + (b.score || 0)) - (aRank + (a.score || 0));
        });

      this.setModelsForProvider(providerName, mergedModels);
      this.settings.providerModelProbeStatus[providerName] = 'complete';
      this.settings.recommendedModels[providerName] = bestModel;

      if (providerName === 'ollama') {
        const topModel = mergedModels.find(m => m.id === bestModel);
        if (topModel && !this.settings.ollamaAvailableModels.find(m => m.id === bestModel)) {
          this.settings.ollamaRecommendedDownload = { id: topModel.id, reason: topModel.reason || 'Better quality for handwriting' };
        } else {
          this.settings.ollamaRecommendedDownload = null;
        }
      }

      const currentSelected = this.getSelectedModelForProvider(providerName);
      const selectedStillValid = mergedModels.some(
        (m) => m.id === currentSelected && m.testStatus !== 'failed'
      );

      if (!selectedStillValid && bestModel) {
        this.setSelectedModelForProvider(providerName, bestModel);
      }

      await this.saveSettings();
      new Notice(`${provider.displayName} models refreshed. Recommended: ${bestModel}`);
      return true;
    } catch (error: any) {
      this.settings.providerModelProbeStatus[providerName] = 'failed';
      await this.saveSettings();

      new Notice(`Failed to refresh ${provider.displayName} models: ${error?.message || 'Unknown error'}`);
      return false;
    }
  }

  private pickBestRecommendedModel(
    models: { id: string; score?: number }[],
    probes: { model: string; ok: boolean }[]
  ): string {
    const passed = models
      .filter((m) => probes.some((p) => p.model === m.id && p.ok))
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    if (passed.length > 0) return passed[0].id;

    const sorted = [...models].sort((a, b) => (b.score || 0) - (a.score || 0));
    return sorted[0]?.id || '';
  }

  async transcribePDF(pdfPath: string, editor: any, customOptions: any = {}) {
    try {
      let provider = this.activeProvider;

      if (customOptions.overrideProvider === 'ollama' && this.settings.enableOllama) {
        provider = this.ollamaProvider;
      } else if (customOptions.overrideProvider === 'openai') {
        provider = this.openaiProvider;
      }

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
      const activeModel = customOptions.overrideModel || (provider.providerName === 'ollama'
        ? this.settings.ollamaSelectedModel
        : this.settings.selectedModel);

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

  async transcribeImage(imagePath: string, editor: any, customOptions: any = {}) {
    try {
      let provider = this.activeProvider;
      if (customOptions.overrideProvider === 'ollama' && this.settings.enableOllama) {
        provider = this.ollamaProvider;
      } else if (customOptions.overrideProvider === 'openai') {
        provider = this.openaiProvider;
      }

      if (!provider.isConfigured()) {
        new Notice(provider.getConfigurationStatus());
        return;
      }

      const activeModel = customOptions.overrideModel
        || (provider.providerName === 'ollama'
            ? this.settings.ollamaSelectedModel
            : this.settings.selectedModel);

      const options = {
        textPrompt: customOptions.textPrompt || this.settings.defaultTextPrompt,
        diagramPrompt: customOptions.diagramPrompt || this.settings.defaultDiagramPrompt,
        mixedPrompt: customOptions.mixedPrompt || this.settings.defaultMixedPrompt,
        contentMode: customOptions.contentMode || this.settings.contentMode,
      };

      const status = new Notice('Reading image file...', 0);

      const imageDataUrl = await readImageFile(this.app, imagePath);

      if (!imageDataUrl) {
        status.hide();
        new Notice('Failed to read image file');
        return;
      }

      status.setMessage('Transcribing image...');

      const prompt = options.contentMode === 'diagram'
        ? options.diagramPrompt
        : options.contentMode === 'text'
          ? options.textPrompt
          : options.mixedPrompt;

      const result = await provider.transcribe({ imageDataUrl, prompt, model: activeModel });

      const fileName = imagePath.split('/').pop();
      const output = `# Transcription of ${fileName}\n\n${result.text}\n\n`;

      status.hide();
      editor.replaceSelection(output);
      new Notice('Image transcription complete!');

    } catch (error: any) {
      new Notice(`Error: ${error?.message || 'Failed to transcribe image'}`);
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
