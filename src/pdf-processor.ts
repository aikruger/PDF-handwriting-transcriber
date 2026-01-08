/**
 * PDF Processing Engine
 * Handles PDF rendering, page processing, and transcription
 */

import { App, TFile, FileSystemAdapter } from 'obsidian';
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
   * Read PDF file from vault or filesystem
   */
  async readPDFFile(filePath: string): Promise<ArrayBuffer | null> {
    try {
      const vaultFile = this.app.vault.getAbstractFileByPath(filePath);
      if (vaultFile instanceof TFile) {
        const arrayBuffer = await this.app.vault.readBinary(vaultFile);
        return arrayBuffer;
      }

      const adapter = this.app.vault.adapter;
      if (adapter instanceof FileSystemAdapter) {
        const basePath = adapter.getBasePath();
        const absolutePath =
          filePath.startsWith('/') || filePath.includes(':\\\\')
            ? filePath
            : `${basePath}/${filePath}`;

        const fs = require('fs').promises;
        return await fs.readFile(absolutePath);
      }

      return null;
    } catch (error) {
      console.error('Error reading PDF:', error);
      return null;
    }
  }

  /**
   * Load PDF.js library dynamically
   */
  async loadPDFLibrary(): Promise<void> {
    if (window.pdfjsLib) {
      return;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PDF_JS_URL;
      script.onload = resolve as any;
      script.onerror = () => reject(new Error('Failed to load PDF.js'));
      document.head.appendChild(script);
    });
  }

  /**
   * Get number of pages in PDF
   */
  async getPageCount(pdfBuffer: ArrayBuffer): Promise<number> {
    await this.loadPDFLibrary();

    const loadingTask = window.pdfjsLib.getDocument({ data: pdfBuffer });
    const pdf = await loadingTask.promise;
    return pdf.numPages;
  }

  /**
   * Render PDF pages to images
   */
  async renderPagesToImages(
    pdfBuffer: ArrayBuffer,
    pageNumbers: number[],
    renderScale: number = 2.0,
    imageQuality: number = 0.9
  ): Promise<PageRenderResult[]> {
    await this.loadPDFLibrary();

    const loadingTask = window.pdfjsLib.getDocument({ data: pdfBuffer });
    const pdf = await loadingTask.promise;

    const results: PageRenderResult[] = [];

    for (const pageNum of pageNumbers) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Could not get canvas context');
      }

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;

      const qualityFinal = Math.min(Math.max(0.1, imageQuality), 1.0);
      const imageDataUrl = canvas.toDataURL('image/jpeg', qualityFinal);

      results.push({
        pageNum,
        imageDataUrl,
      });
    }

    return results;
  }

  /**
   * Validate and normalize page range
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
