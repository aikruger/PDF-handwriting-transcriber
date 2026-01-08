/**
 * Audio Extraction Engine
 * Extracts embedded audio from PDF files
 */

import { App, TFile, FileSystemAdapter, Notice } from 'obsidian';
import { AudioExtractionResult } from './types';
import { getExtensionFromMimeType } from './utils';

export class PDFAudioExtractor {
  /**
   * Extract audio from PDF buffer
   */
  static async extractAudioFromPDF(pdfBuffer: ArrayBuffer): Promise<AudioExtractionResult> {
    try {
      console.log('Starting PDF audio extraction...');

      const pdfData = new Uint8Array(pdfBuffer);

      // Try method 1: Search for audio streams
      let audioData = PDFAudioExtractor.findAudioInStream(pdfData);
      if (audioData && audioData.length > 1000) {
        console.log('Audio found using stream method');
        return {
          audioBuffer: audioData.buffer as ArrayBuffer,
          mimeType: PDFAudioExtractor.detectMimeType(audioData),
          found: true,
          method: 'stream',
        };
      }

      // Try method 2: Look for embedded files
      audioData = PDFAudioExtractor.findEmbeddedAudio(pdfData);
      if (audioData && audioData.length > 1000) {
        console.log('Audio found using embedded file method');
        return {
          audioBuffer: audioData.buffer as ArrayBuffer,
          mimeType: PDFAudioExtractor.detectMimeType(audioData),
          found: true,
          method: 'embedded',
        };
      }

      console.log('No audio found in PDF');
      return { audioBuffer: null, mimeType: null, found: false };
    } catch (error) {
      console.error('Audio extraction error:', error);
      return { audioBuffer: null, mimeType: null, found: false };
    }
  }

  /**
   * Find audio streams in PDF
   */
  private static findAudioInStream(pdfData: Uint8Array): Uint8Array | null {
    try {
      const signatures = [
        { sig: [0xff, 0xfb], desc: 'MP3' },
        { sig: [0xff, 0xfa], desc: 'MP3' },
        { sig: [0xff, 0xf1], desc: 'AAC' },
        { sig: [0xff, 0xf9], desc: 'AAC' },
        { sig: [0x4f, 0x67, 0x67], desc: 'OGG' },
        { sig: [0x52, 0x49, 0x46, 0x46], desc: 'WAV' },
      ];

      for (const { sig, desc } of signatures) {
        for (let i = 0; i < pdfData.length - sig.length; i++) {
          let match = true;
          for (let j = 0; j < sig.length; j++) {
            if (pdfData[i + j] !== sig[j]) {
              match = false;
              break;
            }
          }

          if (match) {
            console.log(`Found ${desc} audio at offset ${i}`);
            const endOffset = i + PDFAudioExtractor.findAudioEnd(pdfData, i);

            if (endOffset > i + 1000) {
              return pdfData.slice(i, endOffset);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error finding audio in stream:', error);
    }
    return null;
  }

  /**
   * Find end of audio stream by looking for zero bytes
   */
  private static findAudioEnd(pdfData: Uint8Array, startOffset: number): number {
    const maxSearch = Math.min(startOffset + 20000000, pdfData.length);

    let zeroCount = 0;
    for (let i = startOffset + 100; i < maxSearch; i++) {
      if (pdfData[i] === 0x00) {
        zeroCount++;
        if (zeroCount > 100) {
          return i - startOffset;
        }
      } else {
        zeroCount = 0;
      }
    }

    return Math.min(20000000, maxSearch - startOffset);
  }

  /**
   * Find embedded audio files in PDF
   */
  private static findEmbeddedAudio(pdfData: Uint8Array): Uint8Array | null {
    try {
      const maxStringLength = Math.min(pdfData.length, 1000000);
      let pdfString = '';
      for (let i = 0; i < maxStringLength; i++) {
        const char = pdfData[i];
        if ((char >= 32 && char <= 126) || char === 10 || char === 13) {
          pdfString += String.fromCharCode(char);
        }
      }

      const filePatterns = [
        /\/F\s*\(([^)]*\.mp3[^)]*)\)/i,
        /\/F\s*\(([^)]*\.m4a[^)]*)\)/i,
        /\/F\s*\(([^)]*\.wav[^)]*)\)/i,
        /\/Fname\s*\(([^)]*\.mp3[^)]*)\)/i,
      ];

      for (const pattern of filePatterns) {
        const match = pattern.exec(pdfString);
        if (match && match[1]) {
          console.log(`Found audio file reference: ${match[1]}`);
          return new Uint8Array([0xff, 0xfb]);
        }
      }
    } catch (error) {
      console.error('Error finding embedded files:', error);
    }
    return null;
  }

  /**
   * Detect MIME type from audio data
   */
  static detectMimeType(audioBuffer: Uint8Array): string {
    if (!audioBuffer || audioBuffer.length < 4) return 'audio/mpeg';

    // MP3
    if (audioBuffer[0] === 0xff && (audioBuffer[1] & 0xe0) === 0xe0) {
      return 'audio/mpeg';
    }

    // AAC
    if (audioBuffer[0] === 0xff && (audioBuffer[1] === 0xf1 || audioBuffer[1] === 0xf9)) {
      return 'audio/aac';
    }

    // OGG
    if (audioBuffer[0] === 0x4f && audioBuffer[1] === 0x67 && audioBuffer[2] === 0x67) {
      return 'audio/ogg';
    }

    // WAV
    if (
      audioBuffer[0] === 0x52 &&
      audioBuffer[1] === 0x49 &&
      audioBuffer[2] === 0x46 &&
      audioBuffer[3] === 0x46
    ) {
      return 'audio/wav';
    }

    // M4A
    if (
      audioBuffer[4] === 0x66 &&
      audioBuffer[5] === 0x74 &&
      audioBuffer[6] === 0x79 &&
      audioBuffer[7] === 0x70
    ) {
      return 'audio/mp4';
    }

    return 'audio/mpeg';
  }

  /**
   * Save extracted audio to Obsidian vault
   */
  static async saveAudioToVault(
    app: App,
    audioBuffer: ArrayBuffer,
    mimeType: string,
    pdfName: string
  ): Promise<string> {
    try {
      if (!audioBuffer || audioBuffer.byteLength === 0) {
        throw new Error('No audio data to save');
      }

      const ext = getExtensionFromMimeType(mimeType);

      const baseName = pdfName.replace('.pdf', '').replace(/[^a-z0-9-]/gi, '_');
      const timestamp = new Date().toISOString().slice(0, 10);
      const audioFileName = `${baseName}-${timestamp}.${ext}`;

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const audioFolder = `Audio/${year}-${month}`;

      // Create folder if needed
      try {
        const folder = app.vault.getAbstractFileByPath(audioFolder);
        if (!folder) {
          await app.vault.createFolder(audioFolder);
        }
      } catch (e) {
        // Folder might already exist
      }

      const audioPath = `${audioFolder}/${audioFileName}`;
      await app.vault.createBinary(audioPath, audioBuffer);

      console.log(`Audio extracted and saved to: ${audioPath}`);
      return audioPath;
    } catch (error) {
      console.error('Error saving audio to vault:', error);
      throw error;
    }
  }
}
