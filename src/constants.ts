/**
 * Constants and default settings for PDF Transcriber
 */

import { PDFTranscriberSettings } from './types';

export const DEFAULT_SETTINGS: PDFTranscriberSettings = {
  apiKey: '',
  defaultPdfFolder: '',
  selectedModel: 'gpt-4o',
  availableModels: ['gpt-4-vision', 'gpt-4o', 'gpt-4-turbo'],
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
  defaultAudioSyncPrompt: `You are analyzing a handwritten document that was being written WHILE an audio recording was made.

YOUR TASK:
1. Transcribe ALL handwritten text exactly as it appears
2. Estimate when each section was written (based on writing speed ~40 words/minute)
3. Format with timestamps that link to the audio recording

FORMAT YOUR RESPONSE LIKE THIS:

**[0:00]** Section Start - First topic or header
Transcribed text for this section...
More details and content...

**[1:30]** Second Section - Different topic
Content written around 1:30 into the recording...

**[3:45]** Final Notes - Conclusions
Last section content...

**[End]** - Recording ends

CRITICAL RULES:
- Start times with [mm:ss] format
- Estimate based on amount of text and visual handwriting density
- Place timestamps at logical breaks (new topics, significant gaps)
- Each timestamp section: 3-5 sentences typical (1.5-3 minute chunks)
- If page seems to have fast writing: timestamps closer together
- If page has sparse writing: timestamps further apart
- Mark end with [End] marker`,
  detectDiagrams: false,
  useMermaid: true,
  contentMode: 'mixed',
  extractAudio: true,
  audioFolder: 'Audio',
  autoExtractBeforeTranscription: true,
  playAudioInline: true,
};

export const PDF_JS_URL = 'https://unpkg.com/pdfjs-dist@3.8.162/build/pdf.min.js';
export const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
