import { Logger } from './logger';

export function parseMermaidBlocks(text: string): string[] {
    const blocks: string[] = [];
    const blockRegex = /```(?:mermaid|MERMAID)?\n([\s\S]*?)```/g;
    let match;
    while ((match = blockRegex.exec(text)) !== null) {
        if (match[1].trim()) blocks.push(match[1].trim());
    }
    if (blocks.length === 0 && (text.trim().startsWith('graph ') || text.trim().startsWith('flowchart ') || text.trim().startsWith('sequenceDiagram'))) {
         blocks.push(text.trim());
    }
    return blocks;
}

export function validateMermaidSyntax(mermaidString: string): boolean {
    if (!mermaidString) return false;
    const lines = mermaidString.split('\n');
    let hasHeader = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (['graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'erDiagram', 'pie', 'mindmap'].some(h => trimmed.startsWith(h))) {
            hasHeader = true; break;
        }
    }
    if (!hasHeader) {
        Logger.warn('Mermaid', 'Validation failed', { errorCategory: 'missing_header' });
        return false;
    }
    return true;
}