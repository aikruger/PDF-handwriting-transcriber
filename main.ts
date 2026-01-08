/**
 * PDF Transcriber Plugin for Obsidian
 * Main entry point
 */

import { Plugin, Notice, Editor, MarkdownView } from 'obsidian';
import { DEFAULT_SETTINGS } from './src/constants';
import { PDFTranscriberSettings, TranscriptionOptions, AudioExtractionResult } from './src/types';
import { PDFSelectorModal } from './src/modals/pdf-selector-modal';
import { PDFTranscriberSettingTab } from './src/settings/settings-tab';
import { OpenAIClient } from './src/openai';
import { PDFAudioExtractor } from './src/audio-extractor';
import { PDFProcessor } from './src/pdf-processor';
import { formatMermaidDiagrams, formatAudioSync } from './src/utils';
import { areConsecutive } from './src/utils';

export default class PDFTranscriberPlugin extends Plugin {
  settings: PDFTranscriberSettings;
  private openai: OpenAIClient | null = null;
  private processor: PDFProcessor | null = null;

  async onload() {
    console.log('Loading PDF Transcriber Plugin...');

    await this.loadSettings();

    this.processor = new PDFProcessor(this.app);

    if (this.settings.apiKey) {
      this.openai = new OpenAIClient(this.settings.apiKey);
    }

    // Add command
    this.addCommand({
      id: 'transcribe-pdf',
      name: 'Transcribe PDF with handwritten notes',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        new PDFSelectorModal(this.app, this, (pdfPath: string, customOptions: TranscriptionOptions) => {
          this.transcribePDF(pdfPath, editor, customOptions);
        }).open();
      },
    });

    // Add settings tab
    this.addSettingTab(new PDFTranscriberSettingTab(this.app, this));

