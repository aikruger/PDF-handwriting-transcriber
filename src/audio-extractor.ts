/**
 * PDF Audio Extraction Engine - Compression-Aware with Fallback
 * 
 * COMPLETE IMPLEMENTATION with:
 * - Method 1: Extract from PDF Sound objects (handles zlib compression)
 * - Method 2: Fallback to scattered MP3 frame collection
 * - All helper methods fully implemented
 * - Zero missing method references
 */

import { App, TFile } from 'obsidian';
import { AudioExtractionResult } from './types';
import { getExtensionFromMimeType } from './utils';

export class PDFAudioExtractor {
  
  /**
   * Main entry point for audio extraction
   * Attempts Method 1 (Sound Objects), falls back to Method 2 (Scattered Frames)
   */
  static async extractAudioFromPDF(pdfBuffer: ArrayBuffer): Promise<AudioExtractionResult> {
    try {
      console.log('🎵 Starting PDF audio extraction with compression support...');

      if (!pdfBuffer || pdfBuffer.byteLength === 0) {
        console.warn('Audio extraction: Empty PDF buffer');
        return { audioBuffer: null, mimeType: null, found: false };
      }

      const pdfData = new Uint8Array(pdfBuffer);
      console.log(`Processing PDF buffer: ${pdfData.length} bytes`);

      // ===== METHOD 1: Extract from PDF Sound Objects (with compression handling) =====
      console.log('📋 Method 1: Analyzing PDF Objects for Sound streams...');
      try {
        const audioData = await this.extractSoundObjects(pdfData);
        if (audioData && audioData.length > 10000) {
          console.log(`✅ Method 1 succeeded: ${audioData.length} extracted bytes`);
          return {
            audioBuffer: audioData.buffer as ArrayBuffer,
            mimeType: 'audio/mpeg',
            found: true,
            method: 'sound-objects',
          };
        }
      } catch (error) {
        console.log(`⚠️ Method 1 failed: ${error}`);
      }

      // ===== METHOD 2: Fallback to Scattered MP3 Frame Collection =====
      console.log('⚠️ Method 1 failed or insufficient data, attempting Method 2: Scattered frame collection...');
      try {
        const audioData = this.extractMp3Audio(pdfData);
        if (audioData && audioData.length > 10000) {
          console.log(`✅ Method 2 succeeded: ${audioData.length} extracted bytes`);
          return {
            audioBuffer: audioData.buffer as ArrayBuffer,
            mimeType: 'audio/mpeg',
            found: true,
            method: 'scattered-frames',
          };
        }
      } catch (error) {
        console.log(`⚠️ Method 2 also failed: ${error}`);
      }

      console.log('❌ No audio extraction method succeeded');
      return { audioBuffer: null, mimeType: null, found: false };

    } catch (error) {
      console.error('Audio extraction error:', error);
      return { audioBuffer: null, mimeType: null, found: false };
    }
  }

  /**
   * METHOD 1: Extract audio from PDF Sound objects
   * Handles zlib-compressed streams and embedded audio
   */
  private static async extractSoundObjects(pdfData: Uint8Array): Promise<Uint8Array | null> {
    console.log('  🔍 Scanning for PDF Sound streams...');

    try {
      // Find all stream objects in PDF
      const streams = this.findAllStreams(pdfData);
      console.log(`  Found ${streams.length} total stream objects`);

      // Look for streams with audio content
      let foundAudio = false;

      for (let i = 0; i < streams.length; i++) {
        const stream = streams[i];
        if (!stream) continue;

        const streamData = pdfData.slice(stream.start, stream.end);

        // Check if this stream is zlib-compressed
        const isCompressed = streamData.length > 2 && 
                            streamData[0] === 0x78 && 
                            (streamData[1] === 0x9c || streamData[1] === 0xda || streamData[1] === 0x01);

        if (isCompressed) {
          console.log(`    Stream #${i} at offset ${stream.start}: zlib-compressed (${streamData.length} bytes)`);
          
          try {
            // Attempt decompression
            const decompressed = await this.decompressStream(streamData);
            if (decompressed && decompressed.length > streamData.length * 0.5) {
              // Check if decompressed data contains MP3 or AAC frames
              const mp3Count = this.countMp3Frames(decompressed);
              const aacCount = this.countAacFrames(decompressed);

              if (mp3Count > 0) {
                console.log(`      ✓ Found ${mp3Count} MP3 frames in decompressed stream`);
                const audioData = this.extractAudioFromDecompressed(decompressed, 'mp3');
                if (audioData && audioData.length > 10000) {
                  console.log(`      ✅ Successfully extracted audio: ${audioData.length} bytes`);
                  foundAudio = true;
                  return audioData;
                }
              } else if (aacCount > 0) {
                console.log(`      ✓ Found ${aacCount} AAC frames in decompressed stream`);
                const audioData = this.extractAudioFromDecompressed(decompressed, 'aac');
                if (audioData && audioData.length > 10000) {
                  console.log(`      ✅ Successfully extracted audio: ${audioData.length} bytes`);
                  foundAudio = true;
                  return audioData;
                }
              }
            }
          } catch (decompressError) {
            console.log(`      ✗ Decompression failed: ${decompressError}`);
          }
        } else {
          // Check if uncompressed stream contains audio frames
          const mp3Count = this.countMp3Frames(streamData);
          const aacCount = this.countAacFrames(streamData);

          if (mp3Count > 3 || aacCount > 3) {
            console.log(`    Stream #${i} contains audio frames (MP3: ${mp3Count}, AAC: ${aacCount})`);
            const audioData = mp3Count > 0 ? 
              this.extractAudioFromDecompressed(streamData, 'mp3') :
              this.extractAudioFromDecompressed(streamData, 'aac');
            
            if (audioData && audioData.length > 10000) {
              console.log(`      ✅ Successfully extracted audio: ${audioData.length} bytes`);
              return audioData;
            }
          }
        }
      }

      if (!foundAudio) {
        console.log('  ❌ No usable audio found in any streams');
      }
      return null;

    } catch (error) {
      console.error('Error in extractSoundObjects:', error);
      return null;
    }
  }

