import { PDFTranscriberSettings } from './types';

export const PDF_JS_URL = 'https://unpkg.com/pdfjs-dist@3.8.162/build/pdf.min.js';

export const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

export const OPENAI_AVAILABLE_MODELS = [
  'gpt-4o',
  'gpt-4-turbo',
  'gpt-4-vision-preview',
];

export const RECOMMENDED_OLLAMA_MODELS = [
  'llava',
  'llava:34b',
  'minicpm-v',
  'llama3.2-vision',
  'moondream',
];

export const DEFAULT_SETTINGS: PDFTranscriberSettings = {
  aiProvider: 'openai',

  openaiApiKey: '',
  openaiModel: 'gpt-4o',

  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llava',
  ollamaTimeoutMs: 120000,

  defaultPdfFolder: '',
  maxPages: 50,
  pageStart: 1,
  pageEnd: 0,
  batchSize: 1,
  renderScale: 2.0,
  imageQuality: 0.9,

  defaultTextPrompt: `Please transcribe all handwritten text from this image. Format it cleanly with proper paragraphs, lists, and line breaks as they appear in the original.`,

  defaultDiagramPrompt: `This image contains a diagram or drawing. Please analyze it carefully and convert it to a mermaid diagram. Use the appropriate mermaid syntax based on the type of diagram (flowchart, sequence diagram, etc.). Focus on capturing the structure, relationships, and any text labels.`,

  defaultMixedPrompt: `This image may contain both handwritten text and diagrams/drawings. Please:

1. Transcribe all handwritten text accurately, maintaining paragraphs and formatting.

2. For any diagrams or drawings, convert them to mermaid syntax. Wrap the mermaid code in triple backticks with 'mermaid' label.

Ensure you maintain the logical flow of the document, placing the mermaid diagrams in the appropriate locations relative to the text.`,

  detectDiagrams: false,
  useMermaid: true,
  contentMode: 'mixed',
};