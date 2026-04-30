export type AIProvider = 'openai' | 'ollama';

export interface PDFTranscriberSettings {
  // Provider selection
  aiProvider: AIProvider;

  // OpenAI settings
  openaiApiKey: string;
  openaiModel: string;

  // Ollama settings
  ollamaUrl: string;
  ollamaModel: string;
  ollamaTimeoutMs: number;
  ollamaInactivityTimeoutMs: number;
  disableOllamaInactivityAbort: boolean;

  // PDF processing
  defaultPdfFolder: string;
  maxPages: number;
  pageStart: number;
  pageEnd: number;
  batchSize: number;
  renderScale: number;
  imageQuality: number;

  // Prompts
  defaultTextPrompt: string;
  defaultDiagramPrompt: string;
  defaultMixedPrompt: string;

  // Diagram settings
  detectDiagrams: boolean;
  useMermaid: boolean;
  contentMode: 'text' | 'diagram' | 'mixed';
}

export interface PageRenderResult {
  pageNum: number;
  imageDataUrl: string;
}

export interface TranscriptionOptions {
  textPrompt: string;
  diagramPrompt: string;
  mixedPrompt: string;
  detectDiagrams: boolean;
  contentMode: 'text' | 'diagram' | 'mixed';
  selectedPages: number[] | null;
}