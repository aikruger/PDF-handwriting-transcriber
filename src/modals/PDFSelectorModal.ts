/**
 * PDF Selector Modal
 * User interface for selecting PDFs and configuring transcription
 */

import { App, Modal, Notice } from 'obsidian';

export interface TranscriptionOptions {
  textPrompt?: string;
  diagramPrompt?: string;
  mixedPrompt?: string;
  audioSyncPrompt?: string;
  detectDiagrams?: boolean;
  contentMode?: 'text' | 'diagram' | 'mixed';
  selectedPages?: number[] | null;
}




export class PDFSelectorModal extends Modal {
  private plugin: any;
  private onSubmit: (pdfPath: string, options: TranscriptionOptions) => void;
  private pdfPath: string = '';
  private allPdfFiles: string[] = [];
  private filteredPdfFiles: string[] = [];
  private searchResultsEl: HTMLElement | null = null;
  private selectedPages: number[] = [];
  private numPagesInPdf: number = 0;
  private contentMode: 'text' | 'diagram' | 'mixed' = 'mixed';
  private customTextPrompt: string;
  private customDiagramPrompt: string;
  private customMixedPrompt: string;
  private detectDiagrams: boolean;


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
    this.detectDiagrams = plugin.settings.detectDiagrams;
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

    // ✅ SELECTED PDF DISPLAY (MOVED UP)
    const selectedDiv = container.createDiv();
    selectedDiv.createEl('h4', { text: 'Selected PDF' });

    // Create persistent element for selected PDF
    const selectedPdfEl = selectedDiv.createEl('div');
    selectedPdfEl.id = 'selected-pdf-display';  // ✅ Give it an ID
    selectedPdfEl.style.padding = '10px';
    selectedPdfEl.style.backgroundColor = 'var(--background-secondary)';
    selectedPdfEl.style.borderRadius = '4px';
    selectedPdfEl.style.minHeight = '40px';
    selectedPdfEl.style.border = '2px solid var(--background-modifier-border)';
    selectedPdfEl.style.marginBottom = '15px';

    // Initial display
    this.updateSelectedPdfDisplay(selectedPdfEl);

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

      // Provider configuration guard
      if (!this.plugin.activeProvider.isConfigured()) {
        new Notice(this.plugin.activeProvider.getConfigurationStatus());
        return;
      }

      const customOptions: TranscriptionOptions = {
        textPrompt: this.customTextPrompt,
        diagramPrompt: this.customDiagramPrompt,
        mixedPrompt: this.customMixedPrompt,

        detectDiagrams: this.detectDiagrams,
        contentMode: this.contentMode,
        selectedPages: this.selectedPages.length > 0 ? this.selectedPages : null,
      };

      this.onSubmit(this.pdfPath, customOptions);
      this.close();
    });
  }

  // ✅ NEW METHOD: Update selected PDF display
  private updateSelectedPdfDisplay(element: HTMLElement) {
    element.empty();

    if (!this.pdfPath) {
      element.textContent = 'No PDF selected';
      element.style.color = 'var(--text-muted)';
      element.style.fontStyle = 'italic';
    } else {
      const fileName = this.pdfPath.split('/').pop();
      const folderPath = this.pdfPath.substring(0, this.pdfPath.lastIndexOf('/'));

      // Create formatted display
      element.style.color = 'var(--text-normal)';
      element.style.fontStyle = 'normal';

      const nameEl = element.createEl('strong', { text: fileName });
      nameEl.style.display = 'block';
      nameEl.style.marginBottom = '4px';
      nameEl.style.fontSize = '14px';

      const pathEl = element.createEl('small', { text: `📁 ${folderPath}` });
      pathEl.style.color = 'var(--text-muted)';
      pathEl.style.display = 'block';
    }
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
      const noResults = this.searchResultsEl.createEl('p', { text: '📭 No PDFs found' });
      noResults.style.color = 'var(--text-muted)';
      noResults.style.padding = '10px';
      return;
    }

    this.filteredPdfFiles.slice(0, 25).forEach((file) => {
      const resultItem = this.searchResultsEl!.createDiv('search-result-item');
      resultItem.style.padding = '8px 12px';
      resultItem.style.cursor = 'pointer';
      resultItem.style.borderBottom = '1px solid var(--background-modifier-border)';
      resultItem.style.transition = 'all 0.15s ease';

      // File name + path
      const fileName = file.split('/').pop();
      const folderPath = file.substring(0, file.lastIndexOf('/'));

      const nameEl = resultItem.createEl('div', { text: fileName });
      nameEl.style.fontWeight = '500';
      nameEl.style.marginBottom = '2px';

      const pathEl = resultItem.createEl('small', { text: folderPath });
      pathEl.style.color = 'var(--text-muted)';

      // Highlight if selected
      if (file === this.pdfPath) {
        resultItem.style.backgroundColor = 'var(--background-modifier-hover)';
        resultItem.style.borderLeft = '3px solid var(--interactive-accent)';
        resultItem.style.paddingLeft = '9px';
        nameEl.style.color = 'var(--interactive-accent)';
      }

      // Click handler
      resultItem.addEventListener('mouseenter', () => {
        if (file !== this.pdfPath) {
          resultItem.style.backgroundColor = 'var(--background-modifier-hover)';
        }
      });

      resultItem.addEventListener('mouseleave', () => {
        if (file !== this.pdfPath) {
          resultItem.style.backgroundColor = 'transparent';
        }
      });

      resultItem.addEventListener('click', () => {
        // ✅ UPDATE STATE
        this.pdfPath = file;
        this.selectedPages = [];

        // ✅ IMMEDIATELY UPDATE DISPLAY
        const displayEl = document.getElementById('selected-pdf-display');
        if (displayEl) {
          this.updateSelectedPdfDisplay(displayEl);
        }

        // ✅ REFRESH SEARCH RESULTS with highlighting
        this.displaySearchResults();

        new Notice(`✅ Selected: ${file.split('/').pop()}`);
      });
    });
  }

  private async loadPdfInfo() {
    try {
      const processor = this.plugin;
      const pdfBuffer = await processor.readPDFFile(this.pdfPath);
      if (!pdfBuffer) {
        throw new Error('Could not read PDF');
      }
      const loadingTask = (window as any).pdfjsLib.getDocument({ data: pdfBuffer });
      const pdf = await loadingTask.promise;
      this.numPagesInPdf = pdf.numPages;
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
