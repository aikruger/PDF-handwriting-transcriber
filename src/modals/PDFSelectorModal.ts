import { App, Modal, Notice } from 'obsidian';
import type PDFTranscriberPlugin from '../main';
import { ensurePdfJsLoaded } from '../utils/pdfUtils';
import { resolveJobConfig } from '../services/resolveJobConfig';

export interface TranscriptionOptions {
  textPrompt?: string; diagramPrompt?: string; mixedPrompt?: string; detectDiagrams?: boolean; contentMode?: 'text' | 'diagram' | 'mixed'; selectedPages?: number[] | null;
  overrideProfileId?: string; overrideModelId?: string;
}

export class PDFSelectorModal extends Modal {
  private plugin: PDFTranscriberPlugin;
  private onSubmit: (pdfPath: string, options: TranscriptionOptions) => Promise<void>;
  private onSubmitImage: (imagePath: string, options: TranscriptionOptions) => Promise<void>;

  private pdfPath: string = '';
  private allPdfFiles: string[] = [];
  private filteredPdfFiles: string[] = [];
  private searchResultsEl: HTMLElement | null = null;
  private selectedPdfEl: HTMLElement | null = null;

  private selectedPages: number[] = [];
  private numPagesInPdf: number = 0;

  private contentMode: 'text' | 'diagram' | 'mixed';
  private customTextPrompt: string;
  private customDiagramPrompt: string;
  private customMixedPrompt: string;
  private detectDiagrams: boolean;

  private selectedProfileId: string;
  private selectedModelId: string = '';
  private isSubmitting: boolean = false;

  constructor(app: App, plugin: PDFTranscriberPlugin, onSubmit: (pdfPath: string, options: TranscriptionOptions) => Promise<void>, onSubmitImage: (imagePath: string, options: TranscriptionOptions) => Promise<void>) {
    super(app);
    this.plugin = plugin; this.onSubmit = onSubmit; this.onSubmitImage = onSubmitImage;
    this.contentMode = plugin.settings.contentMode;
    this.customTextPrompt = plugin.settings.defaultTextPrompt; this.customDiagramPrompt = plugin.settings.defaultDiagramPrompt; this.customMixedPrompt = plugin.settings.defaultMixedPrompt;
    this.detectDiagrams = plugin.settings.detectDiagrams;
    this.selectedProfileId = plugin.settings.activeProfileId;
  }

  onOpen() {
    console.log('[PDFTranscriber][Modal] Opened', { profileId: this.selectedProfileId, contentMode: this.contentMode });
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pdf-transcriber-modal');

    contentEl.createEl('h2', { text: 'PDF Transcriber' });
    const tabsContainer = contentEl.createDiv('nav-buttons-container');
    tabsContainer.style.display = 'flex'; tabsContainer.style.marginBottom = '20px'; tabsContainer.style.borderBottom = '1px solid var(--background-modifier-border)';

    const selectionTab = tabsContainer.createEl('button', { text: '📄 Select File' });
    const pagesTab = tabsContainer.createEl('button', { text: '📑 Select Pages' });
    const promptsTab = tabsContainer.createEl('button', { text: '✏️ Custom Prompts' });

    [selectionTab, pagesTab, promptsTab].forEach((tab) => {
      tab.style.flex = '1'; tab.style.padding = '8px 16px'; tab.style.backgroundColor = 'transparent'; tab.style.border = 'none'; tab.style.borderBottom = '3px solid transparent'; tab.style.borderRadius = '4px 4px 0 0'; tab.style.cursor = 'pointer'; tab.style.transition = 'all 0.2s ease';
    });

    const selectionContainer = contentEl.createDiv('pdf-selection-container');
    const pagesContainer = contentEl.createDiv('pages-container');
    const promptsContainer = contentEl.createDiv('prompts-container');

    pagesContainer.style.display = 'none'; promptsContainer.style.display = 'none';

    selectionTab.classList.add('active'); this.applyActiveTabStyles(selectionTab);

    selectionTab.addEventListener('click', () => {
      this.resetAllTabStyles([selectionTab, pagesTab, promptsTab]); selectionTab.classList.add('active'); this.applyActiveTabStyles(selectionTab);
      selectionContainer.style.display = 'block'; pagesContainer.style.display = 'none'; promptsContainer.style.display = 'none';
    });

    pagesTab.addEventListener('click', async () => {
      if (!this.pdfPath) { new Notice('Please select a file first'); return; }
      if (!this.pdfPath.toLowerCase().match(/\.(pdf)$/)) { new Notice('Select Pages is only available for PDF files'); return; }
      this.resetAllTabStyles([selectionTab, pagesTab, promptsTab]); pagesTab.classList.add('active'); this.applyActiveTabStyles(pagesTab);
      selectionContainer.style.display = 'none'; pagesContainer.style.display = 'block'; promptsContainer.style.display = 'none';
      await this.loadPdfInfo(); this.createPagesUI(pagesContainer);
    });

    promptsTab.addEventListener('click', () => {
      this.resetAllTabStyles([selectionTab, pagesTab, promptsTab]); promptsTab.classList.add('active'); this.applyActiveTabStyles(promptsTab);
      selectionContainer.style.display = 'none'; pagesContainer.style.display = 'none'; promptsContainer.style.display = 'block';
      this.createPromptsUI(promptsContainer);
    });
    this.createSelectionUI(selectionContainer);
  }

