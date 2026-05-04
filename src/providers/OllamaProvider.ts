import { localJsonRequest } from '../utils/http';
import { BaseProvider, TranscriptionRequest, TranscriptionResponse, ModelInfo, ProviderConnectionResult, ModelProbeResult } from './BaseProvider';

const TINY_TEST_IMAGE =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUVFRUWFhUVFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGhAQGy0lICYtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAoACgMBIgACEQEDEQH/xAAXAAADAQAAAAAAAAAAAAAAAAAAAQID/8QAFhABAQEAAAAAAAAAAAAAAAAAAAER/9oACAEBAAEFAjJbN//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8BP//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8BP//Z';

const KNOWN_VISION_MODELS_SCORES: Record<string, number> = {
  'llava': 90,
  'llava:7b': 88,
  'llava:13b': 85,
  'llava:34b': 80,
  'llava-llama3': 88,
  'llava-phi3': 82,
  'bakllava': 75,
  'minicpm-v': 85,
  'minicpm-v:8b': 83,
  'llama3.2-vision': 92,
  'llama3.2-vision:11b': 90,
  'llama3.2-vision:90b': 95,
  'qwen2-vl': 88,
  'qwen2-vl:7b': 86,
  'qwen2.5vl': 89,
  'gemma3': 70,
};

const DESCRIPTION_ONLY_MODELS = ['moondream', 'moondream2'];



export interface OllamaProviderConfig {
  baseUrl: string;        // Default: 'http://localhost:11434'
  selectedModel: string;  // e.g., 'llava', 'llava:13b', 'bakllava'
}

const OLLAMA_VISION_MODELS = [
  { id: 'llava', displayName: 'LLaVA (llava)', supportsVision: true },
  { id: 'llava:13b', displayName: 'LLaVA 13B', supportsVision: true },
  { id: 'llava:34b', displayName: 'LLaVA 34B', supportsVision: true },
  { id: 'bakllava', displayName: 'BakLLaVA', supportsVision: true },
  { id: 'llava-phi3', displayName: 'LLaVA Phi-3', supportsVision: true },
  { id: 'moondream', displayName: 'Moondream', supportsVision: true },
];

export class OllamaProvider extends BaseProvider {
  readonly providerName = 'ollama';
  readonly displayName = 'Ollama (Local)';

  private config: OllamaProviderConfig;

  constructor(config: OllamaProviderConfig) {
    super();
    this.config = config;
  }

  isConfigured(): boolean {
    return !!this.config.baseUrl && !!this.config.selectedModel;
  }

  getConfigurationStatus(): string {
    if (!this.config.baseUrl) return 'Ollama base URL is not set.';
    if (!this.config.selectedModel) return 'No Ollama model selected.';
    return 'Configured (ensure Ollama is running locally)';
  }

  // @ts-ignore
  private scoreModelId(id: string): number {
    const model = id.toLowerCase();

    // Best handwriting transcription performers (tested, not description-only)
    if (model.startsWith('llama3.2-vision:90b')) return 96;
    if (model.startsWith('llama3.2-vision:11b')) return 94;
    if (model.startsWith('llama3.2-vision')) return 92;
    if (model.startsWith('qwen2.5vl')) return 89;
    if (model.startsWith('qwen2-vl')) return 87;
    if (model.startsWith('minicpm-v')) return 85;
    if (model.startsWith('llava-llama3')) return 83;
    if (model.startsWith('llava-phi3')) return 81;
    if (model.startsWith('llava:34b')) return 80;
    if (model.startsWith('llava:13b')) return 78;
    if (model === 'llava' || model.startsWith('llava:7b')) return 75;
    if (model.startsWith('llava')) return 70;
    if (model.startsWith('bakllava')) return 65;
    if (model.startsWith('gemma3')) return 55;

    // Description-only models — penalise for handwriting
    if (model.startsWith('moondream')) return 5;

    // Unknown — not scored, listed but untested
    return 20;
  }

  async testConnection(): Promise<ProviderConnectionResult> {
    if (!this.config.baseUrl) {
      return { ok: false, message: 'Ollama base URL is not set' };
    }

    try {
      const data = await localJsonRequest({
        url: `${this.config.baseUrl}/api/tags`,
        method: 'GET'
      });

      const count = Array.isArray(data?.models) ? data.models.length : 0;
      return {
        ok: true,
        message: `Successfully connected to Ollama (${count} models found)`
      };
    } catch (error: any) {
      return {
        ok: false,
        message: error?.message || 'Failed to connect to Ollama',
        statusCode: error?.status
      };
    }
  }

