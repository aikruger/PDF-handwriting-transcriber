/**
 * Type definitions for PDF Transcriber Plugin
 */

export interface PDFTranscriberSettings {
  apiKey: string;
  defaultPdfFolder: string;
  selectedModel: string;
  availableModels: string[];
  maxPages: number;
  pageStart: number;
  pageEnd: number;
  batchSize: number;
  renderScale: number;
  imageQuality: number;
  defaultTextPrompt: string;
  defaultDiagramPrompt: string;
  defaultMixedPrompt: string;
  defaultAudioSyncPrompt: string;
  detectDiagrams: boolean;
  useMermaid: boolean;
  contentMode: 'text' | 'diagram' | 'mixed' | 'audio-sync';
  extractAudio: boolean;
  audioFolder: string;
  autoExtractBeforeTranscription: boolean;
  playAudioInline: boolean;
}

export interface AudioExtractionResult {
  audioBuffer: ArrayBuffer | null;
  mimeType: string | null;
  found: boolean;
  method?: 'stream' | 'embedded';
}

export interface PageRenderResult {
  pageNum: number;
  imageDataUrl: string;
}

export interface TranscriptionOptions {
  textPrompt: string;
  diagramPrompt: string;
  mixedPrompt: string;
  audioSyncPrompt: string;
  detectDiagrams: boolean;
  contentMode: 'text' | 'diagram' | 'mixed' | 'audio-sync';
  selectedPages: number[] | null;
}

export interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}
