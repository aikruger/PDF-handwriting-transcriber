import { ProviderRegistry } from './providers/ProviderRegistry';
import { resolveJobConfig } from './services/resolveJobConfig';
import { processImageWithConfig, detectDiagramWithConfig } from './services/TranscriptionService';
import { Plugin, Notice } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS, PDFTranscriberSettingTab } from './settings';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { OllamaProvider } from './providers/OllamaProvider';
import { PDFSelectorModal } from './modals/PDFSelectorModal';
import { readPDFFile, ensurePdfJsLoaded, renderPageToDataUrl } from './utils/pdfUtils';
import { readImageFile } from './utils/imageUtils';
import { formatMermaidDiagrams, areConsecutive } from './utils/textUtils';

export default class PDFTranscriberPlugin extends Plugin {
  public providerRegistry = new ProviderRegistry();

  settings!: PluginSettings;
  private openaiProvider!: OpenAIProvider;
  private ollamaProvider!: OllamaProvider;

  async onload() {
    await this.loadSettings();


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
      apiKey: '',
      selectedModel: ''
    });
    this.ollamaProvider.updateConfig({
      baseUrl: '',
      selectedModel: ''
    });
  }

  // @ts-ignore

  async transcribePDF(pdfPath: string, editor: any, customOptions: any = {}) {
    const status = new Notice('Reading PDF...', 0);
    try {
      const task = customOptions.contentMode || this.settings.contentMode;
      const config = resolveJobConfig(this.settings, task, customOptions);

      const profile = this.settings.profiles.find((p: any) => p.id === config.profileId);
      if (!profile) throw new Error("Profile not found");
      const provider = this.providerRegistry.getAdapter(profile);

      if (!provider.isConfigured()) {
        throw new Error(provider.getConfigurationStatus());
      }

      const pdfBuffer = await readPDFFile(this.app, pdfPath);
      if (!pdfBuffer) {
        throw new Error('Failed to read PDF file');
      }

      status.setMessage('Loading PDF and preparing for processing...');
      await ensurePdfJsLoaded();

      const loadingTask = (window as any).pdfjsLib.getDocument({ data: pdfBuffer });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;

      let pagesToProcess: number[] = [];
      if (customOptions.selectedPages && customOptions.selectedPages.length > 0) {
        pagesToProcess = customOptions.selectedPages.filter((p: number) => p > 0 && p <= numPages);
      } else {
        const start = Math.max(1, this.settings.pageStart || 1);
        const maxPossiblePages = Math.min(numPages, this.settings.maxPages || 50);
        const end = this.settings.pageEnd > 0 ? Math.min(this.settings.pageEnd, maxPossiblePages) : maxPossiblePages;
        if (start > end) throw new Error(`Invalid page range: ${start} to ${end}`);
        for (let i = start; i <= end; i++) pagesToProcess.push(i);
      }

      if (pagesToProcess.length === 0) throw new Error('No pages selected for processing');

      status.setMessage(`Processing ${pagesToProcess.length} pages in ${task} mode...`);

      const batchSize = Math.max(1, this.settings.batchSize || 1);
      let fullTranscription = `# Transcription of ${pdfPath.split('/').pop()}\n`;

      if (pagesToProcess.length === 1) {
        fullTranscription += `Page ${pagesToProcess[0]} of ${numPages}\n\n`;
      } else if (pagesToProcess.length === numPages) {
        fullTranscription += `All ${numPages} pages\n\n`;
      } else if (areConsecutive(pagesToProcess)) {
        fullTranscription += `Pages ${pagesToProcess[0]} to ${pagesToProcess[pagesToProcess.length - 1]} of ${numPages}\n\n`;
      } else {
        fullTranscription += `Selected pages: ${pagesToProcess.join(', ')} (of ${numPages} total)\n\n`;
      }

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
          const detectDiagrams = customOptions.detectDiagrams !== undefined ? customOptions.detectDiagrams : this.settings.detectDiagrams;

          if (task === 'mixed' || task === 'diagram') {
             pageTranscription = await processImageWithConfig(provider, config, imageDataUrl);
             pageTranscription = formatMermaidDiagrams(pageTranscription);
          } else if (task === 'text') {
             if (detectDiagrams) {
                 status.setMessage(`Analyzing page ${pageNum} for diagrams...`);
                 const containsDiagram = await detectDiagramWithConfig(provider, config, imageDataUrl);
                 if (containsDiagram) {
                    status.setMessage(`Converting diagram on page ${pageNum}...`);
                    const diagConfig = resolveJobConfig(this.settings, 'diagram', customOptions);
                    pageTranscription = await processImageWithConfig(provider, diagConfig, imageDataUrl);
                    pageTranscription = formatMermaidDiagrams(pageTranscription);
                 } else {
                    pageTranscription = await processImageWithConfig(provider, config, imageDataUrl);
                 }
             } else {
                 pageTranscription = await processImageWithConfig(provider, config, imageDataUrl);
             }
          }

          fullTranscription += `## Page ${pageNum}\n\n`;
          fullTranscription += pageTranscription;
          fullTranscription += '\n\n';
        }
      }

      editor.replaceSelection(fullTranscription);
      new Notice(`Transcription complete! Processed ${pagesToProcess.length} pages.`);

    } catch (error: any) {
      console.error('Transcription error:', error);
      new Notice(`Error: ${error.message || 'Failed to transcribe PDF'}`);
    } finally {
      status.hide();
    }
  }

  async transcribeImage(imagePath: string, editor: any, customOptions: any = {}) {
    const status = new Notice('Reading image file...', 0);
    try {
      const task = customOptions.contentMode || this.settings.contentMode;
      const config = resolveJobConfig(this.settings, task, customOptions);

      const profile = this.settings.profiles.find((p: any) => p.id === config.profileId);
      if (!profile) throw new Error("Profile not found");
      const provider = this.providerRegistry.getAdapter(profile);

      if (!provider.isConfigured()) {
        throw new Error(provider.getConfigurationStatus());
      }

      const imageDataUrl = await readImageFile(this.app, imagePath);
      if (!imageDataUrl) {
         throw new Error('Failed to read image file');
      }

      status.setMessage('Transcribing image...');

      let text = await processImageWithConfig(provider, config, imageDataUrl);
      if (task === 'mixed' || task === 'diagram') {
          text = formatMermaidDiagrams(text);
      }

      const fileName = imagePath.split('/').pop();
      const output = `# Transcription of ${fileName}\n\n${text}\n\n`;

      editor.replaceSelection(output);
      new Notice('Image transcription complete!');

    } catch (error: any) {
      new Notice(`Error: ${error?.message || 'Failed to transcribe image'}`);
    } finally {
      status.hide();
    }
  }

  // Preserve original checkForDiagrams method


  // Expose readPDFFile for use by the modal (same as original plugin.readPDFFile)
  async readPDFFile(filePath: string): Promise<ArrayBuffer | null> {
    return readPDFFile(this.app, filePath);
  }
}
