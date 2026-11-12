import { ModelInfo } from '../providers/BaseProvider';

export interface ModelRelevance {
  score: number;          // 0-100
  reason: string;         // one short sentence, human-readable
  taskScores: { handwriting: number; diagram: number; mixed: number };
}

interface FamilyRule {
  pattern: RegExp;
  label: string;
  handwritingBase: number;
  diagramBase: number;
  defaultEvidence?: string;
  isDescriptionOnly?: boolean;
}

/**
 * Curated knowledge table mapping known vision/multimodal model families
 * to base relevance scores for handwriting transcription and diagram/Mermaid extraction.
 */
const FAMILY_RULES: FamilyRule[] = [
  {
    pattern: /(?:got-ocr|\bocr\b|ocr-\d|rolmocr|olmocr)/i,
    label: 'OCR-specialised model',
    handwritingBase: 92,
    diagramBase: 66,
    defaultEvidence: 'OCR-specialised model'
  },
  {
    pattern: /moondream/i,
    label: 'Moondream',
    handwritingBase: 12,
    diagramBase: 22,
    defaultEvidence: 'Description-only model; poor for transcription',
    isDescriptionOnly: true
  },
  {
    pattern: /gpt-4\.1/i,
    label: 'GPT-4.1',
    handwritingBase: 92,
    diagramBase: 92,
    defaultEvidence: 'Strong OCR & diagram reasoning'
  },
  {
    pattern: /gpt-4o/i,
    label: 'GPT-4o',
    handwritingBase: 90,
    diagramBase: 90,
    defaultEvidence: 'Strong OCR & diagram reasoning'
  },
  {
    pattern: /gpt-4-(?:turbo|vision)/i,
    label: 'GPT-4 Turbo',
    handwritingBase: 82,
    diagramBase: 83,
    defaultEvidence: 'High-accuracy multimodal vision'
  },
  {
    pattern: /gpt-4/i,
    label: 'GPT-4',
    handwritingBase: 77,
    diagramBase: 78,
    defaultEvidence: 'Multimodal GPT-4 vision'
  },
  {
    pattern: /(?:^|\/)(?:o1|o3|o4)(?:$|[-_])/i,
    label: 'OpenAI o-series',
    handwritingBase: 86,
    diagramBase: 91,
    defaultEvidence: 'Strong structured visual reasoning'
  },
  {
    pattern: /claude/i,
    label: 'Claude',
    handwritingBase: 88,
    diagramBase: 90,
    defaultEvidence: 'Strong OCR & structured diagram reasoning'
  },
  {
    pattern: /gemini-2\.5/i,
    label: 'Gemini 2.5',
    handwritingBase: 88,
    diagramBase: 89,
    defaultEvidence: 'Strong multimodal OCR & diagram support'
  },
  {
    pattern: /gemini/i,
    label: 'Gemini',
    handwritingBase: 82,
    diagramBase: 82,
    defaultEvidence: 'Multimodal document & visual reasoning'
  },
  {
    pattern: /qwen-?3(?:\.\d+)?-?vl/i,
    label: 'Qwen3-VL',
    handwritingBase: 89,
    diagramBase: 88,
    defaultEvidence: 'Strong OCR/handwriting & visual reasoning'
  },
  {
    pattern: /qwen-?2\.5-?vl/i,
    label: 'Qwen2.5-VL',
    handwritingBase: 88,
    diagramBase: 85,
    defaultEvidence: 'Strong OCR/handwriting & document parsing'
  },
  {
    pattern: /(?:qwen-?2?-?vl|\bqvq\b)/i,
    label: 'Qwen-VL',
    handwritingBase: 83,
    diagramBase: 80,
    defaultEvidence: 'High-resolution OCR & vision support'
  },
  {
    pattern: /internvl/i,
    label: 'InternVL',
    handwritingBase: 86,
    diagramBase: 86,
    defaultEvidence: 'Strong document OCR & diagram reasoning'
  },
  {
    pattern: /pixtral/i,
    label: 'Pixtral',
    handwritingBase: 85,
    diagramBase: 85,
    defaultEvidence: 'Strong document & chart understanding'
  },
  {
    pattern: /minicpm-?v/i,
    label: 'MiniCPM-V',
    handwritingBase: 85,
    diagramBase: 77,
    defaultEvidence: 'Strong scene-text & handwriting OCR'
  },
  {
    pattern: /llama-?3\.2[-_a-z0-9]*vision/i,
    label: 'Llama 3.2 Vision',
    handwritingBase: 85,
    diagramBase: 80,
    defaultEvidence: 'Proven handwriting & document vision'
  },
  {
    pattern: /llama-?4/i,
    label: 'Llama 4',
    handwritingBase: 82,
    diagramBase: 81,
    defaultEvidence: 'Multimodal vision reasoning'
  },
  {
    pattern: /molmo/i,
    label: 'Molmo',
    handwritingBase: 83,
    diagramBase: 84,
    defaultEvidence: 'Strong visual pointing & diagram analysis'
  },
  {
    pattern: /(?:nemotron[-_a-z0-9]*vl|vl[-_a-z0-9]*nemotron|nemotron-super)/i,
    label: 'Nemotron-VL',
    handwritingBase: 83,
    diagramBase: 81,
    defaultEvidence: 'Document & OCR vision support'
  },
  {
    pattern: /deepseek[-_a-z0-9]*(?:vl|vision)/i,
    label: 'DeepSeek-VL',
    handwritingBase: 82,
    diagramBase: 80,
    defaultEvidence: 'Document OCR & visual understanding'
  },
  {
    pattern: /(?:bak)?llava/i,
    label: 'LLaVA',
    handwritingBase: 74,
    diagramBase: 68,
    defaultEvidence: 'General-purpose local vision model'
  },
  {
    pattern: /gemma-?3/i,
    label: 'Gemma 3',
    handwritingBase: 73,
    diagramBase: 71,
    defaultEvidence: 'Multimodal vision support'
  },
  {
    pattern: /phi-?[34][-_a-z0-9]*(?:vision|multimodal)/i,
    label: 'Phi Vision',
    handwritingBase: 75,
    diagramBase: 74,
    defaultEvidence: 'Compact multimodal document vision'
  }
];

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