  /**
   * Find all PDF stream objects in the buffer
   * Returns array of {start, end, size} positions
   */
  private static findAllStreams(pdfData: Uint8Array): Array<{start: number, end: number, size: number}> {
    const streams: Array<{start: number, end: number, size: number}> = [];
    
    // Pattern for "stream" keyword (ASCII: s=115, t=116, r=114, e=101, a=97, m=109)
    const streamKeyword = new Uint8Array([115, 116, 114, 101, 97, 109]);
    // Pattern for "endstream" keyword
    const endstreamKeyword = new Uint8Array([101, 110, 100, 115, 116, 114, 101, 97, 109]);

    for (let i = 0; i < pdfData.length - 10; i++) {
      // Check if "stream" appears at this position
      if (this.bytesMatch(pdfData, i, streamKeyword)) {
        // Skip whitespace after 'stream'
        let streamStart = i + 6;
        while (streamStart < pdfData.length && 
               (pdfData[streamStart] === 0x0a ||    // \n
                pdfData[streamStart] === 0x0d ||    // \r
                pdfData[streamStart] === 0x20 ||    // space
                pdfData[streamStart] === 0x09)) {   // tab
          streamStart++;
        }

        // Find corresponding 'endstream'
        let endPos = streamStart;
        while (endPos < pdfData.length - 9) {
          if (this.bytesMatch(pdfData, endPos, endstreamKeyword)) {
            const size = endPos - streamStart;
            if (size > 0 && size < 10000000) { // Reasonable size limit (10MB)
              streams.push({
                start: streamStart,
                end: endPos,
                size: size
              });
            }
            i = endPos;
            break;
          }
          endPos++;
        }
      }
    }

    return streams;
  }

  /**
   * Check if bytes at position match a pattern
   */
  private static bytesMatch(data: Uint8Array, pos: number, pattern: Uint8Array): boolean {
    if (pos + pattern.length > data.length) return false;

    for (let i = 0; i < pattern.length; i++) {
      if (data[pos + i] !== pattern[i]) return false;
    }
    return true;
  }

  /**
   * Decompress zlib-compressed stream data
   * Detects zlib signature (78 9c, 78 da, 78 01) and decompresses
   */
  private static async decompressStream(compressedData: Uint8Array): Promise<Uint8Array | null> {
    try {
      // Check for zlib signature (78 9c or 78 da or 78 01)
      if (compressedData.length < 2) return compressedData;

      if (compressedData[0] === 0x78 && 
          (compressedData[1] === 0x9c || compressedData[1] === 0xda || compressedData[1] === 0x01)) {
        
        console.log('    Detecting zlib compression, attempting decompression (Native DecompressionStream)...');

        try {
            // Use Native DecompressionStream - available in Electron/Chrome
            const ds = new DecompressionStream('deflate');
            const writer = ds.writable.getWriter();
            writer.write(compressedData);
            writer.close();
            const decompressedBuffer = await new Response(ds.readable).arrayBuffer();
            return new Uint8Array(decompressedBuffer);
        } catch (e) {
            console.log('    Native DecompressionStream failed, fallback to raw:', e);
        }

        console.log('    ⚠️ No decompression library available, using raw compressed data');
        return compressedData;
      }

      // Not compressed
      return compressedData;

    } catch (error) {
      console.error('Decompression error:', error);
      return compressedData;
    }
  }

