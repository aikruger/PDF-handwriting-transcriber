/**
 * PDF Parser for Structural Audio Extraction
 * Implements proper PDF structure parsing following ISO 32000-1 specification
 * Uses native DecompressionStream instead of pako for Obsidian compatibility
 */
export class PdfParser {

    /**
     * Parse PDF cross-reference table to locate all objects
     * Returns a Map of object number → byte offset in PDF
     */
    static parsePdfXref(pdfData: Uint8Array): Map<number, number> {
      const objectOffsets = new Map<number, number>();
      
      try {
        // PDF structure: ... xref table ... startxref [offset] %%EOF
        // We must read from the end of file backwards to find startxref pointer
        
        // Convert last 1024 bytes to text to find startxref location
        const endOfFile = pdfData.slice(Math.max(0, pdfData.length - 1024));
        const endText = new TextDecoder().decode(endOfFile);
        
        // Find startxref pointer that tells us where xref section begins
        const startxrefMatch = endText.match(/startxref\s+(\d+)/);
        if (!startxrefMatch) {
          console.warn('⚠️ No startxref found - PDF might be linearized or corrupted');
          return objectOffsets;
        }
        
        const xrefOffset = parseInt(startxrefMatch[1] ?? '0');
        console.log(`📍 Found startxref at offset: ${xrefOffset}`);
        
        // Read from xref offset onwards
        const xrefSection = new TextDecoder().decode(
          pdfData.slice(xrefOffset, Math.min(xrefOffset + 50000, pdfData.length))
        );
        
        // Parse xref subsections
        // Format: "xref\n10 5\n" means objects 10-14, followed by entries
        const subsectionPattern = /xref\s*\n(\d+)\s+(\d+)([\s\S]*?)(?=(?:xref|trailer))/g;
        
        let totalObjects = 0;
        const matches = [...xrefSection.matchAll(subsectionPattern)];
        
        for (const subsectionMatch of matches) {
          const startObjNum = parseInt(subsectionMatch[1] ?? '0');
          const entries = subsectionMatch[3]?.trim().split('\n') || [];
          
          let currentObjNum = startObjNum;
          
          for (const entry of entries) {
            if (!entry.trim()) continue;
            
            // xref entry format: "0000000000 00000 n" or "0000000000 00000 f"
            // 10-digit offset, space, 5-digit generation, space, flag (n=in-use, f=free)
            const match = entry.match(/^(\d{10})\s+(\d{5})\s+([nf])/);
            if (!match) continue;
            
            const offsetStr = match[1];
            const flag = match[3];
            
            // Only process in-use objects (flag 'n')
            if (flag === 'n' && offsetStr) {
              objectOffsets.set(currentObjNum, parseInt(offsetStr));
              totalObjects++;
            }
            
            currentObjNum++;
          }
        }
        
        console.log(`✅ Parsed xref: Found ${totalObjects} object offsets`);
        return objectOffsets;
        
      } catch (error: any) {
        // console.error('❌ Error parsing xref:', error); // Squelch noise
        return objectOffsets;
      }
    }
  
    /**
     * Extract raw text of an object at a specific byte offset
     * Reads from offset until 'endobj' marker
     */
    static extractObjectAtOffset(pdfData: Uint8Array, offset: number): string {
      try {
        // Read up to 50KB from the offset (most objects are smaller)
        const endOffset = Math.min(offset + 50000, pdfData.length);
        const slice = pdfData.slice(offset, endOffset);
        const text = new TextDecoder().decode(slice);
        
        // Find where the object ends
        const endObjIdx = text.indexOf('endobj');
        if (endObjIdx < 0) {
          // console.warn(`⚠️ No 'endobj' marker found at offset ${offset}`);
          return '';
        }
        
        return text.substring(0, endObjIdx);
      } catch (error: any) {
        // console.error(`Error extracting object at offset ${offset}:`, error);
        return '';
      }
    }
  