interface TierSignal {
  offset: number;
  tierLabel?: string;
}

/**
 * Extracts parameter-size or named tier scaling so larger tiers of a model family
 * outrank smaller tiers of the same family unless description evidence contradicts.
 */
function evaluateTierScaling(modelId: string, displayName: string): TierSignal {
  const idLower = modelId.toLowerCase();
  const combined = `${idLower} ${(displayName || '').toLowerCase()}`;

  let offset = 0;
  let tierLabel: string | undefined;

  // Extract explicit parameter count tokens such as -72b, :90b, -235b, -8b
  // Ignore active-parameter MoE suffixes like -a22b or -a3b
  const paramRegex = /(?:^|[-_:/\s])(\d+(?:\.\d+)?)b(?:$|[-_:/\s])/gi;
  const paramSizes: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = paramRegex.exec(combined)) !== null) {
    const num = parseFloat(match[1]);
    if (!isNaN(num) && num > 0 && num <= 2000) {
      paramSizes.push(num);
    }
  }

  if (paramSizes.length > 0) {
    const maxParams = Math.max(...paramSizes);
    if (maxParams >= 100) {
      offset += 7;
      tierLabel = `large ${maxParams}B tier`;
    } else if (maxParams >= 60) {
      offset += 6;
      tierLabel = `large ${maxParams}B tier`;
    } else if (maxParams >= 25) {
      offset += 3;
      tierLabel = `${maxParams}B tier`;
    } else if (maxParams >= 11) {
      offset += 1;
      tierLabel = `${maxParams}B tier`;
    } else if (maxParams >= 6) {
      offset -= 3;
      tierLabel = `compact ${maxParams}B tier`;
    } else {
      offset -= 6;
      tierLabel = `small ${maxParams}B tier`;
    }
  }

  // Named tier modifiers
  if (/(?:^|[-_:/\s])opus(?:$|[-_:/\s])/i.test(idLower)) {
    offset += 5;
    tierLabel = tierLabel || 'Opus tier';
  } else if (/(?:^|[-_:/\s])sonnet(?:$|[-_:/\s])/i.test(idLower)) {
    offset += 3;
    tierLabel = tierLabel || 'Sonnet tier';
  } else if (/(?:^|[-_:/\s])haiku(?:$|[-_:/\s])/i.test(idLower)) {
    offset -= 6;
    tierLabel = tierLabel || 'Haiku tier';
  }

  if (/(?:^|[-_:/\s])pro(?:$|[-_:/\s])/i.test(idLower)) {
    offset += 4;
    tierLabel = tierLabel || 'Pro tier';
  } else if (/flash-lite/i.test(idLower)) {
    offset -= 6;
    tierLabel = tierLabel || 'Flash-Lite tier';
  } else if (/(?:^|[-_:/\s])flash(?:$|[-_:/\s])/i.test(idLower)) {
    offset -= 2;
    tierLabel = tierLabel || 'Flash tier';
  }

  if (/(?:^|[-_:/\s])large(?:$|[-_:/\s])/i.test(idLower)) {
    offset += 3;
    tierLabel = tierLabel || 'large tier';
  } else if (/(?:^|[-_:/\s])nano(?:$|[-_:/\s])/i.test(idLower)) {
    offset -= 7;
    tierLabel = tierLabel || 'nano tier';
  } else if (/(?:^|[-_:/\s])(?:mini|lite)(?:$|[-_:/\s])/i.test(idLower)) {
    offset -= 5;
    tierLabel = tierLabel || 'mini/lite tier';
  } else if (/(?:^|[-_:/\s])small(?:$|[-_:/\s])/i.test(idLower)) {
    offset -= 3;
    tierLabel = tierLabel || 'small tier';
  }

  return { offset, tierLabel };
}

