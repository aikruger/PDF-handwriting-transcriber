/**
 * PDF Audio Extraction Engine - Compression-Aware with Fallback
 * 
 * COMPLETE IMPLEMENTATION with:
 * - Method 1: Structural extraction via PdfParser
 * - Method 2: Corrupted PDF fallback (text scanning with pako decompression)
 * - Method 3: Legacy stream scanner
 * - Method 4: Scattered MP3 frame collection
 */

import { App, TFile } from 'obsidian';
import { AudioExtractionResult } from './types';
import { getExtensionFromMimeType } from './utils';
import { PdfParser } from './pdf-parser';

// @ts-ignore - pako doesn't have type definitions
import * as pako from 'pako';

export class PDFAudioExtractor {
  
  /**
   * Main entry point for audio extraction
   * Attempts multiple strategies in order of reliability
   */
  static async extractAudioFromPDF(pdfBuffer: ArrayBuffer): Promise<AudioExtractionResult> {
    try {
      console.log('🎵 Starting PDF audio extraction (Multi-Strategy)...');

      if (!pdfBuffer || pdfBuffer.byteLength === 0) {
        console.warn('Audio extraction: Empty PDF buffer');
        return { audioBuffer: null, mimeType: null, found: false };
      }

      const pdfData = new Uint8Array(pdfBuffer);
      console.log(`Processing PDF buffer: ${pdfData.length} bytes`);

      // ===== METHOD 1: Structural Extraction via PdfParser (Robust, xref-based) =====
      console.log('📋 Method 1: Analyzing PDF Structure (xref/annotations)...');
      try {
        const objectOffsets = PdfParser.parsePdfXref(pdfData);
        if (objectOffsets.size > 0) {
            const pageAnnotations = PdfParser.findPageAnnotations(pdfData, objectOffsets);
            
            // Collect all audio candidates
            const candidates: Uint8Array[] = [];
            for (const page of pageAnnotations) {
                for (const annotObjNum of page.annotObjNums) {
                    const audioData = await PdfParser.extractAudioFromAnnotation(pdfData, annotObjNum, objectOffsets);
                    if (audioData && audioData.length > 5000) {
                        candidates.push(audioData);
                    }
                }
            }

            // Combine frames if we found them
            if (candidates.length > 0) {
                 const totalSize = candidates.reduce((sum, c) => sum + c.length, 0);
                 const combined = new Uint8Array(totalSize);
                 let offset = 0;
                 for (const c of candidates) {
                     combined.set(c, offset);
                     offset += c.length;
                 }

                 const mimeType = PdfParser.detectMimeType(combined);
                 console.log(`✅ Method 1 succeeded: ${combined.length} bytes (${mimeType})`);
                 return {
                    audioBuffer: combined.buffer as ArrayBuffer,
                    mimeType: mimeType,
                    found: true,
                    method: 'structural-parsing'
                 };
            }
            
            // If xref found 0 annotations, try corrupted PDF fallback
            if (pageAnnotations.length === 0) {
              console.warn('❌ No page annotations found via xref');
              
              // Try fallback for corrupted PDF
              console.log('\n📋 Attempting Method 2: Corrupted PDF fallback (text scan)...');
              const corruptedAudio = await this.extractAudioFromCorruptedPdf(pdfData);
              
              if (corruptedAudio && corruptedAudio.length > 50000) {
                const mimeType = this.detectMimeType(corruptedAudio);
                console.log('✅ Method 2 (corrupted PDF fallback) succeeded!');
                return {
                  audioBuffer: corruptedAudio.buffer as ArrayBuffer,
                  mimeType,
                  found: true,
                  method: 'corrupted-pdf-text-scan'
                };
              }
            }
        }
      } catch(e) {
        console.log(`⚠️ Method 1 failed: ${e}`);
      }


      // ===== METHOD 3: Legacy Stream Scanning =====
      console.log('⚠️ Methods 1-2 failed, attempting Method 3: Legacy Stream Scan...');
      try {
        const audioData = await this.extractSoundObjects(pdfData);
        if (audioData && audioData.length > 10000) {
          console.log(`✅ Method 3 succeeded: ${audioData.length} extracted bytes`);
          return {
            audioBuffer: audioData.buffer as ArrayBuffer,
            mimeType: 'audio/mpeg',
            found: true,
            method: 'sound-objects',
          };
        }
      } catch (error) {
        console.log(`⚠️ Method 3 failed: ${error}`);
      }

      // ===== METHOD 4: Fallback to Scattered MP3 Frame Collection =====
      console.log('⚠️ All methods failed, attempting Method 4: Scattered frame collection...');
      try {
        const audioData = this.extractMp3Audio(pdfData);
        if (audioData && audioData.length > 10000) {
          console.log(`✅ Method 4 succeeded: ${audioData.length} extracted bytes`);
          return {
            audioBuffer: audioData.buffer as ArrayBuffer,
            mimeType: 'audio/mpeg',
            found: true,
            method: 'scattered-frames',
          };
        }
      } catch (error) {
        console.log(`⚠️ Method 4 also failed: ${error}`);
      }

      console.log('❌ No audio extraction method succeeded');
      return { audioBuffer: null, mimeType: null, found: false };

    } catch (error) {
      console.error('Audio extraction error:', error);
      return { audioBuffer: null, mimeType: null, found: false };
    }
  }