    console.log('PDF Transcriber Plugin loaded successfully');
  }

  onunload() {
    console.log('PDF Transcriber Plugin unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);

    if (this.settings.apiKey) {
      this.openai = new OpenAIClient(this.settings.apiKey);
    }
  }

  async transcribePDF(pdfPath: string, editor: Editor, customOptions: TranscriptionOptions) {
    try {
      const status = new Notice('Reading PDF...', 0);

      if (!this.processor) {
        throw new Error('PDF Processor not initialized');
      }

      const pdfBuffer = await this.processor.readPDFFile(pdfPath);
      if (!pdfBuffer) {
        status.hide();
        new Notice('Failed to read PDF file');
        return;
      }

      // === AUDIO EXTRACTION ===
      let audioPath: string | null = null;
      let audioExtracted = false;

      if (this.settings.extractAudio && this.settings.autoExtractBeforeTranscription) {
        try {
          status.setMessage('🎵 Extracting audio from PDF...');

          const audioResult = await PDFAudioExtractor.extractAudioFromPDF(pdfBuffer);

          if (audioResult.found && audioResult.audioBuffer) {
            status.setMessage('💾 Saving extracted audio...');

            const pdfFileName = pdfPath.split('/').pop() || 'audio';
            audioPath = await PDFAudioExtractor.saveAudioToVault(
              this.app,
              audioResult.audioBuffer,
              audioResult.mimeType || 'audio/mpeg',
              pdfFileName
            );

            audioExtracted = true;
            new Notice(`✅ Audio extracted: ${audioPath.split('/').pop()}`, 3);
            status.setMessage('📝 Processing PDF pages...');
          } else {
            console.log('No embedded audio in PDF');
            status.setMessage('📝 Processing PDF pages...');
          }
        } catch (audioError) {
          console.error('Audio extraction failed:', audioError);
          status.setMessage('📝 Continuing with text transcription...');
        }
      }

      // === PDF TRANSCRIPTION ===
      status.setMessage('Loading PDF and preparing for processing...');

      await this.processor.loadPDFLibrary();

      const numPages = await this.processor.getPageCount(pdfBuffer);

      // Determine pages to process
      let pagesToProcess = this.processor.normalizePagesRange(
        customOptions.selectedPages,
        this.settings.pageStart,
        this.settings.pageEnd,
        this.settings.maxPages,
        numPages
      );

      if (pagesToProcess.length === 0) {
        status.hide();
        new Notice('No pages selected for processing');
        return;
      }

      console.log(`Processing ${pagesToProcess.length} pages in ${customOptions.contentMode} mode`);
      status.setMessage(`Processing ${pagesToProcess.length} pages...`);

      // Render and transcribe pages
      const batchSize = Math.max(1, this.settings.batchSize || 1);
      let fullTranscription = '';

      // Header
      fullTranscription += `# Transcription of ${pdfPath.split('/').pop()}\n`;

      // Audio link
      if (audioExtracted && audioPath) {
        fullTranscription += `\n## 🎵 Audio Recording\n\n`;
        fullTranscription += `**[▶ Play Recording](${audioPath})**\n\n`;
        fullTranscription += `![audio-recording](${audioPath})\n\n`;
        fullTranscription += `---\n\n`;
      }

      // Page info
      if (pagesToProcess.length === 1) {
        fullTranscription += `Page ${pagesToProcess[0]} of ${numPages}\n\n`;
      } else {
        if (pagesToProcess.length === numPages) {
          fullTranscription += `All ${numPages} pages\n\n`;
        } else if (areConsecutive(pagesToProcess)) {
          fullTranscription += `Pages ${pagesToProcess[0]} to ${pagesToProcess[pagesToProcess.length - 1]} of ${numPages}\n\n`;
        } else {
          fullTranscription += `Selected pages: ${pagesToProcess.join(', ')} (of ${numPages} total)\n\n`;
        }
      }

      // Process in batches
      for (let batchIndex = 0; batchIndex < pagesToProcess.length; batchIndex += batchSize) {
        const batchPageNums = pagesToProcess.slice(batchIndex, batchIndex + batchSize);
        status.setMessage(`Converting pages ${batchPageNums.join(', ')}...`);

        const pageResults = await this.processor.renderPagesToImages(
          pdfBuffer,
          batchPageNums,
          this.settings.renderScale,
          this.settings.imageQuality
        );

        // Transcribe each page
        for (const { pageNum, imageDataUrl } of pageResults) {
          status.setMessage(`Transcribing page ${pageNum}...`);

          let pageTranscription = '';

          try {
            if (!this.openai) {
              throw new Error('OpenAI API key not configured');
            }

            if (
              customOptions.contentMode === 'audio-sync'
            ) {
              pageTranscription = await this.openai.transcribeImage(
                imageDataUrl,
                customOptions.audioSyncPrompt,
                this.settings.selectedModel
              );
              pageTranscription = formatAudioSync(pageTranscription, audioPath);
            } else if (customOptions.contentMode === 'mixed') {
              pageTranscription = await this.openai.transcribeImage(
                imageDataUrl,
                customOptions.mixedPrompt,
                this.settings.selectedModel
              );
              pageTranscription = formatMermaidDiagrams(pageTranscription);
            } else if (customOptions.contentMode === 'text') {
              pageTranscription = await this.openai.transcribeImage(
                imageDataUrl,
                customOptions.textPrompt,
                this.settings.selectedModel
              );
            } else if (customOptions.contentMode === 'diagram') {
              pageTranscription = await this.openai.transcribeImage(
                imageDataUrl,
                customOptions.diagramPrompt,
                this.settings.selectedModel
              );
              pageTranscription = formatMermaidDiagrams(pageTranscription);
            } else {
              // Default: text only
              pageTranscription = await this.openai.transcribeImage(
                imageDataUrl,
                customOptions.textPrompt,
                this.settings.selectedModel
              );
            }

            fullTranscription += `## Page ${pageNum}\n\n`;
            fullTranscription += pageTranscription;
            fullTranscription += '\n\n';
          } catch (error) {
            console.error(`Error transcribing page ${pageNum}:`, error);
            fullTranscription += `## Page ${pageNum}\n\n`;
            fullTranscription += `❌ Error transcribing page: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`;
          }
        }
      }

      status.hide();

      // Insert result
      editor.replaceSelection(fullTranscription);
      new Notice(`✅ Transcription complete! Processed ${pagesToProcess.length} pages.`);
    } catch (error) {
      console.error('Transcription error:', error);
      new Notice(`Error: ${error instanceof Error ? error.message : 'Failed to transcribe PDF'}`);
    }
  }
}