    /**
     * Find page objects and extract their /Annots (annotation) arrays
     * Returns list of pages and which annotation objects they contain
     */
    static findPageAnnotations(
      pdfData: Uint8Array,
      objectOffsets: Map<number, number>
    ): Array<{ pageNum: number; annotObjNums: number[] }> {
      const annotations: Array<{ pageNum: number; annotObjNums: number[] }> = [];
      
      try {
        const text = new TextDecoder().decode(pdfData);
        
        // Pattern: "n 0 obj << ... /Type /Page ... >> endobj"
        // We need to find page objects specifically
        const pagePattern = /(\d+)\s+0\s+obj\s*<<([\s\S]*?)endobj/g;
        
        let pageNum = 1;

        const matches = [...text.matchAll(pagePattern)];
        
        for (const match of matches) {
          const dictStr = match[2];
          
          if (!dictStr) continue;

          // Verify this is actually a Page object (has /Type /Page)
          if (!dictStr.includes('/Type') || !dictStr.includes('/Page')) {
            continue;
          }
          
          // Extract annotation references from /Annots array
          // Pattern: /Annots [ 12 0 R 13 0 R ... ]
          const annotsMatch = dictStr.match(/\/Annots\s*\[\s*([\d\s0R]*?)\s*\]/);
          
          if (annotsMatch && annotsMatch[1]) {
            const annotRefStr = annotsMatch[1];
            
            // Extract all "n 0 R" references
            const refMatches = [...annotRefStr.matchAll(/(\d+)\s+0\s+R/g)];
            const annotObjNums = refMatches.map(m => parseInt(m[1] ?? '0'));
            
            if (annotObjNums.length > 0) {
              console.log(`  📄 Page ${pageNum}: Found ${annotObjNums.length} annotations`);
              annotations.push({
                pageNum,
                annotObjNums
              });
            }
          }
          
          pageNum++;
        }
        
        console.log(`✅ Found annotations on ${annotations.length} pages`);
        return annotations;
        
      } catch (error: any) {
        console.error('❌ Error finding page annotations:', error);
        return [];
      }
    }
  
