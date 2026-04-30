/**
 * PDF Processing Engine
 * Handles PDF rendering and page processing using PDF.js loaded from CDN.
 */

import { App, TFile } from 'obsidian';
import { PDF_JS_URL } from './constants';
import { PageRenderResult } from './types';

declare global {
  interface Window {
    pdfjsLib: any;
  }
}

export class PDFProcessor {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Read a PDF file from the vault and return its bytes.
   * Clones the buffer to prevent detachment during multi-step processing.
   */
  async readPDFFile(filePath: string): Promise<ArrayBuffer | null> {
    try {
      const vaultFile = this.app.vault.getAbstractFileByPath(filePath);
      if (vaultFile instanceof TFile) {
        const arrayBuffer = await this.app.vault.readBinary(vaultFile);
        // Clone to prevent detachment by later operations
        const clonedBuffer = arrayBuffer.slice(0);
        console.log(`Read PDF: ${clonedBuffer.byteLength} bytes`);
        return clonedBuffer;
      }
      console.error('File not found in vault:', filePath);
      return null;
    } catch (error) {
      console.error('Error reading PDF:', error);
      return null;
    }
  }

  /**
   * Load PDF.js from CDN if not already loaded.
   */
  async loadPDFLibrary(): Promise<void> {
    if (window.pdfjsLib) {
      if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://unpkg.com/pdfjs-dist@3.8.162/build/pdf.worker.min.js';
      }
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PDF_JS_URL;
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://unpkg.com/pdfjs-dist@3.8.162/build/pdf.worker.min.js';
        }
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load PDF.js from CDN'));
      document.head.appendChild(script);
    });
  }

  /**
   * Return the total number of pages in a PDF buffer.
   */
  async getPageCount(pdfBuffer: ArrayBuffer): Promise<number> {
    await this.loadPDFLibrary();
    const safeBuffer = pdfBuffer.slice(0);
    const loadingTask = window.pdfjsLib.getDocument({ data: safeBuffer });
    const pdf = await loadingTask.promise;
    return pdf.numPages;
  }

  /**
   * Render the specified pages of a PDF to JPEG data URLs.
   * @param pdfBuffer     Raw PDF bytes
   * @param pageNumbers   Array of 1-based page numbers to render
   * @param renderScale   Resolution multiplier (2.0 recommended)
   * @param imageQuality  JPEG quality 0.1–1.0 (0.9 recommended)
   */
  async renderPagesToImages(
    pdfBuffer: ArrayBuffer,
    pageNumbers: number[],
    renderScale: number = 1.5,
    imageQuality: number = 0.85
  ): Promise<PageRenderResult[]> {
    await this.loadPDFLibrary();

    const safeBuffer = pdfBuffer.slice(0);
    const loadingTask = window.pdfjsLib.getDocument({ data: safeBuffer });
    const pdf = await loadingTask.promise;

    const results: PageRenderResult[] = [];

    for (const pageNum of pageNumbers) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error(`Could not get canvas 2D context for page ${pageNum}`);
      }

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      // White background — important for handwriting on white paper
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: context, viewport }).promise;

      const quality = Math.min(Math.max(0.1, imageQuality), 1.0);
      const imageDataUrl = canvas.toDataURL('image/jpeg', quality);

      results.push({ pageNum, imageDataUrl });
      page.cleanup();
    }

    return results;
  }

  /**
   * Resolve which pages to process based on user settings and any manual selection.
   */
  normalizePagesRange(
    selectedPages: number[] | null,
    pageStart: number,
    pageEnd: number,
    maxPages: number,
    totalPages: number
  ): number[] {
    if (selectedPages && selectedPages.length > 0) {
      return selectedPages.filter((p) => p > 0 && p <= totalPages);
    }

    const start = Math.max(1, pageStart || 1);
    const maxPossible = Math.min(totalPages, maxPages || 50);
    const end = pageEnd > 0 ? Math.min(pageEnd, maxPossible) : maxPossible;

    const pages: number[] = [];
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }
}