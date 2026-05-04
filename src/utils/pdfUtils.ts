import { App, TFile, FileSystemAdapter } from 'obsidian';

// Dynamically loads PDF.js from CDN if not already loaded
// Preserve the exact CDN URL from original: https://unpkg.com/pdfjs-dist@3.8.162/build/pdf.min.js
export async function ensurePdfJsLoaded(): Promise<void> {
  if ((window as any).pdfjsLib) return;

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/pdfjs-dist@3.8.162/build/pdf.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load PDF.js library'));
    document.head.appendChild(script);
  });

  if (!(window as any).pdfjsLib) {
    throw new Error('PDF.js loaded but pdfjsLib not found on window');
  }
}

// Renders a single PDF page to a base64 JPEG data URL
// renderScale and imageQuality preserve original defaults (2.0 and 0.9)
export async function renderPageToDataUrl(
  pdf: any,
  pageNum: number,
  renderScale: number,
  imageQuality: number
): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: renderScale });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({ canvasContext: context, viewport }).promise;

  const quality = Math.min(Math.max(0.1, imageQuality), 1.0);
  return canvas.toDataURL('image/jpeg', quality);
}

// Reads a PDF from the Obsidian vault or filesystem
// Preserve original two-path logic (vault TFile first, then FileSystemAdapter)
export async function readPDFFile(
  app: App,
  filePath: string
): Promise<ArrayBuffer | null> {
  try {
    const vaultFile = app.vault.getAbstractFileByPath(filePath);
    if (vaultFile instanceof TFile) {
      return await app.vault.readBinary(vaultFile);
    }

    const adapter = app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      const basePath = adapter.getBasePath();
      const absolutePath = filePath.startsWith('/') || filePath.includes(':\\')
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

// White 1x1 JPEG — used for text-only cloud prompts that need an image parameter
export const RANKING_PLACEHOLDER_IMAGE =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=';