    /**
     * Extract audio stream from a Sound or RichMedia annotation
     * Follows /Contents reference to actual stream object
     */
    static async extractAudioFromAnnotation(
      pdfData: Uint8Array,
      annotObjNum: number,
      objectOffsets: Map<number, number>
    ): Promise<Uint8Array | null> {
      
      try {
        // Get the byte offset of the annotation object
        const offset = objectOffsets.get(annotObjNum);
        if (!offset) {
          // console.warn(`⚠️ Annotation object ${annotObjNum} not found in xref`);
          return null;
        }
        
        // Extract the annotation object text
        const annotObjText = this.extractObjectAtOffset(pdfData, offset);
        
        // Verify it contains Sound or RichMedia subtype
        if (!annotObjText.includes('/Subtype')) {
          // console.warn(`⚠️ No /Subtype found in annotation ${annotObjNum}`);
          return null;
        }
        
        let streamObjNum: number | null = null;
        let annotType = 'Unknown';
        
        // Sound annotation: /Contents reference
        const soundMatch = annotObjText.match(/\/Subtype\s*\/Sound/i);
        if (soundMatch) {
          annotType = 'Sound';
          const contentsMatch = annotObjText.match(/\/Contents\s+(\d+)\s+0\s+R/);
          if (contentsMatch && contentsMatch[1]) {
            streamObjNum = parseInt(contentsMatch[1]);
          }
        }
        
        // RichMedia annotation: /RichMediaContent reference
        const richMediaMatch = annotObjText.match(/\/Subtype\s*\/RichMedia/i);
        if (richMediaMatch && !streamObjNum) {
          annotType = 'RichMedia';
          const contentMatch = annotObjText.match(/\/RichMediaContent\s*\[\s*(\d+)\s+0\s+R/);
          if (contentMatch && contentMatch[1]) {
            streamObjNum = parseInt(contentMatch[1]);
          }
        }
        
        if (!streamObjNum) {
          // console.warn(`⚠️ No stream reference in ${annotType} annotation ${annotObjNum}`);
          return null;
        }
        
        console.log(`  🔊 Annotation ${annotObjNum} (${annotType}) → Object ${streamObjNum}`);
        
        // Extract the referenced audio stream
        return await this.extractAudioStream(pdfData, streamObjNum, objectOffsets);
        
      } catch (error: any) {
        console.error(`❌ Error extracting audio from annotation ${annotObjNum}:`, error);
        return null;
      }
    }
  
    /**
     * Extract and decompress an audio stream object
     * Handles /FlateDecode compression
     */
    static async extractAudioStream(
      pdfData: Uint8Array,
      streamObjNum: number,
      objectOffsets: Map<number, number>
    ): Promise<Uint8Array | null> {
      
      try {
        // Get the byte offset of the stream object
        const offset = objectOffsets.get(streamObjNum);
        if (!offset) {
          console.warn(`⚠️ Stream object ${streamObjNum} not found in xref`);
          return null;
        }
        
        // Extract stream object header (dictionary part)
        const headerText = new TextDecoder().decode(
          pdfData.slice(offset, Math.min(offset + 5000, pdfData.length))
        );
        
        // Find stream dictionary boundaries: << ... >>
        const dictStartIdx = headerText.indexOf('<<');
        const dictEndIdx = headerText.indexOf('>>', dictStartIdx);
        
        if (dictStartIdx < 0 || dictEndIdx < 0) {
          console.warn(`⚠️ No dictionary markers in stream object ${streamObjNum}`);
          return null;
        }
        
        const dictStr = headerText.substring(dictStartIdx, dictEndIdx + 2);
        
        // Check if stream is FLATE-compressed
        const isFlateEncoded = /\/Filter\s*\/FlateDecode|\/FlateDecode\s*\/Filter/i.test(dictStr);
        
        // Get declared length (uncompressed size)
        const lengthMatch = dictStr.match(/\/Length\s+(\d+)/);
        const declaredLength = lengthMatch ? parseInt(lengthMatch[1] ?? '0') : null;
        
        // console.log(`    📊 Stream ${streamObjNum}: Flate=${isFlateEncoded}, Length=${declaredLength}`);
        
        // Extract the binary stream data
        const streamData = this.extractBinaryStream(pdfData, offset, declaredLength);
        
        if (!streamData || streamData.length === 0) {
          console.warn(`⚠️ No stream data for object ${streamObjNum}`);
          return null;
        }
        
        // console.log(`    ✓ Extracted ${streamData.length} bytes from stream ${streamObjNum}`);
        
        // Decompress if needed
        if (isFlateEncoded) {
          try {
            // NATIVE DECOMPRESSION (No Pako dependency)
            const ds = new DecompressionStream('deflate');
            const writer = ds.writable.getWriter();
            writer.write(streamData);
            writer.close();
            const decompressedBuffer = await new Response(ds.readable).arrayBuffer();
            const decompressed = new Uint8Array(decompressedBuffer);

            // console.log(`    📦 Decompressed: ${streamData.length} → ${decompressed.length} bytes`); 
            
            // Verify decompressed data is substantial (not just header)
            if (decompressed.length > 5000) { // check for decent size
              return decompressed;
            } else {
              console.warn(`⚠️ Decompressed size too small: ${decompressed.length} bytes`);
              return null;
            }
          } catch (decompressError) {
            console.warn(`⚠️ Decompression failed for stream ${streamObjNum}: ${decompressError}`);
            // Return raw data if decompression fails (not ideal, but better than nothing)
            return streamData;
          }
        }
        
        return streamData;
        
      } catch (error: any) {
        console.error(`❌ Error extracting audio stream ${streamObjNum}:`, error);
        return null;
      }
    }
  
    /**
     * Extract binary stream between "stream" and "endstream" markers
     * CRITICAL: Must respect /Length boundary and handle binary data correctly
     */
    private static extractBinaryStream(
      pdfData: Uint8Array,
      objectOffset: number,
      declaredLength: number | null
    ): Uint8Array | null {
      
      try {
        // Find "stream" keyword (115, 116, 114, 101, 97, 109 in bytes)
        const streamKeyword = [115, 116, 114, 101, 97, 109]; // "stream"
        let streamIdx = -1;
        
        const searchLimit = Math.min(objectOffset + 5000, pdfData.length - 6);
        for (let i = objectOffset; i < searchLimit; i++) {
          let match = true;
          for (let j = 0; j < 6; j++) {
            if (pdfData[i + j] !== streamKeyword[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            streamIdx = i;
            break;
          }
        }
        
        if (streamIdx < 0) {
          // console.warn('⚠️ No "stream" keyword found');
          return null;
        }
        
        // Skip past "stream" keyword
        let dataStart = streamIdx + 6;
        
        // Skip whitespace after "stream" 
        // PDF allows \n, \r\n, or \r after "stream"
        while (dataStart < pdfData.length && 
               (pdfData[dataStart] === 10 ||  // \n
                pdfData[dataStart] === 13 ||  // \r
                pdfData[dataStart] === 32)) { // space
          dataStart++;
        }
        
        let dataEnd: number;
        
        if (declaredLength !== null && declaredLength > 0) {
          // Use declared length (most reliable approach)
          dataEnd = dataStart + declaredLength;
          if (dataEnd > pdfData.length) {
            dataEnd = pdfData.length;
          }
        } else {
          // Search for "endstream" keyword as fallback
          const endstreamKeyword = [101, 110, 100, 115, 116, 114, 101, 97, 109]; // "endstream"
          let foundEnd = false;
          
          for (let i = dataStart; i < pdfData.length - 9; i++) {
            let match = true;
            for (let j = 0; j < 9; j++) {
              if (pdfData[i + j] !== endstreamKeyword[j]) {
                match = false;
                break;
              }
            }
            if (match) {
              dataEnd = i;
              foundEnd = true;
              break;
            }
          }
          
          if (!foundEnd) {
            // console.warn('⚠️ No "endstream" keyword found');
            return null;
          }
          dataEnd = pdfData.length; // Fallback to end if loop fails to set it but breaks logic (logic above works)
        }
        
        // Extract the binary data
        return pdfData.slice(dataStart, dataEnd);
        
      } catch (error: any) {
        console.error('❌ Error extracting binary stream:', error);
        return null;
      }
    }
  
    /**
     * Identify if extracted data is audio by checking magic bytes
     */
    static isAudioData(data: Uint8Array): boolean {
      if (!data || data.length < 4) return false;
      
      // Audio format magic bytes
      const magicBytes = [
        { sig: [255, 251], name: 'MP3 (MPEG-1 Layer III)' },
        { sig: [255, 250], name: 'MP3 (MPEG-2 Layer III)' },
        { sig: [255, 249], name: 'MP3 (MPEG-2.5 Layer III)' },
        { sig: [255, 241], name: 'AAC-ADTS' },
        { sig: [255, 240], name: 'AAC-ADTS' },
        { sig: [73, 68, 51], name: 'ID3 tag (MP3 metadata)' },
        { sig: [82, 73, 70, 70], name: 'RIFF (WAV)' },
        { sig: [79, 103, 103, 83], name: 'OGG Vorbis' },
        { sig: [102, 76, 97, 67], name: 'FLAC' }
      ];
      
      for (const magic of magicBytes) {
        let match = true;
        for (let i = 0; i < magic.sig.length; i++) {
          if (data[i] !== magic.sig[i]) {
            match = false;
            break;
          }
        }
        if (match) {
          console.log(`      🎵 Detected audio format: ${magic.name}`);
          return true;
        }
      }
      
      return false;
    }
  
    /**
     * Determine MIME type from audio data
     */
    static detectMimeType(data: Uint8Array): string {
      if (!data || data.length < 4) return 'audio/mpeg'; // Default
      
      if ((data[0] === 255 && (data[1] === 251 || data[1] === 250 || data[1] === 249 || data[1] === 241 || data[1] === 240)) ||
          (data[0] === 73 && data[1] === 68 && data[2] === 51)) {
        return 'audio/mpeg'; // MP3
      }
      if (data[0] === 82 && data[1] === 73) {
        return 'audio/wav'; // RIFF/WAV
      }
      if (data[0] === 79 && data[1] === 103) {
        return 'audio/ogg'; // OGG
      }
      if (data[0] === 102 && data[1] === 76) {
        return 'audio/flac'; // FLAC
      }
      
      return 'audio/mpeg'; // Default to MP3
    }
  }
