/**
 * PDF Audio Structure Analyzer
 * diagnostic tool to inspect PDF internals
 */

import { App, TFile, Notice } from 'obsidian';

export class PDFAudioAnalyzer {
  static async analyze(file: TFile, app: App): Promise<void> {
    console.log(`\n=== 🕵️ STARTING ANALYSIS: ${file.name} ===`);
    
    try {
      const buffer = await app.vault.readBinary(file);
      const data = new Uint8Array(buffer);
      console.log(`File Size: ${data.length} bytes`);

      // 1. Search for PDF Audio Objects
      this.findPdfObjects(data);

      // 2. Scan for raw Audio Signatures
      this.scanForSignatures(data);

      // 3. Analyze PDF Streams (first 20 bytes of every stream)
      this.inspectStreams(data);

    } catch (e) {
      console.error('Analysis failed', e);
    }
    console.log(`=== 🕵️ END ANALYSIS ===\n`);
    new Notice('Analysis complete. Check Developer Console (Ctrl+Shift+I)');
  }

  private static findPdfObjects(data: Uint8Array) {
    const text = new TextDecoder().decode(data);
    
    console.log('%c[1] Searching for PDF Object definitions...', 'color: cyen');
    
    const soundRegex = /\/Type\s*\/Sound/gi;
    const embeddedRegex = /\/Type\s*\/EmbeddedFile/gi;
    const subtypeSoundRegex = /\/Subtype\s*\/Sound/gi;
    
    const sounds = [...text.matchAll(soundRegex)];
    const embedded = [...text.matchAll(embeddedRegex)];
    const subSounds = [...text.matchAll(subtypeSoundRegex)];

    console.log(`- Found ${sounds.length} "/Type /Sound" tags`);
    console.log(`- Found ${embedded.length} "/Type /EmbeddedFile" tags`);
    console.log(`- Found ${subSounds.length} "/Subtype /Sound" tags`);

    if (sounds.length > 0 || embedded.length > 0) {
        console.log('  -> PDF uses standard object embedding.');
    } else {
        console.log('  -> No standard audio objects found. Audio handles are likely hidden or raw.');
    }
  }

  private static scanForSignatures(data: Uint8Array) {
    console.log('%c[2] Scanning for Raw Audio Signatures...', 'color: cyen');

    const sigs = [
        { name: 'MP3 (ID3v2)', bytes: [0x49, 0x44, 0x33] },
        { name: 'MP3 (MPEG Frame)', bytes: [0xFF, 0xFB] },
        { name: 'WAV (RIFF)', bytes: [0x52, 0x49, 0x46, 0x46] },
        { name: 'OGG (OggS)', bytes: [0x4F, 0x67, 0x67, 0x53] },
        { name: 'M4A (ftypM4A)', bytes: [0x66, 0x74, 0x79, 0x70, 0x4D, 0x34, 0x41] }, // Offset usually check match
        { name: 'AAC (ADTS)', bytes: [0xFF, 0xF1] }
    ];

    for (const sig of sigs) {
        let count = 0;
        let firstOffset = -1;
        
        for(let i=0; i<data.length - sig.bytes.length; i++) {
            let match = true;
            for(let j=0; j<sig.bytes.length; j++) {
                if (data[i+j] !== sig.bytes[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                count++;
                if (firstOffset === -1) firstOffset = i;
                // Optimization: Don't count millions of MP3 frames, just detect presence
                if (count > 50) {
                    break;
                }
            }
        }
        
        if (count > 0) {
            console.log(`- Found ${count}${count>50?'+':''} matches for ${sig.name}. First at offset: ${firstOffset}`);
        }
    }
  }

  private static inspectStreams(data: Uint8Array) {
    console.log('%c[3] Inspecting PDF Streams...', 'color: cyen');
    
    // Naive regex to find streams could be slow on massive files, so we iterate bytes
    // Looking for 'stream' (0x73 0x74 0x72 0x65 0x61 0x6d)
    // and 'endstream'
    
    let streamCount = 0;
    const maxLog = 20; // Only log details of first 20 streams
    
    for(let i=0; i<data.length - 6; i++) {
        if (data[i] === 0x73 && data[i+1] === 0x74 && data[i+2] === 0x72 && data[i+3] === 0x65 && data[i+4] === 0x61 && data[i+5] === 0x6d) {
            // Found 'stream'
            let start = i + 6;
            // Skip CRLF/LF
            while(start < data.length && (data[start] === 0x0D || data[start] === 0x0A)) start++;
            
            // Peek at first 10 bytes
            const header = Array.from(data.slice(start, start + 10)).map(b => b.toString(16).padStart(2, '0')).join(' ');
            const ascii = new TextDecoder().decode(data.slice(start, start + 10)).replace(/[^\x20-\x7E]/g, '.');
            
            if (streamCount < maxLog) {
               console.log(`  Stream #${streamCount+1} at ${i}: [${header}] "${ascii}"`);
            }
            streamCount++;
            
            // Optimization: Skip ahead a bit
            i += 100; 
        }
    }
    
    if (streamCount > maxLog) {
        console.log(`  ... and ${streamCount - maxLog} more streams.`);
    }
  }
}