  async probeModelCompatibility(model: string): Promise<ModelProbeResult> {
    try {
      await this.transcribe({
        model,
        prompt: 'Reply only with the word OK.',
        imageDataUrl: TINY_TEST_IMAGE,
        maxTokens: 5
      });

      return { ok: true, model };
    } catch (error: any) {
      return {
        ok: false,
        model,
        reason: error?.message || 'Compatibility probe failed'
      };
    }
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
    if (!this.isConfigured()) {
      throw new Error(this.getConfigurationStatus());
    }

    // Ollama /api/generate endpoint with vision (base64 image)
    // Strip the data URL prefix to get raw base64
    const base64Image = request.imageDataUrl.replace(/^data:image\/\w+;base64,/, '');

    try {
      const groundedPrompt = `IMPORTANT: Only describe what you can directly observe in this image. Do not hallucinate, invent, or infer anything not visibly present.\n\n${request.prompt}`;

      const data = await localJsonRequest({
        url: `${this.config.baseUrl}/api/generate`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          prompt: groundedPrompt,
          images: [base64Image],  // Ollama vision API format
          stream: false
        })
      });
      return {
        text: data.response || 'No transcription returned',
        model: request.model,
        provider: this.providerName
      };
    } catch (error: any) {
      const message =
        error?.message ||
        error?.status ||
        "Unknown Ollama request error";
      throw new Error(`Ollama API Error: ${message}`);
    }
  }

  async fetchModels(): Promise<ModelInfo[]> {
    try {
      const data = await localJsonRequest({
        url: `${this.config.baseUrl}/api/tags`,
        method: 'GET'
      });

      const allModels: any[] = data.models ?? [];

      const result: ModelInfo[] = allModels.map((m: any) => {

        const fullName = m.name;
        const isKnownVision = Object.keys(KNOWN_VISION_MODELS_SCORES).some(
          (k) => fullName.toLowerCase().startsWith(k)
        );
        const isDescriptionOnly = DESCRIPTION_ONLY_MODELS.some(
          (k) => fullName.toLowerCase().startsWith(k)
        );
        const score = this.scoreModelId(fullName);

        return {
          id: fullName,
          displayName: fullName,
          supportsVision: isKnownVision,
          provider: this.providerName,
          tested: false,
          testStatus: 'untested',
          score,
          recommended: false,
          reason: isDescriptionOnly
            ? 'Warning: this model describes images rather than transcribing text'
            : isKnownVision
              ? 'Known vision-capable model'
              : 'Not confirmed vision-capable — probe before use',
        };
      });

      return result.sort((a, b) => (b.score || 0) - (a.score || 0));
    } catch {
      return this.getDefaultModels();
    }
  }

  getDefaultModels(): ModelInfo[] {
    return OLLAMA_VISION_MODELS.map((m, index) => ({
      ...m,
      provider: this.providerName,
      tested: false,
      testStatus: 'untested',
      score: this.scoreModelId(m.id),
      recommended: index === 0
    }));
  }


  async rankModelsWithCloudAssistance(
    models: ModelInfo[],
    askCloud: (prompt: string) => Promise<string>
  ): Promise<ModelInfo[]> {
    const modelNames = models.map(m => m.id).join('\n');

    const prompt = `You are an expert in vision language models for OCR and handwritten text transcription.

Given this list of locally installed Ollama models:
${modelNames}

Rank them from best to worst specifically for HANDWRITING TRANSCRIPTION (not image description).
For each model, reply in this exact JSON format, one object per line:
{"model": "<name>", "score": <0-100>, "reason": "<one sentence>", "handwritingCapable": <true|false>}

Only reply with JSON lines, no other text.`;

    try {
      const rawResponse = await askCloud(prompt);
      const lines = rawResponse.split('\n').filter(l => l.trim().startsWith('{'));

      const rankings: Record<string, { score: number; reason: string; capable: boolean }> = {};

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed.model) {
            rankings[parsed.model] = {
              score: parsed.score ?? 50,
              reason: parsed.reason ?? '',
              capable: parsed.handwritingCapable ?? false
            };
          }
        } catch { /* skip malformed lines */ }
      }

      return models.map(m => {
        const rank = rankings[m.id];
        if (rank) {
          return {
            ...m,
            score: rank.score,
            reason: rank.reason,
            supportsVision: rank.capable || m.supportsVision
          };
        }
        return m;
      }).sort((a, b) => (b.score || 0) - (a.score || 0));

    } catch {
      // If cloud ranking fails, fall back to local scores silently
      return models.sort((a, b) => (b.score || 0) - (a.score || 0));
    }
  }

  async pullModel(
    modelId: string,
    onProgress: (status: string) => void
  ): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelId, stream: true })
      });

      if (!response.ok || !response.body) {
        throw new Error(`Pull request failed: HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.status) onProgress(parsed.status);
            if (parsed.status === 'success') return true;
          } catch { /* skip malformed stream lines */ }
        }
      }
      return true;
    } catch (error: any) {
      onProgress(`Pull failed: ${error?.message}`);
      return false;
    }
  }
  updateConfig(config: Partial<OllamaProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