  /**
   * Trim wrapper bytes from audio data to find the actual MP3 start
   * Shared by both FLATE decompression methods
   */
  private static trimMp3WrapperBytes(audioData: Uint8Array): Uint8Array {
    if (!audioData || audioData.length < 4) return audioData;

    console.log(`\n=== TRIMMING ANALYSIS START ===`);
    console.log(`Input size: ${audioData.length} bytes`);

    const headerIndex = this.findMp3FrameHeaderIndex(audioData);
    console.log(`Header detection result: ${headerIndex}`);

    if (headerIndex > 0) {
      console.log(`\nBytes BEFORE trim (first ${Math.min(32, headerIndex)} bytes):`);
      console.log(
        Array.from(audioData.slice(0, Math.min(32, headerIndex)))
          .map(
            (b, i) =>
              `  [${i.toString().padStart(2)}] 0x${b.toString(16).toUpperCase().padStart(2, '0')}`
          )
          .join('\n')
      );

      console.log(`\nBytes AT trim point (offset ${headerIndex}, next 32 bytes):`);
      console.log(
        Array.from(audioData.slice(headerIndex, Math.min(headerIndex + 32, audioData.length)))
          .map(
            (b, i) =>
              `  [${i.toString().padStart(2)}] 0x${b.toString(16).toUpperCase().padStart(2, '0')}`
          )
          .join('\n')
      );

      const trimmed = audioData.slice(headerIndex);

      // Validate the trimmed result
      if (trimmed.length >= 4) {
        const byte0 = trimmed[0] ?? 0;
        const byte1 = trimmed[1] ?? 0;
        const byte2 = trimmed[2] ?? 0;
        const byte3 = trimmed[3] ?? 0;
        const bitrateIndex = (byte2 >> 4) & 0x0f;
        const sampleRateIndex = (byte3 >> 2) & 0x03;

        console.log(`\nTrimmed header validation:`);
        console.log(
          `  Bytes 0-1 (sync): 0x${byte0.toString(16).toUpperCase()} 0x${byte1
            .toString(16)
            .toUpperCase()}`
        );
        console.log(
          `  Byte 2 (bitrate): 0x${byte2.toString(16).toUpperCase()} → Index: ${bitrateIndex} ${
            bitrateIndex === 0 || bitrateIndex === 15 ? '❌ INVALID' : '✅ VALID'
          }`
        );
        console.log(
          `  Byte 3 (sample): 0x${byte3.toString(16).toUpperCase()} → Index: ${sampleRateIndex} ${
            sampleRateIndex === 3 ? '❌ INVALID' : '✅ VALID'
          }`
        );
      }

      console.log(`\nTrim operation:`);
      console.log(`  Input size: ${audioData.length} bytes`);
      console.log(`  Output size: ${trimmed.length} bytes`);
      console.log(`  Bytes removed: ${audioData.length - trimmed.length}`);
      console.log(
        `  Percentage removed: ${(((audioData.length - trimmed.length) / audioData.length) * 100).toFixed(3)}%`
      );
      console.log(`=== TRIMMING ANALYSIS END ===\n`);

      return trimmed;
    }

    console.log(`⚠️ No header found, returning data as-is`);
    console.log(`=== TRIMMING ANALYSIS END ===\n`);
    return audioData;
  }

