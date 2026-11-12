import { Notice, Plugin } from 'obsidian';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { resolveJobConfig, contentModeToTask } from './services/resolveJobConfig';
import { processImageWithConfig } from './services/TranscriptionService';
import { migrateSettings, PDFTranscriberSettingTab } from './settings';
import { PluginSettings } from './models/types';
import { PDFSelectorModal } from './modals/PDFSelectorModal';
import { readPDFFile, ensurePdfJsLoaded, renderPageToDataUrl } from './utils/pdfUtils';
import { readImageFile } from './utils/imageUtils';
import { formatMermaidDiagrams, areConsecutive } from './utils/textUtils';

export default class PDFTranscriberPlugin extends Plugin {
  public providerRegistry = new ProviderRegistry();
  settings!: PluginSettings;

  async onload() {
    await this.loadSettings();
    console.log('[PDFTranscriber][Startup]', {
      pluginId: this.manifest.id,
      pluginVersion: this.manifest.version,
      buildCommit: 'BUILD_COMMIT',
      settingsVersion: this.settings.version,
      profiles: this.settings.profiles.map(profile => ({ id: profile.id, adapterId: profile.adapterId, enabled: profile.enabled }))
    });

    this.addCommand({
      id: 'transcribe-pdf',
      name: 'Transcribe PDF with handwritten notes',
      editorCallback: (editor: any) => {
        new PDFSelectorModal(
          this.app, this,
          async (pdfPath, customOptions) => { await this.transcribePDF(pdfPath, editor, customOptions); },
          async (imagePath, customOptions) => { await this.transcribeImage(imagePath, editor, customOptions); }
        ).open();
      }
    });

    this.addSettingTab(new PDFTranscriberSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    const data = await this.loadData();
    this.settings = migrateSettings(data);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    console.log('[PDFTranscriber][Settings] Saved', { schemaVersion: this.settings.version, activeProfileId: this.settings.activeProfileId, profileCount: this.settings.profiles?.length });
  }

  async testProviderConnection(profileId: string): Promise<boolean> {
    try {
      const profile = this.settings.profiles.find((p: any) => p.id === profileId);
      if (!profile) return false;
      const provider = this.providerRegistry.getAdapter(profile, true);
      const res = await provider.testConnection();
      console.log('[PDFTranscriber][Connection] Completed', { profileId, adapterId: provider.getDescriptor().id, ok: res.ok, statusCode: res.statusCode });
      new Notice(res.message);
      return res.ok;
    } catch (e: any) {
      new Notice(`Connection failed: ${e.message}`);
      return false;
    }
  }

  async refreshProviderModels(profileId: string): Promise<void> {
    try {
      const profile = this.settings.profiles.find((p: any) => p.id === profileId);
      if (!profile) return;
      const provider = this.providerRegistry.getAdapter(profile, true);
      const models = await provider.fetchModels();
      const top3 = models.slice(0, 3).map(m => ({ id: m.id, score: m.relevance?.score ?? m.score ?? 0 }));
      console.log('[PDFTranscriber][Catalogue] Refreshed', {
        profileId,
        adapterId: provider.getDescriptor().id,
        modelCount: models.length,
        source: 'live',
        topModels: top3
      });
      const topModel = models[0];
      const topScore = topModel ? (topModel.relevance?.score ?? topModel.score) : undefined;
      const topSuffix = topModel && topScore !== undefined ? ` — top: ${topModel.id} (${topScore})` : '';
      new Notice(`Fetched ${models.length} models from ${provider.displayName}${topSuffix}`);

      if (!profile.options) profile.options = {};
      profile.options.discoveredModels = models;
      await this.saveSettings();
    } catch (e: any) {
      new Notice(`Failed to fetch models: ${e.message}`);
    }
  }

  async transcribePDF(pdfPath: string, editor: any, customOptions: any = {}) {
    const status = new Notice('Reading PDF...', 0);
    try {
      const mode = customOptions.contentMode || this.settings.contentMode;
      const task = contentModeToTask(mode);
      const config = resolveJobConfig(this.settings, mode, customOptions);

      const profile = this.settings.profiles.find(p => p.id === config.profileId);
      if (!profile) throw new Error("Profile not found");
      const provider = this.providerRegistry.getAdapter(profile);
      if (!provider.isConfigured()) throw new Error(provider.getConfigurationStatus());

      const pdfBuffer = await readPDFFile(this.app, pdfPath);
      if (!pdfBuffer) throw new Error('Failed to read PDF file');

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

      if (pagesToProcess.length === 1) fullTranscription += `Page ${pagesToProcess[0]} of ${numPages}\n\n`;
      else if (pagesToProcess.length === numPages) fullTranscription += `All ${numPages} pages\n\n`;
      else if (areConsecutive(pagesToProcess)) fullTranscription += `Pages ${pagesToProcess[0]} to ${pagesToProcess[pagesToProcess.length - 1]} of ${numPages}\n\n`;
      else fullTranscription += `Selected pages: ${pagesToProcess.join(', ')} (of ${numPages} total)\n\n`;

      for (let batchIndex = 0; batchIndex < pagesToProcess.length; batchIndex += batchSize) {
        const batchPageNums = pagesToProcess.slice(batchIndex, batchIndex + batchSize);
        status.setMessage(`Converting pages ${batchPageNums.join(', ')}...`);
        const batchPages: { pageNum: number; imageDataUrl: string }[] = [];
        for (const pageNum of batchPageNums) {
          batchPages.push({ pageNum, imageDataUrl: await renderPageToDataUrl(pdf, pageNum, this.settings.renderScale, this.settings.imageQuality) });
        }

        for (const { pageNum, imageDataUrl } of batchPages) {
          status.setMessage(`Transcribing page ${pageNum}...`);
          let pageTranscription = '';
          if (task === 'mixed' || task === 'diagram') {
             pageTranscription = await processImageWithConfig(provider, config, imageDataUrl);
             pageTranscription = formatMermaidDiagrams(pageTranscription);
          } else if (task === 'handwriting') {
             pageTranscription = await processImageWithConfig(provider, config, imageDataUrl);
          }
          fullTranscription += `## Page ${pageNum}\n\n${pageTranscription}\n\n`;
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
      const mode = customOptions.contentMode || this.settings.contentMode;
      const task = contentModeToTask(mode);
      const config = resolveJobConfig(this.settings, mode, customOptions);

      const profile = this.settings.profiles.find(p => p.id === config.profileId);
      if (!profile) throw new Error("Profile not found");
      const provider = this.providerRegistry.getAdapter(profile);
      if (!provider.isConfigured()) throw new Error(provider.getConfigurationStatus());

      const imageDataUrl = await readImageFile(this.app, imagePath);
      if (!imageDataUrl) throw new Error('Failed to read image file');

      status.setMessage('Transcribing image...');
      let text = await processImageWithConfig(provider, config, imageDataUrl);
      if (task === 'mixed' || task === 'diagram') text = formatMermaidDiagrams(text);

      const fileName = imagePath.split('/').pop();
      editor.replaceSelection(`# Transcription of ${fileName}\n\n${text}\n\n`);
      new Notice('Image transcription complete!');
    } catch (error: any) {
      new Notice(`Error: ${error?.message || 'Failed to transcribe image'}`);
    } finally {
      status.hide();
    }
  }
  async readPDFFile(filePath: string): Promise<ArrayBuffer | null> { return readPDFFile(this.app, filePath); }
}