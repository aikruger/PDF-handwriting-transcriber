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
  private contentMode: 'text' | 'diagram' | 'mixed' = 'mixed';
  private customTextPrompt: string;
  private customDiagramPrompt: string;
  private customMixedPrompt: string;

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
    this.contentMode = plugin.settings.contentMode;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pdf-transcriber-modal');

    contentEl.createEl('h2', { text: '📄 PDF Transcriber' });

    // --- Tabs ---
    const tabsContainer = contentEl.createDiv();
    tabsContainer.style.cssText =
      'display:flex;margin-bottom:20px;border-bottom:1px solid var(--background-modifier-border)';

    const selectionTab = tabsContainer.createEl('button', { text: '📄 Select PDF' });
    const pagesTab = tabsContainer.createEl('button', { text: '📑 Pages' });
    const promptsTab = tabsContainer.createEl('button', { text: '✏️ Prompts' });

    const applyTabStyle = (btn: HTMLElement, active: boolean) => {
      btn.style.cssText = `
        flex:1;padding:8px 16px;background:${active ? 'var(--interactive-accent)' : 'transparent'};
        color:${active ? 'var(--text-on-accent)' : 'inherit'};border:none;
        border-bottom:3px solid ${active ? 'var(--interactive-accent-hover)' : 'transparent'};
        border-radius:4px 4px 0 0;cursor:pointer;font-weight:${active ? 'bold' : 'normal'};
      `;
    };

    applyTabStyle(selectionTab, true);
    applyTabStyle(pagesTab, false);
    applyTabStyle(promptsTab, false);

    // --- Content panes ---
    const selectionContainer = contentEl.createDiv();
    const pagesContainer = contentEl.createDiv();
    const promptsContainer = contentEl.createDiv();
    pagesContainer.style.display = 'none';
    promptsContainer.style.display = 'none';

    const switchTab = (active: 'selection' | 'pages' | 'prompts') => {
      applyTabStyle(selectionTab, active === 'selection');
      applyTabStyle(pagesTab, active === 'pages');
      applyTabStyle(promptsTab, active === 'prompts');
      selectionContainer.style.display = active === 'selection' ? 'block' : 'none';
      pagesContainer.style.display = active === 'pages' ? 'block' : 'none';
      promptsContainer.style.display = active === 'prompts' ? 'block' : 'none';
    };

    selectionTab.addEventListener('click', () => switchTab('selection'));

    pagesTab.addEventListener('click', async () => {
      if (!this.pdfPath) { new Notice('Please select a PDF first'); return; }
      switchTab('pages');
      if (this.numPagesInPdf === 0) await this.loadPdfInfo();
      this.renderPagesUI(pagesContainer);
    });

    promptsTab.addEventListener('click', () => {
      switchTab('prompts');
      this.renderPromptsUI(promptsContainer);
    });

    this.renderSelectionUI(selectionContainer);
  }

  // ---- Selection Tab ----
  private renderSelectionUI(container: HTMLElement) {
    container.empty();
    container.createEl('h3', { text: 'Search for a PDF in your vault' });

    const searchInput = container.createEl('input', {
      type: 'text',
      placeholder: 'Type to filter PDF files...',
    });
    searchInput.style.cssText = 'width:100%;padding:8px;margin-bottom:10px;box-sizing:border-box;';

    this.searchResultsEl = container.createDiv();
    this.searchResultsEl.style.cssText = 'max-height:260px;overflow-y:auto;margin-bottom:15px;border:1px solid var(--background-modifier-border);border-radius:4px;';

    this.loadAllPdfs();
    this.renderSearchResults();

    searchInput.addEventListener('input', (e) => {
      const q = (e.target as HTMLInputElement).value.toLowerCase();
      this.filteredPdfFiles = this.allPdfFiles.filter((f) => f.toLowerCase().includes(q));
      this.renderSearchResults();
    });

    container.createEl('h4', { text: 'Selected file' });
    const selectedDisplay = container.createDiv();
    selectedDisplay.id = 'selected-pdf-display';
    selectedDisplay.style.cssText =
      'padding:10px;background:var(--background-secondary);border-radius:4px;min-height:40px;margin-bottom:15px;border:2px solid var(--background-modifier-border);';
    this.updateSelectedDisplay(selectedDisplay);

    container.createEl('h3', { text: 'Content mode' });
    const modeSelect = container.createEl('select');
    modeSelect.style.cssText = 'width:100%;padding:8px;margin-bottom:10px;';

    const modes = [
      { value: 'mixed', label: 'Mixed (Text & Diagrams)' },
      { value: 'text', label: 'Text Only' },
      { value: 'diagram', label: 'Diagrams Only' },
    ];
    modes.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      modeSelect.appendChild(opt);
    });
    modeSelect.value = this.contentMode;
    modeSelect.addEventListener('change', (e) => {
      this.contentMode = (e.target as HTMLSelectElement).value as 'text' | 'diagram' | 'mixed';
    });

    const processBtn = container.createEl('button', { text: '▶️ Generate Transcription' });
    processBtn.style.cssText =
      'width:100%;padding:12px;margin-top:15px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:15px;';
    processBtn.addEventListener('click', () => {
      if (!this.pdfPath) { new Notice('Please select a PDF first'); return; }
      this.onSubmit(this.pdfPath, {
        textPrompt: this.customTextPrompt,
        diagramPrompt: this.customDiagramPrompt,
        mixedPrompt: this.customMixedPrompt,
        detectDiagrams: this.plugin.settings.detectDiagrams,
        contentMode: this.contentMode,
        selectedPages: this.selectedPages.length > 0 ? this.selectedPages : null,
      });
      this.close();
    });
  }

  private updateSelectedDisplay(el: HTMLElement) {
    el.empty();
    if (!this.pdfPath) {
      el.style.color = 'var(--text-muted)';
      el.style.fontStyle = 'italic';
      el.textContent = 'No PDF selected';
    } else {
      el.style.color = 'var(--text-normal)';
      el.style.fontStyle = 'normal';
      const name = el.createEl('strong', { text: this.pdfPath.split('/').pop() ?? '' });
      name.style.display = 'block';
      const folder = this.pdfPath.substring(0, this.pdfPath.lastIndexOf('/'));
      const path = el.createEl('small', { text: `📁 ${folder}` });
      path.style.color = 'var(--text-muted)';
    }
  }

  private loadAllPdfs() {
    this.allPdfFiles = this.app.vault.getFiles()
      .filter((f) => f.extension === 'pdf')
      .map((f) => f.path);
    this.filteredPdfFiles = [...this.allPdfFiles];
  }

  private renderSearchResults() {
    if (!this.searchResultsEl) return;
    this.searchResultsEl.empty();

    if (this.filteredPdfFiles.length === 0) {
      const msg = this.searchResultsEl.createEl('p', { text: '📭 No PDFs found' });
      msg.style.cssText = 'color:var(--text-muted);padding:10px;margin:0;';
      return;
    }

    this.filteredPdfFiles.slice(0, 30).forEach((filePath) => {
      const item = this.searchResultsEl!.createDiv();
      const isSelected = filePath === this.pdfPath;
      item.style.cssText = `
        padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--background-modifier-border);
        background:${isSelected ? 'var(--background-modifier-hover)' : 'transparent'};
        border-left:${isSelected ? '3px solid var(--interactive-accent)' : '3px solid transparent'};
      `;
      const name = item.createEl('div', { text: filePath.split('/').pop() ?? filePath });
      name.style.cssText = `font-weight:500;color:${isSelected ? 'var(--interactive-accent)' : 'inherit'};`;
      const folder = filePath.substring(0, filePath.lastIndexOf('/'));
      if (folder) {
        const small = item.createEl('small', { text: folder });
        small.style.color = 'var(--text-muted)';
      }

      item.addEventListener('mouseenter', () => {
        if (filePath !== this.pdfPath) item.style.background = 'var(--background-modifier-hover)';
      });
      item.addEventListener('mouseleave', () => {
        if (filePath !== this.pdfPath) item.style.background = 'transparent';
      });
      item.addEventListener('click', () => {
        this.pdfPath = filePath;
        this.selectedPages = [];
        this.numPagesInPdf = 0;
        const display = document.getElementById('selected-pdf-display');
        if (display) this.updateSelectedDisplay(display);
        this.renderSearchResults();
        new Notice(`✅ Selected: ${filePath.split('/').pop()}`);
      });
    });
  }

  // ---- Pages Tab ----
  private async loadPdfInfo() {
    try {
      const processor = new PDFProcessor(this.app);
      const buf = await processor.readPDFFile(this.pdfPath);
      if (!buf) throw new Error('Could not read PDF');
      this.numPagesInPdf = await processor.getPageCount(buf);
    } catch (err) {
      console.error('loadPdfInfo error:', err);
      new Notice('Error reading PDF page count');
    }
  }

  private renderPagesUI(container: HTMLElement) {
    container.empty();
    if (this.numPagesInPdf === 0) {
      container.createEl('p', { text: '⏳ Loading page count...' });
      return;
    }

    container.createEl('h3', { text: `Pages (${this.numPagesInPdf} total)` });
    const hint = container.createEl('p', { text: 'Click to toggle. Leave all unselected to process all pages.' });
    hint.style.color = 'var(--text-muted)';
    hint.style.marginBottom = '15px';

    const grid = container.createDiv();
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(48px,1fr));gap:6px;margin-bottom:15px;';

    for (let i = 1; i <= this.numPagesInPdf; i++) {
      const btn = grid.createEl('button', { text: String(i) });
      const active = this.selectedPages.includes(i);
      btn.style.cssText = `
        padding:8px 4px;text-align:center;border:1px solid var(--background-modifier-border);
        border-radius:4px;cursor:pointer;
        background:${active ? 'var(--interactive-accent)' : 'var(--background-secondary)'};
        color:${active ? 'var(--text-on-accent)' : 'inherit'};
      `;
      btn.addEventListener('click', () => {
        if (this.selectedPages.includes(i)) {
          this.selectedPages = this.selectedPages.filter((p) => p !== i);
        } else {
          this.selectedPages.push(i);
          this.selectedPages.sort((a, b) => a - b);
        }
        this.renderPagesUI(container);
      });
    }

    const btnRow = container.createDiv();
    btnRow.style.cssText = 'display:flex;gap:8px;';

    const selectAll = btnRow.createEl('button', { text: 'Select All' });
    selectAll.style.flex = '1';
    selectAll.addEventListener('click', () => {
      this.selectedPages = Array.from({ length: this.numPagesInPdf }, (_, i) => i + 1);
      this.renderPagesUI(container);
    });

    const clearAll = btnRow.createEl('button', { text: 'Clear' });
    clearAll.style.flex = '1';
    clearAll.addEventListener('click', () => {
      this.selectedPages = [];
      this.renderPagesUI(container);
    });

    if (this.selectedPages.length > 0) {
      const info = container.createEl('p', { text: `Selected: pages ${this.selectedPages.join(', ')}` });
      info.style.cssText = 'margin-top:10px;color:var(--text-muted);font-size:12px;';
    }
  }

  // ---- Prompts Tab ----
  private renderPromptsUI(container: HTMLElement) {
    container.empty();
    container.createEl('h3', { text: 'Custom Prompts' });
    const hint = container.createEl('p', { text: 'Override the prompts used for each content mode.' });
    hint.style.cssText = 'color:var(--text-muted);margin-bottom:15px;';

    const makeTextArea = (label: string, value: string, onChange: (v: string) => void) => {
      container.createEl('h4', { text: label });
      const ta = container.createEl('textarea');
      ta.value = value;
      ta.style.cssText = 'width:100%;height:90px;padding:8px;box-sizing:border-box;margin-bottom:15px;resize:vertical;';
      ta.addEventListener('input', (e) => onChange((e.target as HTMLTextAreaElement).value));
    };

    makeTextArea('Text Transcription', this.customTextPrompt, (v) => { this.customTextPrompt = v; });
    makeTextArea('Mixed Content (Text + Diagrams)', this.customMixedPrompt, (v) => { this.customMixedPrompt = v; });
    makeTextArea('Diagram Conversion (Mermaid)', this.customDiagramPrompt, (v) => { this.customDiagramPrompt = v; });
  }

  onClose() {
    this.contentEl.empty();
  }
}