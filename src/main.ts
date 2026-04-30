import { Plugin, Notice, Editor, MarkdownView } from 'obsidian';
import { DEFAULT_SETTINGS } from './constants';
import { PDFTranscriberSettings, TranscriptionOptions } from './types';
import { PDFSelectorModal } from './modals/pdf-selector-modal';
import { PDFTranscriberSettingTab } from './settings/settings-tab';
import { PDFProcessor } from './pdf-processor';
import { OpenAIProvider } from './provider/openai-provider';
import { OllamaProvider } from './provider/ollama-provider';
import { TranscriptionProvider } from './provider/provider-interface';
import { formatMermaidDiagrams, areConsecutive } from './utils';

export default class PDFTranscriberPlugin extends Plugin {
  settings: PDFTranscriberSettings;
  private processor: PDFProcessor | null = null;

  async onload() {
    console.log('Loading PDF Transcriber Plugin...');
    await this.loadSettings();
    this.processor = new PDFProcessor(this.app);

    // Command: transcribe PDF (inserts into active editor)
    this.addCommand({
      id: 'transcribe-pdf',
      name: 'Transcribe PDF (handwriting)',
      editorCallback: (editor: Editor) => {
        new PDFSelectorModal(
          this.app,
          this,
          (pdfPath: string, options: TranscriptionOptions) => {
            void this.transcribePDF(pdfPath, editor, options);
          }
        ).open();
      },
    });

    // Ribbon icon
    this.addRibbonIcon('file-text', 'Transcribe PDF handwriting', () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) {
        new PDFSelectorModal(
          this.app,
          this,
          (pdfPath: string, options: TranscriptionOptions) => {
            void this.transcribePDF(pdfPath, view.editor, options);
          }
        ).open();
      } else {
        new Notice('📝 Open a Markdown note first, then click the transcribe button.');
      }
    });

    // Settings tab
    this.addSettingTab(new PDFTranscriberSettingTab(this.app, this));

    console.log('PDF Transcriber loaded. Provider:', this.settings.aiProvider);
  }

  onunload() {
    console.log('PDF Transcriber unloaded');
  }

  private buildProvider(): TranscriptionProvider {
    if (this.settings.aiProvider === 'ollama') {
      return new OllamaProvider(
        this.settings.ollamaUrl,
        this.settings.ollamaModel,
        this.settings.ollamaTimeoutMs
      );
    }
    return new OpenAIProvider(
      this.settings.openaiApiKey,
      this.settings.openaiModel
    );
  }

  async transcribePDF(
    pdfPath: string,
    editor: Editor,
    options: TranscriptionOptions
  ): Promise<void> {
    const status = new Notice('📄 Starting transcription...', 0);

    try {
      if (!this.processor) throw new Error('PDF Processor not initialized');

      // 1. Validate provider
      status.setMessage('🔍 Validating AI provider...');
      const provider = this.buildProvider();
      await provider.validate();

      // 2. Read PDF
      status.setMessage('📖 Reading PDF...');
      const pdfBuffer = await this.processor.readPDFFile(pdfPath);
      if (!pdfBuffer) {
        throw new Error(`Could not read PDF file: ${pdfPath}`);
      }

      // 3. Load PDF.js
      status.setMessage('📚 Loading PDF library...');
      await this.processor.loadPDFLibrary();

      // 4. Count pages
      const numPages = await this.processor.getPageCount(pdfBuffer);

      // 5. Resolve page range
      const pagesToProcess = this.processor.normalizePagesRange(
        options.selectedPages,
        this.settings.pageStart,
        this.settings.pageEnd,
        this.settings.maxPages,
        numPages
      );

      if (pagesToProcess.length === 0) {
        throw new Error('No pages selected for processing. Check your page range settings.');
      }

      const batchSize = Math.max(1, this.settings.batchSize || 1);

      // 6. Build header
      const pdfName = pdfPath.split('/').pop() ?? pdfPath;
      let output = `# Transcription: ${pdfName}\n\n`;
      output += `> **Date:** ${new Date().toLocaleString()}  \n`;
      output += `> **Provider:** ${provider.displayName}  \n`;
      output += `> **Mode:** ${options.contentMode}  \n`;

      if (pagesToProcess.length === numPages) {
        output += `> **Pages:** All ${numPages}  \n\n`;
      } else if (areConsecutive(pagesToProcess)) {
        output += `> **Pages:** ${pagesToProcess[0]}–${pagesToProcess[pagesToProcess.length - 1]} of ${numPages}  \n\n`;
      } else {
        output += `> **Pages:** ${pagesToProcess.join(', ')} of ${numPages}  \n\n`;
      }

      // 7. Process in batches
      for (let i = 0; i < pagesToProcess.length; i += batchSize) {
        const batch = pagesToProcess.slice(i, i + batchSize);

        status.setMessage(
          `🖼️ Rendering page${batch.length > 1 ? 's' : ''} ${batch.join(', ')} / ${numPages}...`
        );

        const pageResults = await this.processor.renderPagesToImages(
          pdfBuffer,
          batch,
          this.settings.renderScale,
          this.settings.imageQuality
        );

        for (const { pageNum, imageDataUrl } of pageResults) {
          status.setMessage(
            `🤖 Transcribing page ${pageNum}/${numPages} via ${provider.displayName}...`
          );

          let pageText = '';
          try {
            // Select prompt for this mode
            let prompt: string;
            if (options.contentMode === 'text') {
              prompt = options.textPrompt;
            } else if (options.contentMode === 'diagram') {
              prompt = options.diagramPrompt;
            } else {
              prompt = options.mixedPrompt;
            }

            pageText = await provider.transcribeImage(imageDataUrl, prompt);

            // Format mermaid blocks if needed
            if (options.contentMode === 'diagram' || options.contentMode === 'mixed') {
              pageText = formatMermaidDiagrams(pageText);
            }
          } catch (pageErr) {
            const msg = pageErr instanceof Error ? pageErr.message : 'Unknown error';
            console.error(`[PDF Transcriber] Page ${pageNum} error:`, pageErr);
            pageText = `> ❌ *Transcription failed for page ${pageNum}: ${msg}*`;
          }

          output += `## Page ${pageNum}\n\n${pageText}\n\n`;
        }
      }

      // 8. Insert into editor
      status.hide();
      editor.replaceSelection(output);
      new Notice(
        `✅ Done! ${pagesToProcess.length} page${pagesToProcess.length !== 1 ? 's' : ''} transcribed via ${provider.displayName}.`,
        6000
      );
    } catch (err) {
      status.hide();
      console.error('[PDF Transcriber] Error:', err);
      new Notice(
        `❌ Transcription failed: ${err instanceof Error ? err.message : String(err)}`,
        12000
      );
    }
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<PDFTranscriberSettings>
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}