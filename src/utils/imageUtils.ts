import { App, TFile, FileSystemAdapter } from 'obsidian';

export const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'];

export async function readImageFile(
  app: App,
  filePath: string
): Promise<string | null> {
  try {
    const vaultFile = app.vault.getAbstractFileByPath(filePath);

    let buffer: ArrayBuffer;

    if (vaultFile instanceof TFile) {
      buffer = await app.vault.readBinary(vaultFile);
    } else {
      const adapter = app.vault.adapter;
      if (adapter instanceof FileSystemAdapter) {
        const basePath = adapter.getBasePath();
        const absolutePath = filePath.startsWith('/') || filePath.includes(':\\')
          ? filePath
          : `${basePath}/${filePath}`;
        const fs = require('fs').promises;
        buffer = await fs.readFile(absolutePath);
      } else {
        return null;
      }
    }

    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'jpeg';
    const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;

    const base64 = arrayBufferToBase64(buffer);
    return `data:${mimeType};base64,${base64}`;

  } catch (error) {
    console.error('Error reading image file:', error);
    return null;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