  /**
   * Count MP3 frames in buffer
   * Looks for MP3 sync markers (0xFF followed by specific bytes)
   */
  private static countMp3Frames(data: Uint8Array): number {
    const mp3Signatures = [0xfb, 0xfa, 0xf3, 0xf2];
    let count = 0;

    for (let i = 0; i < data.length - 1; i++) {
      if (data[i] === 0xff && mp3Signatures.indexOf(data[i + 1] ?? 0) !== -1) {
        count++;
      }
    }

    return count;
  }

  /**
   * Count AAC frames in buffer
   * Looks for ADTS sync words (0xFFF pattern in first 12 bits)
   */
  private static countAacFrames(data: Uint8Array): number {
    let count = 0;

    for (let i = 0; i < data.length - 1; i++) {
      // ADTS sync word: 0xFFF (12 bits)
      if (data[i] === 0xff && ((data[i + 1] ?? 0) & 0xf0) === 0xf0) {
        count++;
      }
    }

    return count;
  }

  /**
   * Extract audio portion from decompressed stream
   * Finds first frame and extracts to end of data
   */
  private static extractAudioFromDecompressed(data: Uint8Array, format: 'mp3' | 'aac'): Uint8Array | null {
    if (format === 'mp3') {
      // Find first MP3 frame (0xFF followed by 0xFB, 0xFA, 0xF3, or 0xF2)
      for (let i = 0; i < data.length - 1; i++) {
        if (data[i] === 0xff && [0xfb, 0xfa, 0xf3, 0xf2].indexOf(data[i + 1] ?? 0) !== -1) {
          return data.slice(i);
        }
      }
    } else if (format === 'aac') {
      // Find first ADTS frame (0xFFF sync)
      for (let i = 0; i < data.length - 1; i++) {
        if (data[i] === 0xff && ((data[i + 1] ?? 0) & 0xf0) === 0xf0) {
          return data.slice(i);
        }
      }
    }

    return null;
  }

  /**
   * METHOD 2: Extract MP3 by collecting scattered frames throughout PDF
   * Falls back here if Method 1 doesn't find sufficient audio
   */
  private static extractMp3Audio(pdfData: Uint8Array): Uint8Array | null {
    try {
      console.log('  🔍 Scanning for MP3 frame signatures...');

      // MP3 frame header signatures
      const mp3Patterns = [
        { sig: [0xff, 0xfb], name: 'MP3 MPEG1 (no CRC)' },
        { sig: [0xff, 0xfa], name: 'MP3 MPEG1 (with CRC)' },
        { sig: [0xff, 0xf3], name: 'MP3 MPEG2 (no CRC)' },
        { sig: [0xff, 0xf2], name: 'MP3 MPEG2 (with CRC)' },
      ];

      const collectedFrames: Uint8Array[] = [];
      const processedOffsets = new Set<number>();
      const minTotalBytes = 10000;
      const minFrameSize = 21;
      const maxFrameSize = 2880;

      console.log(`  Scanning ${pdfData.length} bytes for MP3 signatures...`);

      // Scan through entire PDF looking for frame signatures
      for (let i = 0; i < pdfData.length - 4; i++) {
        const byte0 = pdfData[i];
        const byte1 = pdfData[i + 1];

        // Quick check for frame sync (0xFF pattern)
        if (byte0 !== 0xff) continue;

        // Check against each MP3 pattern
        let matchedPattern: { sig: number[]; name: string } | null = null;
        for (const pattern of mp3Patterns) {
          // CRITICAL FIX: Use === to check if bytes MATCH the signature
          if (byte1 === pattern.sig[1]) {
            matchedPattern = pattern;
            break;
          }
        }

        if (!matchedPattern) continue;

        // Skip if already processed nearby
        let isDuplicate = false;
        for (const processed of processedOffsets) {
          if (Math.abs(processed - i) < 10) {
            isDuplicate = true;
            break;
          }
        }
        if (isDuplicate) continue;

        // Mark this offset as processed
        processedOffsets.add(i);

        // Calculate frame size from header
        const frameSize = this.calculateFrameSize(pdfData, i);

        // Valid frame: size within range and fits in buffer
        if (frameSize >= minFrameSize && frameSize <= maxFrameSize && i + frameSize <= pdfData.length) {
          const frameData = pdfData.slice(i, i + frameSize);
          collectedFrames.push(frameData);

          if (collectedFrames.length % 25 === 0) {
            const totalSoFar = collectedFrames.reduce((sum, f) => sum + f.length, 0);
            console.log(`    Found ${collectedFrames.length} frames, ${totalSoFar} bytes so far...`);
          }
        }
      }

      console.log(`  ✅ Frame scanning complete: ${collectedFrames.length} frames found`);

      if (collectedFrames.length === 0) {
        console.log('    ❌ No valid frames collected');
        return null;
      }

      // Calculate total size
      let totalSize = 0;
      for (const frame of collectedFrames) {
        totalSize += frame.length;
      }

      console.log(`  Total audio data: ${totalSize} bytes (${collectedFrames.length} frames)`);

      if (totalSize < minTotalBytes) {
        console.log(`  ❌ Total ${totalSize} bytes < minimum ${minTotalBytes} bytes`);
        return null;
      }

      // Combine all frames into single buffer
      console.log(`  Combining ${collectedFrames.length} frames...`);
      const combined = new Uint8Array(totalSize);
      let offset = 0;

      for (const frame of collectedFrames) {
        combined.set(frame, offset);
        offset += frame.length;
      }

      console.log(`  ✅ Combined MP3: ${combined.length} bytes`);
      return combined;

    } catch (error) {
      console.error('Error extracting MP3:', error);
      return null;
    }
  }