  private applyActiveTabStyles(tab: HTMLElement) { tab.style.backgroundColor = 'var(--interactive-accent)'; tab.style.color = 'var(--text-on-accent)'; tab.style.borderBottom = '3px solid var(--interactive-accent-hover)'; tab.style.fontWeight = 'bold'; }
  private resetAllTabStyles(tabs: HTMLElement[]) { tabs.forEach((tab) => { tab.classList.remove('active'); tab.style.backgroundColor = 'transparent'; tab.style.color = 'inherit'; tab.style.borderBottom = '3px solid transparent'; tab.style.fontWeight = 'normal'; }); }

  private createSelectionUI(container: HTMLElement) {
    container.empty();
    container.createEl('h3', { text: 'Select a document or image' });
    const searchInput = container.createEl('input', { type: 'text', placeholder: 'Search for files...', });
    searchInput.style.width = '100%'; searchInput.style.padding = '8px'; searchInput.style.marginBottom = '10px'; searchInput.style.boxSizing = 'border-box';
    this.searchResultsEl = container.createDiv('search-results');
    this.searchResultsEl.style.marginBottom = '15px'; this.searchResultsEl.style.maxHeight = '200px'; this.searchResultsEl.style.overflowY = 'auto';

    this.loadAllFiles();
    searchInput.addEventListener('input', (e) => { const query = (e.target as HTMLInputElement).value.toLowerCase(); this.filteredPdfFiles = this.allPdfFiles.filter((f) => f.toLowerCase().includes(query)); this.displaySearchResults(); });
    this.displaySearchResults();

    const selectedDiv = container.createDiv();
    selectedDiv.createEl('h4', { text: 'Selected File' });
    this.selectedPdfEl = selectedDiv.createEl('div');
    const selectedPdfEl = this.selectedPdfEl;
    selectedPdfEl.style.padding = '10px'; selectedPdfEl.style.backgroundColor = 'var(--background-secondary)'; selectedPdfEl.style.borderRadius = '4px'; selectedPdfEl.style.minHeight = '40px'; selectedPdfEl.style.border = '2px solid var(--background-modifier-border)'; selectedPdfEl.style.marginBottom = '15px';
    this.updateSelectedPdfDisplay(selectedPdfEl);

    container.createEl('h3', { text: 'Supplier Profile' });
    const profileSelect = container.createEl('select');
    profileSelect.style.width = '100%'; profileSelect.style.padding = '8px'; profileSelect.style.marginBottom = '10px';

    this.plugin.settings.profiles.forEach((p) => {
        if(p.enabled || p.id === this.plugin.settings.activeProfileId) {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = p.enabled ? p.displayName : p.displayName + ' — disabled (Enable in settings)';
            profileSelect.appendChild(option);
        }
    });
    profileSelect.value = this.selectedProfileId;

    const modelContainer = container.createDiv();

    const renderModelControls = () => {
        modelContainer.empty();
        modelContainer.createEl('h3', { text: 'Model Override' });
        const profile = this.plugin.settings.profiles.find((p) => p.id === this.selectedProfileId);

        if (profile && profile.options && profile.options.discoveredModels && (profile.options.discoveredModels as any[]).length > 0) {
           const modelSelect = modelContainer.createEl('select');
           modelSelect.style.width = '100%'; modelSelect.style.padding = '8px'; modelSelect.style.marginBottom = '10px';
           const defOption = document.createElement('option'); defOption.value = ''; defOption.textContent = 'Use configured task default'; modelSelect.appendChild(defOption);

           (profile.options.discoveredModels as any[]).forEach((m: any) => { const option = document.createElement('option'); option.value = m.id; option.textContent = m.displayName; modelSelect.appendChild(option); });
           modelSelect.value = this.selectedModelId;
           modelSelect.addEventListener('change', (e) => { this.selectedModelId = (e.target as HTMLSelectElement).value; });
        } else {
            const modelInput = modelContainer.createEl('input', { type: 'text', placeholder: 'Model ID (optional)' });
            modelInput.style.width = '100%'; modelInput.style.padding = '8px'; modelInput.style.marginBottom = '10px';
            modelInput.value = this.selectedModelId;
            modelInput.addEventListener('input', (e) => { this.selectedModelId = (e.target as HTMLInputElement).value; });
            modelContainer.createEl('p', { text: 'Model catalogue not fetched. Run Refresh in settings to see models.' }).style.fontSize = '12px';
        }
    };

    renderModelControls();

    profileSelect.addEventListener('change', (e) => {
        const newProfileId = (e.target as HTMLSelectElement).value;
        console.log('[PDFTranscriber][Modal] Profile changed', { previousProfileId: this.selectedProfileId, profileId: newProfileId, modelOverrideCleared: true });
        this.selectedProfileId = newProfileId; this.selectedModelId = ''; renderModelControls();
    });

    container.createEl('h3', { text: 'Processing Mode' });
    const modeSelect = container.createEl('select');
    modeSelect.style.width = '100%'; modeSelect.style.padding = '8px'; modeSelect.style.marginBottom = '10px';

    const modes = [ { value: 'mixed', label: 'Mixed (Text & Diagrams)' }, { value: 'text', label: 'Text Only' }, { value: 'diagram', label: 'Diagrams Only' } ];
    modes.forEach((mode) => { const option = document.createElement('option'); option.value = mode.value; option.textContent = mode.label; modeSelect.appendChild(option); });

    modeSelect.value = this.contentMode;
    modeSelect.addEventListener('change', (e) => { this.contentMode = (e.target as HTMLSelectElement).value as any; renderModelControls(); });

    const processBtn = container.createEl('button', { text: '▶️ Generate Transcription' });
    processBtn.style.width = '100%'; processBtn.style.padding = '10px'; processBtn.style.marginTop = '15px'; processBtn.style.backgroundColor = 'var(--interactive-accent)'; processBtn.style.color = 'var(--text-on-accent)'; processBtn.style.border = 'none'; processBtn.style.borderRadius = '4px'; processBtn.style.cursor = 'pointer'; processBtn.style.fontWeight = 'bold';

    processBtn.addEventListener('click', async () => {
      if (this.isSubmitting) return;
      if (!this.pdfPath) { new Notice('Please select a file first'); return; }

      const customOptions: TranscriptionOptions = {
        textPrompt: this.customTextPrompt, diagramPrompt: this.customDiagramPrompt, mixedPrompt: this.customMixedPrompt, detectDiagrams: this.detectDiagrams,
        contentMode: this.contentMode, selectedPages: this.selectedPages.length > 0 ? this.selectedPages : null,
        overrideProfileId: this.selectedProfileId, overrideModelId: this.selectedModelId
      };

      try {
         const profile = this.plugin.settings.profiles.find((p: any) => p.id === this.selectedProfileId);
         if (!profile) throw new Error('Selected profile not found.');
         if (!profile.enabled) throw new Error(`Profile "${profile.displayName}" is disabled. Enable it in settings.`);
         const config = resolveJobConfig(this.plugin.settings, this.contentMode, customOptions);
         const provider = this.plugin.providerRegistry.getAdapter(profile);
         if (!provider.isConfigured()) throw new Error(provider.getConfigurationStatus());
         if (!config.modelId) throw new Error("No model resolved for task");

         console.log('[PDFTranscriber][Modal] Selection resolved', { profileId: config.profileId, modelId: config.modelId, task: config.task, usesModelOverride: !!this.selectedModelId });
         this.isSubmitting = true; processBtn.disabled = true; processBtn.textContent = 'Processing...';
         console.log('[PDFTranscriber][Modal] Submitted', { profileId: config.profileId, modelId: config.modelId, task: config.task, fileType: this.pdfPath.split('.').pop(), selectedPageCount: this.selectedPages.length || 'all' });

         if (this.pdfPath.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/)) await this.onSubmitImage(this.pdfPath, customOptions);
         else await this.onSubmit(this.pdfPath, customOptions);
         this.close();
      } catch (e: any) {
          console.warn('[PDFTranscriber][Modal] Validation blocked', { profileId: this.selectedProfileId, reasonCode: e.message });
          new Notice(e.message);
      } finally {
          this.isSubmitting = false; processBtn.disabled = false; processBtn.textContent = '▶️ Generate Transcription';
      }
    });
  }

  private updateSelectedPdfDisplay(element: HTMLElement) {
    element.empty();
    if (!this.pdfPath) { element.textContent = 'No file selected'; element.style.color = 'var(--text-muted)'; element.style.fontStyle = 'italic'; }
    else { const fileName = this.pdfPath.split('/').pop(); const folderPath = this.pdfPath.substring(0, this.pdfPath.lastIndexOf('/')); element.style.color = 'var(--text-normal)'; element.style.fontStyle = 'normal'; const nameEl = element.createEl('strong', { text: fileName }); nameEl.style.display = 'block'; nameEl.style.marginBottom = '4px'; nameEl.style.fontSize = '14px'; const pathEl = element.createEl('small', { text: `📁 ${folderPath}` }); pathEl.style.color = 'var(--text-muted)'; pathEl.style.display = 'block'; }
  }

  private createPagesUI(container: HTMLElement) {
    container.empty();
    if (this.numPagesInPdf === 0) { container.createEl('p', { text: 'Loading PDF information...' }); return; }
    container.createEl('h3', { text: `Select Pages (Total: ${this.numPagesInPdf})` });
    const description = container.createEl('p'); description.textContent = 'Click page numbers to toggle selection'; description.style.color = 'var(--text-muted)'; description.style.marginBottom = '15px';
    const gridContainer = container.createDiv(); gridContainer.style.display = 'grid'; gridContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(50px, 1fr))'; gridContainer.style.gap = '8px'; gridContainer.style.marginBottom = '15px';
    for (let i = 1; i <= this.numPagesInPdf; i++) {
      const pageBtn = gridContainer.createEl('button', { text: String(i) });
      pageBtn.style.padding = '10px'; pageBtn.style.textAlign = 'center'; pageBtn.style.border = '1px solid var(--background-modifier-border)'; pageBtn.style.borderRadius = '4px'; pageBtn.style.cursor = 'pointer';
      if (this.selectedPages.includes(i)) { pageBtn.style.backgroundColor = 'var(--interactive-accent)'; pageBtn.style.color = 'var(--text-on-accent)'; }
      pageBtn.addEventListener('click', () => { if (this.selectedPages.includes(i)) { this.selectedPages = this.selectedPages.filter((p) => p !== i); } else { this.selectedPages.push(i); this.selectedPages.sort((a, b) => a - b); } this.createPagesUI(container); });
    }
    const buttonGroup = container.createDiv(); buttonGroup.style.display = 'flex'; buttonGroup.style.gap = '8px';
    const selectAllBtn = buttonGroup.createEl('button', { text: 'Select All' }); selectAllBtn.style.flex = '1'; selectAllBtn.addEventListener('click', () => { this.selectedPages = Array.from({ length: this.numPagesInPdf }, (_, i) => i + 1); this.createPagesUI(container); });
    const clearBtn = buttonGroup.createEl('button', { text: 'Clear' }); clearBtn.style.flex = '1'; clearBtn.addEventListener('click', () => { this.selectedPages = []; this.createPagesUI(container); });
  }

  private createPromptsUI(container: HTMLElement) {
    container.empty(); container.createEl('h3', { text: 'Custom Prompts' });
    const description = container.createEl('p'); description.textContent = 'Customize how the AI processes your PDFs'; description.style.color = 'var(--text-muted)'; description.style.marginBottom = '15px';
    container.createEl('h4', { text: 'Text Transcription' }); const textArea = container.createEl('textarea'); textArea.value = this.customTextPrompt; textArea.style.width = '100%'; textArea.style.height = '80px'; textArea.style.marginBottom = '15px'; textArea.style.padding = '8px'; textArea.style.boxSizing = 'border-box'; textArea.addEventListener('change', (e) => { this.customTextPrompt = (e.target as HTMLTextAreaElement).value; });
    container.createEl('h4', { text: 'Mixed Content' }); const mixedArea = container.createEl('textarea'); mixedArea.value = this.customMixedPrompt; mixedArea.style.width = '100%'; mixedArea.style.height = '80px'; mixedArea.style.marginBottom = '15px'; mixedArea.style.padding = '8px'; mixedArea.style.boxSizing = 'border-box'; mixedArea.addEventListener('change', (e) => { this.customMixedPrompt = (e.target as HTMLTextAreaElement).value; });
    container.createEl('h4', { text: 'Diagram Conversion' }); const diagArea = container.createEl('textarea'); diagArea.value = this.customDiagramPrompt; diagArea.style.width = '100%'; diagArea.style.height = '80px'; diagArea.style.padding = '8px'; diagArea.style.boxSizing = 'border-box'; diagArea.addEventListener('change', (e) => { this.customDiagramPrompt = (e.target as HTMLTextAreaElement).value; });
  }

  private loadAllFiles() {
    this.allPdfFiles = [];
    this.app.vault.getFiles().forEach((file) => { if (['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(file.extension.toLowerCase())) { this.allPdfFiles.push(file.path); } });
    this.filteredPdfFiles = [...this.allPdfFiles];
  }

  private displaySearchResults() {
    if (!this.searchResultsEl) return;
    this.searchResultsEl.empty();
    if (this.filteredPdfFiles.length === 0) { const noResults = this.searchResultsEl.createEl('p', { text: '📭 No PDFs found' }); noResults.style.color = 'var(--text-muted)'; noResults.style.padding = '10px'; return; }
    this.filteredPdfFiles.slice(0, 25).forEach((file) => {
      const resultItem = this.searchResultsEl!.createDiv('search-result-item');
      resultItem.style.padding = '8px 12px'; resultItem.style.cursor = 'pointer'; resultItem.style.borderBottom = '1px solid var(--background-modifier-border)'; resultItem.style.transition = 'all 0.15s ease';
      const fileName = file.split('/').pop(); const folderPath = file.substring(0, file.lastIndexOf('/'));
      const nameEl = resultItem.createEl('div', { text: fileName }); nameEl.style.fontWeight = '500'; nameEl.style.marginBottom = '2px';
      const pathEl = resultItem.createEl('small', { text: folderPath }); pathEl.style.color = 'var(--text-muted)';
      if (file === this.pdfPath) { resultItem.style.backgroundColor = 'var(--background-modifier-hover)'; resultItem.style.borderLeft = '3px solid var(--interactive-accent)'; resultItem.style.paddingLeft = '9px'; nameEl.style.color = 'var(--interactive-accent)'; }
      resultItem.addEventListener('mouseenter', () => { if (file !== this.pdfPath) { resultItem.style.backgroundColor = 'var(--background-modifier-hover)'; } });
      resultItem.addEventListener('mouseleave', () => { if (file !== this.pdfPath) { resultItem.style.backgroundColor = 'transparent'; } });
      resultItem.addEventListener('click', () => { this.pdfPath = file; this.selectedPages = []; this.numPagesInPdf = 0; if (this.selectedPdfEl) this.updateSelectedPdfDisplay(this.selectedPdfEl); this.displaySearchResults(); new Notice(`✅ Selected: ${file.split('/').pop()}`); });
    });
  }


  private currentPdfLoadPath: string = '';

  private async loadPdfInfo() {
    this.currentPdfLoadPath = this.pdfPath;
    try {
      const processor = this.plugin;
      await ensurePdfJsLoaded();
      const pdfBuffer = await processor.readPDFFile(this.pdfPath);
      if (!pdfBuffer) { throw new Error('Could not read PDF'); }
      const loadingTask = (window as any).pdfjsLib.getDocument({ data: pdfBuffer });
      const pdf = await loadingTask.promise;

      if (this.pdfPath === this.currentPdfLoadPath) {
          this.numPagesInPdf = pdf.numPages;
      }
    } catch (error) {
      if (this.pdfPath === this.currentPdfLoadPath) {
          console.error('Error loading PDF info:', error);
          new Notice('Error loading PDF information');
          this.numPagesInPdf = 0;
      }
    }
  }

  onClose() { const { contentEl } = this; contentEl.empty(); }
}