interface KeywordSignal {
  handwritingDelta: number;
  diagramDelta: number;
  evidenceNote?: string;
}

function evaluateDescriptionKeywords(description: string, displayName: string): KeywordSignal {
  const text = `${displayName || ''} ${description || ''}`.toLowerCase();
  if (!text.trim()) {
    return { handwritingDelta: 0, diagramDelta: 0 };
  }

  let handwritingDelta = 0;
  let diagramDelta = 0;
  const notes: string[] = [];

  const hasStrongOcr =
    /\bocr\b|optical character|handwrit(?:ing|ten)|text recognition|scene text|transcrib(?:e|ing|ed|ption)|document parsing|scanned/i.test(
      text
    );
  const hasDocumentSignal =
    /\bdocument(?:s)?\b|visual question|\bvqa\b|dense text|receipt|invoice|reading/i.test(text);
  const hasDiagramSignal =
    /\bdiagram(?:s)?\b|\bchart(?:s)?\b|\bflowchart(?:s)?\b|\bgraph(?:s)?\b|structured visual|\binfographic(?:s)?\b|\bdrawing(?:s)?\b|\bplot(?:s)?\b|spatial reasoning|visual reasoning|\btable(?:s)?\b/i.test(
      text
    );
  const hasCaptioningOnlySignal =
    /\bcaption(?:ing|s)?\b|image description|describe(?:s)? images|describing images|short descriptions/i.test(
      text
    );

  if (hasStrongOcr) {
    handwritingDelta += 10;
    diagramDelta += 2;
    notes.push('Strong OCR/handwriting evidence');
  } else if (hasDocumentSignal) {
    handwritingDelta += 5;
    diagramDelta += 2;
    notes.push('Document/text recognition evidence');
  }

  if (hasDiagramSignal) {
    diagramDelta += 8;
    handwritingDelta += 2;
    if (hasStrongOcr) {
      notes[0] = 'Strong OCR & diagram evidence';
    } else {
      notes.push('Diagram/chart reasoning evidence');
    }
  }

  // Mild penalty on handwriting task only when description emphasizes captioning/description
  // without OCR, handwriting, or document transcription context.
  if (hasCaptioningOnlySignal && !hasStrongOcr && !hasDocumentSignal) {
    handwritingDelta -= 15;
    notes.push('Captioning-focused (penalised for handwriting)');
  }

  return {
    handwritingDelta,
    diagramDelta,
    evidenceNote: notes.length > 0 ? notes.join('; ') : undefined
  };
}

