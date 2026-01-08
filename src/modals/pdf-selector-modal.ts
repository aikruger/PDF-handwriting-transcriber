/**
 * PDF Selector Modal
 * User interface for selecting PDFs and configuring transcription
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import { TranscriptionOptions } from '../types';
import { PDFProcessor } from '../pdf-processor';

export class PDFSelectorModal extends Modal {
  private plugin: any;
  private onSubmit: (pdfPath: string, options: TranscriptionOptions) => void;
  private pdfPath: string = '';
  private allPdfFiles: string[] = [];
  private filteredPdfFiles: string[] = [];
  private searchResultsEl: HTMLElement | null = null;
  private selectedPages: number[] = [];
  private numPagesInPdf: number = 0;
  private contentMode: 'text' | 'diagram' | 'mixed' | 'audio-sync' = 'mixed';
  private customTextPrompt: string;
  private customDiagramPrompt: string;
  private customMixedPrompt: string;
  private customAudioSyncPrompt: string;

  constructor(
    app: App,
    plugin: any,
    onSubmit: (pdfPath: string, options: TranscriptionOptions) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.onSubmit = onSubmit;
    this.customTextPrompt = plugin.settings.defaultTextPrompt;
    this.customDiagramPrompt = plugin.settings.defaultDiagramPrompt;
    this.customMixedPrompt = plugin.settings.defaultMixedPrompt;
    this.customAudioSyncPrompt = plugin.settings.defaultAudioSyncPrompt;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pdf-transcriber-modal');

    // Title
    contentEl.createEl('h2', { text: 'PDF Transcriber' });

    // Create tabs
    const tabsContainer = contentEl.createDiv('nav-buttons-container');
    tabsContainer.style.display = 'flex';
    tabsContainer.style.marginBottom = '20px';
    tabsContainer.style.borderBottom = '1px solid var(--background-modifier-border)';

    const selectionTab = tabsContainer.createEl('button', { text: '📄 Select PDF' });
    const pagesTab = tabsContainer.createEl('button', { text: '📑 Select Pages' });
    const promptsTab = tabsContainer.createEl('button', { text: '✏️ Custom Prompts' });

    // Style tabs
    [selectionTab, pagesTab, promptsTab].forEach((tab) => {
      tab.style.flex = '1';
      tab.style.padding = '8px 16px';
      tab.style.backgroundColor = 'transparent';
      tab.style.border = 'none';
      tab.style.borderBottom = '3px solid transparent';
      tab.style.borderRadius = '4px 4px 0 0';
      tab.style.cursor = 'pointer';
      tab.style.transition = 'all 0.2s ease';
    });

    // Create content containers
    const selectionContainer = contentEl.createDiv('pdf-selection-container');
    const pagesContainer = contentEl.createDiv('pages-container');
    const promptsContainer = contentEl.createDiv('prompts-container');

    pagesContainer.style.display = 'none';
    promptsContainer.style.display = 'none';

    // Set initial active tab
    selectionTab.classList.add('active');
    this.applyActiveTabStyles(selectionTab);

    // Tab switching logic
    selectionTab.addEventListener('click', () => {
      this.resetAllTabStyles([selectionTab, pagesTab, promptsTab]);
      selectionTab.classList.add('active');
      this.applyActiveTabStyles(selectionTab);
      selectionContainer.style.display = 'block';
      pagesContainer.style.display = 'none';
      promptsContainer.style.display = 'none';
    });

    pagesTab.addEventListener('click', async () => {
      if (!this.pdfPath) {
        new Notice('Please select a PDF first');
        return;
      }
      this.resetAllTabStyles([selectionTab, pagesTab, promptsTab]);
      pagesTab.classList.add('active');
      this.applyActiveTabStyles(pagesTab);
      selectionContainer.style.display = 'none';
      pagesContainer.style.display = 'block';
      promptsContainer.style.display = 'none';
      await this.loadPdfInfo();
      this.createPagesUI(pagesContainer);
    });

    promptsTab.addEventListener('click', () => {
      this.resetAllTabStyles([selectionTab, pagesTab, promptsTab]);
      promptsTab.classList.add('active');
      this.applyActiveTabStyles(promptsTab);
      selectionContainer.style.display = 'none';
      pagesContainer.style.display = 'none';
      promptsContainer.style.display = 'block';
      this.createPromptsUI(promptsContainer);
    });

    // Create initial UI
    this.createSelectionUI(selectionContainer);
  }

  private applyActiveTabStyles(tab: HTMLElement) {
    tab.style.backgroundColor = 'var(--interactive-accent)';
    tab.style.color = 'var(--text-on-accent)';
    tab.style.borderBottom = '3px solid var(--interactive-accent-hover)';
    tab.style.fontWeight = 'bold';
  }

  private resetAllTabStyles(tabs: HTMLElement[]) {
    tabs.forEach((tab) => {
      tab.classList.remove('active');
      tab.style.backgroundColor = 'transparent';
      tab.style.color = 'inherit';
      tab.style.borderBottom = '3px solid transparent';
      tab.style.fontWeight = 'normal';
    });
  }

  private createSelectionUI(container: HTMLElement) {
    container.empty();

    container.createEl('h3', { text: 'Select a PDF' });

    // Search input
    const searchInput = container.createEl('input', {
      type: 'text',
      placeholder: 'Search for PDF files...',
    });
    searchInput.style.width = '100%';
    searchInput.style.padding = '8px';
    searchInput.style.marginBottom = '10px';
    searchInput.style.boxSizing = 'border-box';

    // Search results
    this.searchResultsEl = container.createDiv('search-results');
    this.searchResultsEl.style.marginBottom = '15px';
    this.searchResultsEl.style.maxHeight = '300px';
    this.searchResultsEl.style.overflowY = 'auto';

    // Load PDFs
    this.loadAllPdfs();

    // Search functionality
    searchInput.addEventListener('input', (e) => {
      const query = (e.target as HTMLInputElement).value.toLowerCase();
      this.filteredPdfFiles = this.allPdfFiles.filter((f) => f.toLowerCase().includes(query));
      this.displaySearchResults();
    });

    this.displaySearchResults();

    // Selected PDF display
    const selectedDiv = container.createDiv();
    selectedDiv.createEl('h4', { text: 'Selected PDF' });
    const selectedPdfEl = selectedDiv.createEl('div');
    selectedPdfEl.style.padding = '10px';
    selectedPdfEl.style.backgroundColor = 'var(--background-secondary)';
    selectedPdfEl.style.borderRadius = '4px';
    selectedPdfEl.style.minHeight = '40px';
    selectedPdfEl.textContent = this.pdfPath || 'No PDF selected';

    // Content mode selector
    container.createEl('h3', { text: 'Processing Mode' });
    const modeSelect = container.createEl('select');
    modeSelect.style.width = '100%';
    modeSelect.style.padding = '8px';
    modeSelect.style.marginBottom = '10px';

    const modes = [
      { value: 'mixed', label: 'Mixed (Text & Diagrams)' },
      { value: 'text', label: 'Text Only' },
      { value: 'diagram', label: 'Diagrams Only' },
      { value: 'audio-sync', label: 'Audio-Sync (With Timestamps)' },
    ];

    modes.forEach((mode) => {
      const option = document.createElement('option');
      option.value = mode.value;
      option.textContent = mode.label;
      modeSelect.appendChild(option);
    });

    modeSelect.value = this.contentMode;
    modeSelect.addEventListener('change', (e) => {
      this.contentMode = (e.target as HTMLSelectElement).value as any;
    });

    // Process button
    const processBtn = container.createEl('button', { text: '▶️ Generate Transcription' });
    processBtn.style.width = '100%';
    processBtn.style.padding = '10px';
    processBtn.style.marginTop = '15px';
    processBtn.style.backgroundColor = 'var(--interactive-accent)';
    processBtn.style.color = 'var(--text-on-accent)';
    processBtn.style.border = 'none';
    processBtn.style.borderRadius = '4px';
    processBtn.style.cursor = 'pointer';
    processBtn.style.fontWeight = 'bold';

    processBtn.addEventListener('click', () => {
      if (!this.pdfPath) {
        new Notice('Please select a PDF first');
        return;
      }

      const customOptions: TranscriptionOptions = {
        textPrompt: this.customTextPrompt,
        diagramPrompt: this.customDiagramPrompt,
        mixedPrompt: this.customMixedPrompt,
        audioSyncPrompt: this.customAudioSyncPrompt,
        detectDiagrams: this.plugin.settings.detectDiagrams,
        contentMode: this.contentMode,
        selectedPages: this.selectedPages.length > 0 ? this.selectedPages : null,
      };

      this.onSubmit(this.pdfPath, customOptions);
      this.close();
    });
  }

  private createPagesUI(container: HTMLElement) {
    container.empty();

    if (this.numPagesInPdf === 0) {
      container.createEl('p', { text: 'Loading PDF information...' });
      return;
    }

    container.createEl('h3', { text: `Select Pages (Total: ${this.numPagesInPdf})` });

    const description = container.createEl('p');
    description.textContent = 'Click page numbers to toggle selection';
    description.style.color = 'var(--text-muted)';
    description.style.marginBottom = '15px';

    // Page grid
    const gridContainer = container.createDiv();
    gridContainer.style.display = 'grid';
    gridContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(50px, 1fr))';
    gridContainer.style.gap = '8px';
    gridContainer.style.marginBottom = '15px';

    for (let i = 1; i <= this.numPagesInPdf; i++) {
      const pageBtn = gridContainer.createEl('button', { text: String(i) });
      pageBtn.style.padding = '10px';
      pageBtn.style.textAlign = 'center';
      pageBtn.style.border = '1px solid var(--background-modifier-border)';
      pageBtn.style.borderRadius = '4px';
      pageBtn.style.cursor = 'pointer';

      if (this.selectedPages.includes(i)) {
        pageBtn.style.backgroundColor = 'var(--interactive-accent)';
        pageBtn.style.color = 'var(--text-on-accent)';
      }

      pageBtn.addEventListener('click', () => {
        if (this.selectedPages.includes(i)) {
          this.selectedPages = this.selectedPages.filter((p) => p !== i);
        } else {
          this.selectedPages.push(i);
          this.selectedPages.sort((a, b) => a - b);
        }
        this.createPagesUI(container);
      });
    }

    // Select all / Clear buttons
    const buttonGroup = container.createDiv();
    buttonGroup.style.display = 'flex';
    buttonGroup.style.gap = '8px';

    const selectAllBtn = buttonGroup.createEl('button', { text: 'Select All' });
    selectAllBtn.style.flex = '1';
    selectAllBtn.addEventListener('click', () => {
      this.selectedPages = Array.from({ length: this.numPagesInPdf }, (_, i) => i + 1);
      this.createPagesUI(container);
    });

    const clearBtn = buttonGroup.createEl('button', { text: 'Clear' });
    clearBtn.style.flex = '1';
    clearBtn.addEventListener('click', () => {
      this.selectedPages = [];
      this.createPagesUI(container);
    });
  }

  private createPromptsUI(container: HTMLElement) {
    container.empty();

    container.createEl('h3', { text: 'Custom Prompts' });

    const description = container.createEl('p');
    description.textContent = 'Customize how the AI processes your PDFs';
    description.style.color = 'var(--text-muted)';
    description.style.marginBottom = '15px';

    // Text prompt
    container.createEl('h4', { text: 'Text Transcription' });
    const textArea = container.createEl('textarea');
    textArea.value = this.customTextPrompt;
    textArea.style.width = '100%';
    textArea.style.height = '80px';
    textArea.style.marginBottom = '15px';
    textArea.style.padding = '8px';
    textArea.style.boxSizing = 'border-box';
    textArea.addEventListener('change', (e) => {
      this.customTextPrompt = (e.target as HTMLTextAreaElement).value;
    });

    // Mixed prompt
    container.createEl('h4', { text: 'Mixed Content' });
    const mixedArea = container.createEl('textarea');
    mixedArea.value = this.customMixedPrompt;
    mixedArea.style.width = '100%';
    mixedArea.style.height = '80px';
    mixedArea.style.marginBottom = '15px';
    mixedArea.style.padding = '8px';
    mixedArea.style.boxSizing = 'border-box';
    mixedArea.addEventListener('change', (e) => {
      this.customMixedPrompt = (e.target as HTMLTextAreaElement).value;
    });

    // Audio sync prompt
    container.createEl('h4', { text: 'Audio-Sync (With Timestamps)' });
    const audioArea = container.createEl('textarea');
    audioArea.value = this.customAudioSyncPrompt;
    audioArea.style.width = '100%';
    audioArea.style.height = '100px';
    audioArea.style.marginBottom = '15px';
    audioArea.style.padding = '8px';
    audioArea.style.boxSizing = 'border-box';
    audioArea.addEventListener('change', (e) => {
      this.customAudioSyncPrompt = (e.target as HTMLTextAreaElement).value;
    });

    // Diagram prompt
    container.createEl('h4', { text: 'Diagram Conversion' });
    const diagArea = container.createEl('textarea');
    diagArea.value = this.customDiagramPrompt;
    diagArea.style.width = '100%';
    diagArea.style.height = '80px';
    diagArea.style.padding = '8px';
    diagArea.style.boxSizing = 'border-box';
    diagArea.addEventListener('change', (e) => {
      this.customDiagramPrompt = (e.target as HTMLTextAreaElement).value;
    });
  }

  private loadAllPdfs() {
    this.allPdfFiles = [];
    this.app.vault.getFiles().forEach((file) => {
      if (file.extension === 'pdf') {
        this.allPdfFiles.push(file.path);
      }
    });
    this.filteredPdfFiles = [...this.allPdfFiles];
  }

  private displaySearchResults() {
    if (!this.searchResultsEl) return;

    this.searchResultsEl.empty();

    if (this.filteredPdfFiles.length === 0) {
      const noResults = this.searchResultsEl.createEl('p', { text: 'No PDFs found' });
      noResults.style.color = 'var(--text-muted)';
      return;
    }

    this.filteredPdfFiles.slice(0, 20).forEach((file) => {
      const resultItem = this.searchResultsEl!.createDiv('search-result-item');
      resultItem.textContent = file;
      resultItem.style.padding = '8px 12px';
      resultItem.style.cursor = 'pointer';
      resultItem.style.borderBottom = '1px solid var(--background-modifier-border)';

      resultItem.addEventListener('mouseenter', () => {
        resultItem.style.backgroundColor = 'var(--background-modifier-hover)';
      });

      resultItem.addEventListener('mouseleave', () => {
        resultItem.style.backgroundColor = 'transparent';
      });

      resultItem.addEventListener('click', () => {
        this.pdfPath = file;
        this.selectedPages = [];
        this.displaySearchResults();
      });
    });
  }

  private async loadPdfInfo() {
    try {
      const processor = new PDFProcessor(this.app);
      const pdfBuffer = await processor.readPDFFile(this.pdfPath);
      if (!pdfBuffer) {
        throw new Error('Could not read PDF');
      }
      this.numPagesInPdf = await processor.getPageCount(pdfBuffer);
    } catch (error) {
      console.error('Error loading PDF info:', error);
      new Notice('Error loading PDF information');
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