  /**
   * Decompress FLATE-compressed data using pako
   * More reliable than native DecompressionStream for PDF files
   */
  private static async decompressFlate(t: Uint8Array): Promise<Uint8Array | null> {
    try {
      console.log(`\n=== FLATE DECOMPRESSION START ===`);
      console.log(`Input: ${t.length} bytes (${(t.length / 1024 / 1024).toFixed(2)}MB)`);
      console.log(`Input first 32 bytes (hex):`);
      console.log(
        Array.from(t.slice(0, 32))
          .map(
            (b, i) =>
              `  [${i.toString().padStart(2)}] 0x${b.toString(16).toUpperCase().padStart(2, '0')}`
          )
          .join('\n')
      );

      const inflated = pako.inflate(t);
      const audioData = new Uint8Array(inflated);

      console.log(`Output: ${audioData.length} bytes (${(audioData.length / 1024 / 1024).toFixed(2)}MB)`);
      console.log(`Compression ratio: ${((t.length / audioData.length) * 100).toFixed(1)}%`);

      console.log(`Output first 32 bytes (hex):`);
      console.log(
        Array.from(audioData.slice(0, 32))
          .map(
            (b, i) =>
              `  [${i.toString().padStart(2)}] 0x${b.toString(16).toUpperCase().padStart(2, '0')}`
          )
          .join('\n')
      );

      console.log(`Output last 32 bytes (hex):`);
      const lastStart = Math.max(0, audioData.length - 32);
      console.log(
        Array.from(audioData.slice(lastStart))
          .map(
            (b, i) =>
              `  [${(lastStart + i).toString().padStart(5)}] 0x${b
                .toString(16)
                .toUpperCase()
                .padStart(2, '0')}`
          )
          .join('\n')
      );

      // Count frame headers with validation
      let potentialHeaders = 0;
      let validHeaders = 0;
      const headerLocations: number[] = [];

      for (let i = 0; i < audioData.length - 3; i++) {
        if (audioData[i] === 0xFF && [0xFA, 0xFB, 0xF2, 0xF3].includes(audioData[i + 1] ?? 0)) {
          potentialHeaders++;
          if (headerLocations.length < 10) headerLocations.push(i);

          const byte2 = audioData[i + 2] ?? 0;
          const byte3 = audioData[i + 3] ?? 0;
          const bitrateIndex = (byte2 >> 4) & 0x0f;
          const sampleRateIndex = (byte3 >> 2) & 0x03;

          if (bitrateIndex !== 0 && bitrateIndex !== 15 && sampleRateIndex !== 3) {
            validHeaders++;
          }
        }
      }

      console.log(`\nMP3 Frame Header Analysis:`);
      console.log(`  Potential headers (0xFF + valid byte): ${potentialHeaders}`);
      console.log(`  Valid headers (full validation): ${validHeaders}`);
      console.log(`  First 10 header positions: ${headerLocations.join(', ')}`);

      // Check for zero-byte patterns
      let zeroCount = 0;
      let maxZeroRun = 0;
      let currentZeroRun = 0;
      for (let i = 0; i < audioData.length; i++) {
        if (audioData[i] === 0x00) {
          zeroCount++;
          currentZeroRun++;
          maxZeroRun = Math.max(maxZeroRun, currentZeroRun);
        } else {
          currentZeroRun = 0;
        }
      }
      console.log(`  Total zero bytes: ${zeroCount} (${((zeroCount / audioData.length) * 100).toFixed(2)}%)`);
      console.log(`  Max consecutive zeros: ${maxZeroRun}`);

      console.log(`=== FLATE DECOMPRESSION END ===\n`);

      const trimmedAudio = this.trimMp3WrapperBytes(audioData);
      return trimmedAudio;
    } catch (e) {
      console.error(`Flate decompression FAILED:`, e);
      return null;
    }
  }

  /**
   * Alternative decompression using raw deflate variant (skip zlib header)
   * For PDFs that use raw DEFLATE without zlib wrapper
   */
  private static async decompressFlateRaw(t: Uint8Array): Promise<Uint8Array | null> {
    try {
      // Use pako with raw zlib (skip 2-byte header)
      let e = t.length > 2 ? t.slice(2) : t;
      const inflated = pako.inflate(e, { raw: true });
      let audioData = new Uint8Array(inflated);
      
      // LOG 1: After FLATE decompression (raw)
      console.log(`✅ FLATE (raw): ${(t.length/1024).toFixed(0)}KB→${(audioData.length/1024/1024).toFixed(2)}MB, first 4: ${Array.from(audioData.slice(0,4)).map(b=>'0x'+b.toString(16).padStart(2,'0')).join(' ')}`);
      
      // Use shared trimming function
      const trimmedAudio = this.trimMp3WrapperBytes(audioData);
      
      if (trimmedAudio !== audioData) {
        // LOG 3: After trimming
        console.log(`✂️ TRIM (raw): -${audioData.length - trimmedAudio.length}B, ${(audioData.length/1024/1024).toFixed(2)}→${(trimmedAudio.length/1024/1024).toFixed(2)}MB, new first 4: ${Array.from(trimmedAudio.slice(0,4)).map(b=>'0x'+b.toString(16).padStart(2,'0')).join(' ')}`);
      }
      
      return trimmedAudio;
    } catch (e) {
      console.warn('⚠️ Raw flate decompression failed:', e);
      return null;
    }
  }