function scoreSingleModel(model: ModelInfo, providerId: string): ModelRelevance {
  if (!model.supportsVision) {
    return {
      score: 0,
      reason: 'No image input support',
      taskScores: { handwriting: 0, diagram: 0, mixed: 0 }
    };
  }

  const id = model.id || '';
  const displayName = model.displayName || id;
  const description = model.description || '';
  const effectiveProvider = (model.provider || providerId || '').toLowerCase();

  // 1. Match model family
  const matchedFamily = FAMILY_RULES.find(
    rule => rule.pattern.test(id) || rule.pattern.test(displayName)
  );

  let handwritingScore = matchedFamily ? matchedFamily.handwritingBase : 56;
  let diagramScore = matchedFamily ? matchedFamily.diagramBase : 56;

  // 2. Family tier scaling
  const tier = evaluateTierScaling(id, displayName);
  handwritingScore += tier.offset;
  diagramScore += tier.offset;

  // 3. Description keyword adjustments
  const keywords = evaluateDescriptionKeywords(description, displayName);
  handwritingScore += keywords.handwritingDelta;
  diagramScore += keywords.diagramDelta;

  // 4. Endpoint / variant caveats (:batch and :free)
  const caveats: string[] = [];
  if (/(?::batch|\bbatch\b)/i.test(id)) {
    handwritingScore -= 18;
    diagramScore -= 18;
    caveats.push('batch endpoint');
  }
  if (/(?::free|(?:^|[-_/])free(?:$|[-_/]))/i.test(id)) {
    handwritingScore -= 3;
    diagramScore -= 3;
    caveats.push('free tier');
  }

  let finalHandwriting = clampScore(handwritingScore);
  let finalDiagram = clampScore(diagramScore);

  // Composite choice: `taskScores.mixed` is the rounded mean of handwriting and diagram scores,
  // and overall `score` equals `taskScores.mixed` so the default ranking reflects balanced
  // suitability across both plugin feature families.
  let finalMixed = Math.round((finalHandwriting + finalDiagram) / 2);

  // 5. Blend with provider-supplied score if present:
  // finalScore = round(0.6 * engineScore + 0.4 * providerScore)
  if (typeof model.score === 'number' && !isNaN(model.score)) {
    const providerScore = clampScore(model.score);
    finalHandwriting = clampScore(Math.round(0.6 * finalHandwriting + 0.4 * providerScore));
    finalDiagram = clampScore(Math.round(0.6 * finalDiagram + 0.4 * providerScore));
    finalMixed = clampScore(Math.round(0.6 * finalMixed + 0.4 * providerScore));
  }

  // 6. Construct human-readable single-sentence reason
  const reasonParts: string[] = [];
  if (matchedFamily?.isDescriptionOnly) {
    reasonParts.push(matchedFamily.defaultEvidence || 'Description-only model');
  } else {
    if (keywords.evidenceNote) {
      reasonParts.push(keywords.evidenceNote);
    } else if (matchedFamily?.defaultEvidence) {
      reasonParts.push(matchedFamily.defaultEvidence);
    }

    if (matchedFamily) {
      if (tier.tierLabel) {
        reasonParts.push(`${tier.tierLabel} (${matchedFamily.label})`);
      } else if (!reasonParts.some(p => p.includes(matchedFamily.label))) {
        reasonParts.push(`${matchedFamily.label} family`);
      }
    } else if (tier.tierLabel) {
      reasonParts.push(tier.tierLabel);
    }
  }

  if (reasonParts.length === 0) {
    reasonParts.push(
      effectiveProvider
        ? 'Vision-capable, no specific transcription evidence'
        : 'Vision-capable, no specific transcription evidence'
    );
  }

  if (caveats.length > 0) {
    reasonParts.push(caveats.join(', '));
  }

  const reason = reasonParts.join('; ');

  return {
    score: finalMixed,
    reason,
    taskScores: {
      handwriting: finalHandwriting,
      diagram: finalDiagram,
      mixed: finalMixed
    }
  };
}

export function recommendModels(
  models: ModelInfo[],
  providerId: string
): (ModelInfo & { relevance: ModelRelevance })[] {
  const enriched = models.map(model => {
    const relevance = scoreSingleModel(model, providerId);
    return {
      ...model,
      score: relevance.score,
      reason: relevance.reason,
      relevance
    };
  });

  enriched.sort((a, b) => {
    if (b.relevance.score !== a.relevance.score) {
      return b.relevance.score - a.relevance.score;
    }
    return a.id.localeCompare(b.id);
  });

  return enriched.map((model, index) => ({
    ...model,
    recommended: index === 0 && model.relevance.score > 0
  }));
}
