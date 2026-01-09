/**
 * Utility functions for PDF Transcriber
 */

/**
 * Check if array of numbers is consecutive
 */
export function areConsecutive(arr: number[]): boolean {
  if (arr.length <= 1) return true;
  const sorted = [...arr].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    // Assert non-null for sorted[i-1] as we start loop at 1
    if (sorted[i] !== (sorted[i - 1] ?? 0) + 1) {
      return false;
    }
  }
  return true;
}

/**
 * Format mermaid diagrams in transcription
 */
export function formatMermaidDiagrams(text: string): string {
  let formatted = text;
  const mermaidRegex =
    /```(?:mermaid)?\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey)[\s\S]*?```/g;

  formatted = formatted.replace(mermaidRegex, (match) => {
    if (!match.startsWith('```mermaid')) {
      return '```mermaid\n' + match.replace(/^```\s*/, '').replace(/```$/, '') + '\n```';
    }
    return match;
  });

  return formatted;
}

/**
 * Format audio sync output with clickable timestamps
 */
export function formatAudioSync(text: string, audioPath: string | null): string {
  let formatted = text;
  // Match timestamps like **[0:00]** or **[1:30]**
  const timestampRegex = /\*\*\[(\d{1,2}):(\d{2})\]\*\*/g;

  if (audioPath) {
    // ✅ Create clickable timestamps that jump to audio position
    formatted = formatted.replace(timestampRegex, (match, minutes, seconds) => {
      const totalSeconds = parseInt(minutes) * 60 + parseInt(seconds);
      // Obsidian audio link with time fragment
      return `**[▶ ${minutes}:${seconds}](${audioPath}#t=${totalSeconds})**`;
    });
  } else {
    // If no audio, just format timestamps normally
    formatted = formatted.replace(timestampRegex, (match, minutes, seconds) => {
      return `**[${minutes}:${seconds}]**`;
    });
  }

  return formatted;
}

/**
 * Get MIME type from filename extension
 */
export function getMimeTypeFromFilename(filename: string): string {
  if (filename.endsWith('.mp3')) return 'audio/mpeg';
  if (filename.endsWith('.m4a')) return 'audio/mp4';
  if (filename.endsWith('.wav')) return 'audio/wav';
  if (filename.endsWith('.ogg')) return 'audio/ogg';
  return 'audio/mpeg';
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/mp4':
    case 'audio/aac':
      return 'm4a';
    case 'audio/wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    default:
      return 'mp3';
  }
}