  /**
   * Scan buffer for first valid MP3 frame header
   * MP3 frame headers start with 0xFFE (sync code)
   */
  private static findMp3FrameHeaderIndex(buffer: Uint8Array): number {
    if (!buffer || buffer.length < 4) return -1;
    
    // Check for ID3 tag first
    if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) { // "ID3"
      console.log('    ✓ Found ID3 tag, parsing size...');
      if (buffer.length >= 10) {
        // ID3v2 size is synchsafe (7 bits per byte)
        const size = (((buffer[6] ?? 0) & 0x7F) << 21) |
                     (((buffer[7] ?? 0) & 0x7F) << 14) |
                     (((buffer[8] ?? 0) & 0x7F) << 7) |
                     ((buffer[9] ?? 0) & 0x7F);
        const audioStart = 10 + size;
        console.log(`    ✓ ID3 tag size: ${size} bytes, audio starts at offset ${audioStart}`);
        
        if (audioStart < buffer.length) {
          // Recursively search after ID3
          const foundIdx = this.findMp3FrameHeaderIndex(buffer.slice(audioStart));
          return foundIdx >= 0 ? audioStart + foundIdx : -1;
        }
      }
      return -1;
    }
    
    // Scan for MP3 frame sync (0xFF followed by E0-EF or F0-FF)
    for (let i = 0; i < buffer.length - 3; i++) {
      const byte1 = buffer[i] ?? 0;
      const byte2 = buffer[i + 1] ?? 0;

      // Only match the 4 valid MPEG Layer III sync bytes
      const validMp3SyncBytes = [0xFA, 0xFB, 0xF2, 0xF3];
      if (byte1 === 0xFF && validMp3SyncBytes.includes(byte2)) {
        console.log(
          `🔍 VALID MP3 HEADER at offset ${i}: 0xFF 0x${byte2.toString(16).toUpperCase().padStart(2, '0')}`
        );
        return i;
      }
    }
    
