export interface EvaluationResult { score: number; metrics: Record<string, number>; }

function levenshteinDistance(a: string, b: string): number {
    const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }
    return matrix[a.length][b.length];
}

function calculateWER(expected: string, actual: string) {
    const expWords = expected.split(/\s+/).filter(Boolean);
    const actWords = actual.split(/\s+/).filter(Boolean);
    if (expWords.length === 0) return actWords.length === 0 ? 0 : 1;
    const matrix = Array.from({ length: expWords.length + 1 }, () => new Array(actWords.length + 1).fill(0));
    for (let i = 0; i <= expWords.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= actWords.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= expWords.length; i++) {
        for (let j = 1; j <= actWords.length; j++) {
            const cost = expWords[i - 1] === actWords[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }
    return matrix[expWords.length][actWords.length] / expWords.length;
}

export class EvaluationService {
  evaluateHandwriting(expected: string, actual: string): EvaluationResult {
    const normExpected = expected.replace(/\s+/g, ' ').trim().toLowerCase();
    const normActual = actual.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normExpected === normActual) return { score: 100, metrics: { exactMatch: 1, cer: 0, wer: 0 } };
    const cer = normExpected.length === 0 ? (normActual.length === 0 ? 0 : 1) : levenshteinDistance(normExpected, normActual) / normExpected.length;
    const wer = calculateWER(normExpected, normActual);
    return { score: Math.max(0, Math.round((1 - wer) * 100)), metrics: { cer, wer } };
  }
  evaluateDiagram(_expectedMermaid: string, actualMermaid: string): EvaluationResult {
    const isMermaid = actualMermaid.includes('```mermaid') || actualMermaid.includes('graph ') || actualMermaid.includes('flowchart ');
    return { score: isMermaid ? 90 : 0, metrics: { isMermaid: isMermaid ? 1 : 0, parsed: isMermaid ? 1 : 0 } };
  }
}