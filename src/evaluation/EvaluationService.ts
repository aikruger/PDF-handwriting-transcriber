
export interface EvaluationResult {
  score: number; // 0-100
  metrics: Record<string, number>;
}

export class EvaluationService {
  evaluateHandwriting(expected: string, actual: string): EvaluationResult {
    // Normalise expected and actual
    const normExpected = expected.replace(/\s+/g, ' ').trim().toLowerCase();
    const normActual = actual.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normExpected === normActual) {
        return { score: 100, metrics: { exactMatch: 1 } };
    }

    // Very naive edit distance evaluation logic for demonstration.
    // In production we would use levenshtein.
    let matches = 0;
    const expWords = normExpected.split(' ');
    const actWords = normActual.split(' ');

    for (const w of expWords) {
        if (actWords.includes(w)) matches++;
    }

    const score = Math.max(0, Math.round((matches / Math.max(expWords.length, 1)) * 100));
    return { score, metrics: { wordMatchRate: score } };
  }

  evaluateDiagram(_expectedMermaid: string, actualMermaid: string): EvaluationResult {
    // Very basic semantic check instead of string check.
    const isMermaid = actualMermaid.includes('```mermaid') || actualMermaid.includes('graph ') || actualMermaid.includes('flowchart ');
    if (!isMermaid) return { score: 0, metrics: { isMermaid: 0 } };

    // Just a placeholder metric.
    return { score: 90, metrics: { isMermaid: 1, parsed: 1 } };
  }
}