    // Also check for RIFF WAV header
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
      console.log('    ✓ RIFF/WAV header found at offset 0');
      return 0;
    }
    
    return -1;
  }

  /**
   * Verify if data is valid MP3 audio
   * Checks for MP3 frame sync patterns or ID3 tags
   */
  private static verifyMp3Data(data: Uint8Array): boolean {
    if (data.length < 4) return false;
    
    // Use the findMp3FrameHeaderIndex to check if valid MP3 exists
    const headerIndex = this.findMp3FrameHeaderIndex(data);
    
    if (headerIndex >= 0) {
      console.log(`✅ Valid MP3 data found (header at offset ${headerIndex})`);
      return true;
    }
    
    console.warn('❌ No MP3 frame headers or ID3 tags found');
    return false;
  }

  /**
   * FALLBACK for corrupted xref tables
   * Scans entire PDF for /Subtype /Sound directly
   * Uses pako for FLATE decompression
   */
  private static async extractAudioFromCorruptedPdf(pdfData: Uint8Array): Promise<Uint8Array | null> {
    try {
      const pdfText = new TextDecoder().decode(pdfData);
      console.log('  ⚠️ xref had 0 annotations, scanning PDF text for /Subtype /Sound...');

      const soundPattern = /(\d+)\s+0\s+obj\s*<<[\s\S]*?\/Subtype\s*\/Sound[\s\S]*?endobj/g;
      const matches = [...pdfText.matchAll(soundPattern)];
      console.log(`  ✅ Found ${matches.length} /Subtype /Sound annotations`);

      if (matches.length === 0) return null;

      const audioFrames: Uint8Array[] = [];

      for (const match of matches) {
        const soundObjNum = parseInt(match[1] ?? '0');
        const soundObjText = match[0] ?? '';
        console.log(`\n    🔊 Sound Object #${soundObjNum}:`);
        
        // Find stream reference
        const contentsMatch = soundObjText.match(/\/Contents\s+(\d+)\s+0\s+R/);
        const soundRef = soundObjText.match(/\/Sound\s+(\d+)\s+0\s+R/);
        
        let streamObjNum: number | null = null;
        if (contentsMatch && contentsMatch[1]) {
          streamObjNum = parseInt(contentsMatch[1]);
          console.log(`      -> /Contents object ${streamObjNum}`);
        } else if (soundRef && soundRef[1]) {
          streamObjNum = parseInt(soundRef[1]);
          console.log(`      -> /Sound object ${soundObjNum}`);
        }
        
        if (!streamObjNum) {
          console.log('      ⚠️ No stream reference found - trying nearby streams...');
          // Fallback: scan surrounding streams for actual audio
          const allStreams = this.findAllStreams(pdfData);
          let foundRealAudio = false;
          for (const stream of allStreams) {
            const streamData = pdfData.slice(stream.start, stream.end);
            if (streamData.length < 5000) continue; // Skip tiny streams
            
            const mp3Count = this.countMp3Frames(streamData);
            const aacCount = this.countAacFrames(streamData);
            
            if (mp3Count > 20 || aacCount > 20) {
              console.log(`      ✅ Found real audio stream at offset ${stream.start} (${streamData.length} bytes)`);
              
              // CRITICAL: Find first MP3 frame header WITHIN the data
              const headerIndex = this.findMp3FrameHeaderIndex(streamData);
              
              if (headerIndex >= 0) {
                // Extract from the MP3 header forward
                const mp3Audio = streamData.slice(headerIndex);
                console.log(`      🔍 Found MP3 header at offset +${headerIndex}, extracted ${(mp3Audio.length / 1024 / 1024).toFixed(2)} MB`);
                audioFrames.push(mp3Audio);
              } else {
                // No MP3 header found, but data might still be valid (raw PCM or other format)
                console.log(`      ⚠️ No MP3 header found, accepting raw audio data: ${(streamData.length / 1024 / 1024).toFixed(2)} MB`);
                audioFrames.push(streamData);
              }
              
              foundRealAudio = true;
              break;
            }
          }
          if (foundRealAudio) continue;
          else continue; // Skip this Sound object
        }

        // Find stream object in text
        const streamPattern = new RegExp(`${streamObjNum}\\s+0\\s+obj\\s*<<([\\s\\S]*?)endobj`, 'g');
        const streamMatch = streamPattern.exec(pdfText);
        if (!streamMatch) {
          console.warn(`      ⚠️ Stream object ${streamObjNum} not found in text`);
          continue;
        }

        const streamObjText = streamMatch[0] ?? '';
        console.log(`      ✓ Found stream object ${streamObjNum}`);

        // Extract dictionary
        const dictMatch = streamObjText.match(/<<([\s\S]*?)>>/);
        if (!dictMatch || !dictMatch[1]) continue;

        const dictStr = dictMatch[1];
        const isFlate = /\/Filter\s*\/FlateDecode|\/FlateDecode\s*\/Filter/i.test(dictStr);
        const lengthMatch = dictStr.match(/\/Length\s+(\d+)/);
        const declaredLength = lengthMatch ? parseInt(lengthMatch[1] ?? '0') : null;
        
        console.log(`      📊 FLATE: ${isFlate}, Length: ${declaredLength}`);

        // Find object in binary PDF
        const objSearchStr = `${streamObjNum} 0 obj`;
        const objBytes = new TextEncoder().encode(objSearchStr);
        let binaryObjStart = -1;
        
        for (let i = 0; i < pdfData.length - objBytes.length; i++) {
          let match = true;
          for (let j = 0; j < objBytes.length; j++) {
            if (pdfData[i + j] !== objBytes[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            binaryObjStart = i;
            break;
          }
        }

        if (binaryObjStart < 0) {
          console.warn('      ⚠️ Object not found in binary');
          continue;
        }

        // Find "stream" marker
        const streamKeyword = [115, 116, 114, 101, 97, 109]; // "stream"
        let streamBinaryIdx = -1;
        
        for (let i = binaryObjStart; i < Math.min(binaryObjStart + 5000, pdfData.length - 6); i++) {
          let match = true;
          for (let j = 0; j < 6; j++) {
            if (pdfData[i + j] !== streamKeyword[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            streamBinaryIdx = i;
            break;
          }
        }

        if (streamBinaryIdx < 0) continue;

        // Skip whitespace
        let binaryDataStart = streamBinaryIdx + 6;
        while (binaryDataStart < pdfData.length &&
               (pdfData[binaryDataStart] === 10 || pdfData[binaryDataStart] === 13 || pdfData[binaryDataStart] === 32)) {
          binaryDataStart++;
        }

        // Find end
        let binaryDataEnd: number;
        if (declaredLength !== null && declaredLength > 0) {
          binaryDataEnd = binaryDataStart + declaredLength;
        } else {
          const endstream = [101, 110, 100, 115, 116, 114, 101, 97, 109]; // "endstream"
          binaryDataEnd = pdfData.length;
          for (let i = binaryDataStart; i < pdfData.length - 9; i++) {
            let match = true;
            for (let j = 0; j < 9; j++) {
              if (pdfData[i + j] !== endstream[j]) {
                match = false;
                break;
              }
            }
            if (match) {
              binaryDataEnd = i;
              break;
            }
          }
        }

        const streamData = pdfData.slice(binaryDataStart, Math.min(binaryDataEnd, pdfData.length));
        console.log(`      📦 Extracted ${streamData.length} bytes`);

        // CRITICAL: Check if this is actually small metadata, not real audio
        if (streamData.length < 1000) {
          console.log(`      ⚠️ Stream is very small (${streamData.length} bytes) - likely metadata, not audio`);
          console.log('      → Searching for real audio in other streams...');
          
          // Try decompression anyway
          let decompressed: Uint8Array | null = null;
          if (isFlate) {
            decompressed = await this.decompressFlate(streamData);
            if (!decompressed) {
              decompressed = await this.decompressFlateRaw(streamData);
            }
          } else {
            decompressed = streamData;
          }
          
          // If decompressed is still too small, skip and try nearby streams
          if (!decompressed || decompressed.length < 1000) {
            console.log(`      ✗ Decompressed data still too small (${decompressed?.length || 0} bytes)`);
            console.log('      → Looking for audio in ALL streams...');
            
            const allStreams = this.findAllStreams(pdfData);
            let foundRealAudio = false;
            
            for (const stream of allStreams) {
              const data = pdfData.slice(stream.start, stream.end);
              if (data.length < 5000) continue;
              
              const mp3Count = this.countMp3Frames(data);
              const aacCount = this.countAacFrames(data);
              
              if (mp3Count > 20 || aacCount > 20) {
                console.log(`      ✅ Found REAL audio at offset ${stream.start} (${data.length} bytes, ${mp3Count} MP3 frames)`);
                // VERIFY IT'S VALID MP3
                const isValidMp3 = this.verifyMp3Data(data);
                console.log(`      🔍 MP3 Validation: ${isValidMp3 ? '✅ VALID' : '❌ CORRUPTED'}`);
                if (isValidMp3) {
                  audioFrames.push(data);
                  foundRealAudio = true;
                  break;
                }
              }
            }
            
            if (foundRealAudio) continue;
            else continue;
          }
        }

        // Normal decompression for non-tiny streams
        let audioData: Uint8Array | null = null;
        if (isFlate) {
          try {
            // Use pako for PDF Flate decompression (better than DecompressionStream)
            audioData = await this.decompressFlate(streamData);
            
            if (audioData) {
              console.log(`      ✓ Decompressed: ${streamData.length} → ${audioData.length} bytes`);
            } else {
              try {
                audioData = await this.decompressFlateRaw(streamData);
                if (audioData) {
                  console.log(`      ✓ Decompressed (raw): ${streamData.length} → ${audioData.length} bytes`);
                }
              } catch (err2) {
                console.warn('      ⚠️ Raw decompression also failed');
                audioData = streamData;
              }
            }
          } catch (err) {
            console.warn('      ⚠️ Decompression failed');
            audioData = streamData;
          }
        } else {
          audioData = streamData;
        }

        // CRITICAL FIX: Extract MP3 from within the buffer
        if (audioData && audioData.length > 5000) {
          // CRITICAL: Find first MP3 frame header WITHIN the data
          const headerIndex = this.findMp3FrameHeaderIndex(audioData);
          
          if (headerIndex >= 0) {
            // Extract from the MP3 header forward
            const mp3Audio = audioData.slice(headerIndex);
            console.log(`      🔍 Found MP3 header at offset +${headerIndex}, extracted ${(mp3Audio.length / 1024 / 1024).toFixed(2)} MB`);
            audioFrames.push(mp3Audio);
          } else {
            // No MP3 header found, but data might still be valid (raw PCM or other format)
            console.log(`      ⚠️ No MP3 header found, accepting raw audio data: ${(audioData.length / 1024 / 1024).toFixed(2)} MB`);
            audioFrames.push(audioData);
          }
        }
      }

      if (audioFrames.length === 0) return null;

      console.log(`\n  ✅ Combining ${audioFrames.length} frame(s)...`);
      const totalSize = audioFrames.reduce((sum, frame) => sum + frame.length, 0);
      let combined = new Uint8Array(totalSize);
      
      let offset = 0;
      for (const frame of audioFrames) {
        combined.set(frame, offset);
        offset += frame.length;
      }

      console.log(`  ✅ Combined into ${(combined.length / 1024 / 1024).toFixed(2)} MB`);
      console.log(`     First 4 bytes: ${Array.from(combined.slice(0, 4)).map(b => '0x' + b.toString(16)).join(' ')}`);
      
      // CRITICAL: Strip PDF wrapper bytes - the MP3 may not start at position 0
      if (combined && combined.length > 100) {
        const headerIndex = this.findMp3FrameHeaderIndex(combined);
        
        if (headerIndex > 0 && headerIndex < combined.length) {
          console.log(`  🔍 MP3 data starts at offset ${headerIndex}, stripping PDF wrapper...`);
          combined = combined.slice(headerIndex);
          console.log(`  ✂️ After strip: First 4 bytes = ${Array.from(combined.slice(0, 4)).map(b => '0x' + b.toString(16).padStart(2,'0')).join(' ')}`);
          console.log(`  ✅ Final size: ${(combined.length / 1024 / 1024).toFixed(2)} MB`);
        }
      }
      
      return combined;
    } catch (error) {
      console.error('❌ Corrupted PDF extraction error:', error);
      return null;
    }
  }

  /**
   * METHOD 3: Extract audio from PDF Sound objects (Legacy)
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
      if (data[i] === 0xff && mp3Signatures.includes(data[i + 1] ?? 0)) {
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
          return this.trimMp3WrapperBytes(data.slice(i));
        }
      }
    } else if (format === 'aac') {
      // Find first ADTS frame (0xFFF sync)
      for (let i = 0; i < data.length - 1; i++) {
        if (data[i] === 0xff && ((data[i + 1] ?? 0) & 0xf0) === 0xf0) {
          return this.trimMp3WrapperBytes(data.slice(i));
        }
      }
    }

    return null;
  }

  /**
   * METHOD 4: Extract MP3 by collecting scattered frames throughout PDF
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
      return this.trimMp3WrapperBytes(combined);

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
      // LOG 4: Inside saveAudioToVault (first line)
      console.log(
        `💾 SAVE FUNCTION RECEIVED: ${(audioBuffer.byteLength / 1024 / 1024).toFixed(2)}MB, first 4: ${Array.from(
          new Uint8Array(audioBuffer)
        )
          .slice(0, 4)
          .map((b) => '0x' + b.toString(16).padStart(2, '0'))
          .join(' ')}`
      );

      if (!audioBuffer || audioBuffer.byteLength === 0) {
        throw new Error('No audio data to save');
      }

      let audioBytes = new Uint8Array(audioBuffer);

      console.log(`\n=== SAVE POINT ANALYSIS START ===`);
      console.log(`Buffer received: ${audioBytes.length} bytes (${(audioBytes.length / 1024 / 1024).toFixed(2)}MB)`);

      // Define sampling points
      const samplingPoints = [
        { offset: 0, label: 'START' },
        { offset: Math.floor(audioBytes.length * 0.1), label: '10%' },
        { offset: Math.floor(audioBytes.length * 0.25), label: '25%' },
        { offset: Math.floor(audioBytes.length * 0.5), label: 'MIDDLE' },
        { offset: Math.floor(audioBytes.length * 0.75), label: '75%' },
        { offset: Math.floor(audioBytes.length * 0.9), label: '90%' },
        { offset: Math.max(0, audioBytes.length - 32), label: 'END' },
      ];

      console.log(`\nSampling 16 bytes at key points:`);
      for (const point of samplingPoints) {
        if (point.offset >= 0 && point.offset < audioBytes.length) {
          const sample = audioBytes.slice(point.offset, Math.min(point.offset + 16, audioBytes.length));
          const hex = Array.from(sample)
            .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
            .join(' ');
          console.log(`  ${point.label.padEnd(8)} (offset ${point.offset.toString().padStart(8)}): ${hex}`);
        }
      }

      // Count 0xFF bytes (potential frame starts)
      let ffCount = 0;
      const ffPositions: number[] = [];
      for (let i = 0; i < audioBytes.length; i++) {
        if (audioBytes[i] === 0xff) {
          ffCount++;
          if (ffPositions.length < 20) ffPositions.push(i);
        }
      }
      console.log(`\n0xFF byte analysis:`);
      console.log(`  Total count: ${ffCount}`);
      console.log(`  First 20 positions: ${ffPositions.join(', ')}`);

      // Look for large zero runs (sign of corruption)
      const zeroRuns: Array<{ start: number; length: number }> = [];
      let inZeroRun = false;
      let zeroStart = 0;
      let zeroCount2 = 0;

      for (let i = 0; i < audioBytes.length; i++) {
        if (audioBytes[i] === 0x00) {
          if (!inZeroRun) {
            inZeroRun = true;
            zeroStart = i;
            zeroCount2 = 1;
          } else {
            zeroCount2++;
          }
        } else {
          if (inZeroRun && zeroCount2 > 100) {
            zeroRuns.push({ start: zeroStart, length: zeroCount2 });
          }
          inZeroRun = false;
        }
      }

      if (zeroRuns.length > 0) {
        console.log(`\n⚠️ Found ${zeroRuns.length} runs of >100 consecutive zero bytes:`);
        for (const run of zeroRuns.slice(0, 10)) {
          console.log(`    Offset ${run.start.toString().padStart(8)}: ${run.length} zeros`);
        }
        if (zeroRuns.length > 10) {
          console.log(`    ... and ${zeroRuns.length - 10} more`);
        }
      } else {
        console.log(`\n✅ No large zero-byte runs (good sign)`);
      }

      console.log(`=== SAVE POINT ANALYSIS END ===\n`);

      // Final safety trim (in case any wrapper bytes survived upstream)
      if (audioBytes.length >= 4) {
        const trimmed = this.trimMp3WrapperBytes(audioBytes);
        if (trimmed !== audioBytes) {
          audioBytes = trimmed;
        }
      }

      const first4 = audioBytes.slice(0, 4);
      const isMp3Sync = (first4[0] ?? 0) === 0xFF && (((first4[1] ?? 0) & 0xE0) === 0xE0);
      console.log(
        `✅ SAVE VERIFICATION: ${(audioBytes.length / 1024 / 1024).toFixed(2)}MB, first 4: ${Array.from(first4)
          .map((b) => '0x' + b.toString(16).padStart(2, '0'))
          .join(' ')}, mp3Sync: ${isMp3Sync ? '✅' : '❌'}`
      );

      if (!isMp3Sync) {
        console.warn('⚠️ SAVE WARNING: output does not start with an MP3 sync header (0xFFEx)');
      }

      const ext = getExtensionFromMimeType(mimeType);
      const baseName = pdfName.replace('.pdf', '').replace(/[^a-z0-9-]/gi, '_');
      const timestamp = Date.now();
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
      
      // IMPORTANT: Pass the Uint8Array directly
      await app.vault.createBinary(audioPath, audioBytes);

      // Immediate disk verification
      console.log(`\n=== DISK VERIFICATION START ===`);
      try {
        const file = app.vault.getAbstractFileByPath(audioPath);
        if (file && file instanceof TFile) {
          const readBack = await app.vault.readBinary(file);
          const savedBytes = new Uint8Array(readBack);

          console.log(`File written to: ${audioPath}`);
          console.log(`Size check: ${savedBytes.length} bytes vs expected ${audioBytes.length} bytes`);

          if (readBack.byteLength === audioBytes.length) {
            console.log(`✅ File size matches (no truncation)`);
          } else {
            console.log(`❌ FILE SIZE MISMATCH! Expected ${audioBytes.length}, got ${readBack.byteLength}`);
          }

          // Find first content mismatch
          let firstMismatch = -1;
          for (let i = 0; i < Math.min(audioBytes.length, savedBytes.length); i++) {
            if (audioBytes[i] !== savedBytes[i]) {
              firstMismatch = i;
              break;
            }
          }

          if (firstMismatch === -1) {
            console.log(`✅ File content verified (first ${Math.min(audioBytes.length, 100000)} bytes match)`);
          } else {
            console.log(`❌ First content mismatch at offset ${firstMismatch}`);
            console.log(
              `   Expected: ${Array.from(audioBytes.slice(firstMismatch, firstMismatch + 16))
                .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
                .join(' ')}`
            );
            console.log(
              `   Got:      ${Array.from(savedBytes.slice(firstMismatch, firstMismatch + 16))
                .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
                .join(' ')}`
            );
          }

          // Sample the written file
          console.log(`\nDisk file sampling (same points):`);
          for (const point of samplingPoints) {
            if (point.offset >= 0 && point.offset < savedBytes.length) {
              const sample = savedBytes.slice(point.offset, Math.min(point.offset + 16, savedBytes.length));
              const hex = Array.from(sample)
                .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
                .join(' ');
              console.log(`  ${point.label.padEnd(8)} (offset ${point.offset.toString().padStart(8)}): ${hex}`);
            }
          }
        }
      } catch (e) {
        console.warn(`Could not verify disk write:`, e);
      }
      console.log(`=== DISK VERIFICATION END ===\n`);
      
      return audioPath;
    } catch (error) {
      console.error('Error saving audio to vault:', error);
      throw error;
    }
  }
}
