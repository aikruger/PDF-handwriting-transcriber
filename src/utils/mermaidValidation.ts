import { Logger } from './logger';

export function parseMermaidBlocks(text: string): string[] {
    const blocks: string[] = [];
    const blockRegex = /```(?:mermaid|MERMAID)?\n([\s\S]*?)```/g;
    let match;

    while ((match = blockRegex.exec(text)) !== null) {
        if (match[1].trim()) {
            blocks.push(match[1].trim());
        }
    }

    // Fallback if the whole thing is just mermaid without backticks
    if (blocks.length === 0 && (text.trim().startsWith('graph ') || text.trim().startsWith('flowchart ') || text.trim().startsWith('sequenceDiagram'))) {
         blocks.push(text.trim());
    }

    return blocks;
}

export function validateMermaidSyntax(mermaidString: string): boolean {
    // A real parser would go here, we do a basic syntax check.
    if (!mermaidString) return false;

    const lines = mermaidString.split('\n');
    let hasHeader = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('graph') ||
            trimmed.startsWith('flowchart') ||
            trimmed.startsWith('sequenceDiagram') ||
            trimmed.startsWith('classDiagram') ||
            trimmed.startsWith('stateDiagram') ||
            trimmed.startsWith('erDiagram') ||
            trimmed.startsWith('pie') ||
            trimmed.startsWith('mindmap')
        ) {
            hasHeader = true;
            break;
        }
    }

    if (!hasHeader) {
        Logger.warn('Mermaid', 'Validation failed', { errorCategory: 'missing_header' });
        return false;
    }

    return true;
}