  /**
   * Calculate MP3 frame size from header bytes
   * Uses MPEG specification for frame size calculation
   */
  private static calculateFrameSize(pdfData: Uint8Array, offset: number): number {
    if (offset + 4 > pdfData.length) return 0;

    const byte1 = pdfData[offset] ?? 0;
    const byte2 = pdfData[offset + 1] ?? 0;
    const byte3 = pdfData[offset + 2] ?? 0;
    const byte4 = pdfData[offset + 3] ?? 0;

    // Sync word must be 0xFF with top 3 bits of next byte set
    if ((byte1 & 0xff) !== 0xff || (byte2 & 0xe0) !== 0xe0) {
      return 0;
    }

    // Extract fields from header
    const mpegVersion = (byte2 >> 3) & 0x3;
    const layer = (byte2 >> 1) & 0x3;
    const bitrateIndex = (byte3 >> 4) & 0xf;
    const sampleRateIndex = (byte3 >> 2) & 0x3;
    const paddingBit = (byte3 >> 1) & 0x1;

    // Validate header values
    if (mpegVersion === 1 || layer === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
      return 0;
    }

    // Bitrate tables (bits per second)
    const bitrateTables: { [key: string]: number[] } = {
      'MPEG1III': [0, 32000, 40000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 160000, 192000, 224000, 256000, 320000],
      'MPEG2III': [0, 8000, 16000, 24000, 32000, 40000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 144000, 160000],
      'MPEG25III': [0, 8000, 16000, 24000, 32000, 40000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 144000, 160000],
    };

    // Sample rate tables (Hz)
    const sampleRateTables: { [key: string]: number[] } = {
      'MPEG1': [44100, 48000, 32000],
      'MPEG2': [22050, 24000, 16000],
      'MPEG25': [11025, 12000, 8000],
    };

    // Map version codes to names
    const mpegVersionNames: { [key: number]: string } = {
      0: 'MPEG25',
      2: 'MPEG2',
      3: 'MPEG1',
    };

    const mpegVersionName = mpegVersionNames[mpegVersion];
    if (!mpegVersionName) return 0;

    const bitrateKey = `${mpegVersionName}III`;
    const bitRate = bitrateTables[bitrateKey]?.[bitrateIndex];
    const sampleRate = sampleRateTables[mpegVersionName]?.[sampleRateIndex];

    if (!bitRate || !sampleRate) {
      return 0;
    }

    // Calculate frame size
    let frameSize: number;
    if (mpegVersion === 3) {
      frameSize = Math.floor((144 * bitRate) / sampleRate) + paddingBit;
    } else {
      frameSize = Math.floor((144 * bitRate) / (2 * sampleRate)) + paddingBit;
    }

    // Validate calculated size
    if (frameSize < 21 || frameSize > 2880) {
      return 0;
    }

    return frameSize;
  }

  static detectMimeType(audioBuffer: Uint8Array): string {
    if (!audioBuffer || audioBuffer.length < 4) return 'audio/mpeg';
    
    // Check MP3 signature
    if ((audioBuffer[0]! & 0xff) === 0xff && (audioBuffer[1]! & 0xe0) === 0xe0) {
      return 'audio/mpeg';
    }
    
    return 'audio/mpeg';
  }

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

      // Create Audio/YYYY-MM folder
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const audioFolder = `Audio/${year}-${month}`;

      try {
        const folder = app.vault.getAbstractFileByPath(audioFolder);
        if (!folder) {
          await app.vault.createFolder(audioFolder);
        }
      } catch (e) {
        // Folder exists
      }

      const audioPath = `${audioFolder}/${audioFileName}`;
      await app.vault.createBinary(audioPath, audioBuffer);

      console.log(`✅ Audio saved to: ${audioPath} (${audioBuffer.byteLength} bytes)`);
      return audioPath;
    } catch (error) {
      console.error('Error saving audio to vault:', error);
      throw error;
    }
  }
}
