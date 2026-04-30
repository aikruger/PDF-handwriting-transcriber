/**
 * Utility functions for PDF Transcriber
 */

/**
 * Check if an array of page numbers is consecutive (e.g. [1,2,3])
 */
export function areConsecutive(arr: number[]): boolean {
  if (arr.length <= 1) return true;
  const sorted = [...arr].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== (sorted[i - 1] ?? 0) + 1) return false;
  }
  return true;
}

/**
 * Ensure mermaid code blocks are properly labelled in the AI output.
 * Converts bare ``` flowchart/graph/sequence blocks into ```mermaid blocks.
 */
export function formatMermaidDiagrams(text: string): string {
  let formatted = text;
  const mermaidRegex =
    /```(?:mermaid)?\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey)[\s\S]*?```/g;
  formatted = formatted.replace(mermaidRegex, (match) => {
    if (!match.startsWith('```mermaid')) {
      return (
        '```mermaid\n' +
        match.replace(/^```\s*/, '').replace(/```$/, '') +
        '\n```'
      );
    }
    return match;
  });
  return formatted;
}