// Preserve the exact regex from original for mermaid block detection
export function formatMermaidDiagrams(text: string): string {
  const mermaidRegex = /```(?:mermaid)?\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey)[\s\S]*?```/g;

  return text.replace(mermaidRegex, (match) => {
    if (!match.startsWith('```mermaid')) {
      return '```mermaid\n' + match.replace(/^```\s*/, '').replace(/```$/, '') + '\n```';
    }
    return match;
  });
}

// Preserve original logic exactly
export function areConsecutive(arr: number[]): boolean {
  if (arr.length <= 1) return true;
  const sorted = [...arr].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}
