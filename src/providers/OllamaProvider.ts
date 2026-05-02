import { localJsonRequest } from '../utils/http';
import { BaseProvider, TranscriptionRequest, TranscriptionResponse, ModelInfo } from './BaseProvider';

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

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
    if (!this.isConfigured()) {
      throw new Error(this.getConfigurationStatus());
    }

    // Ollama /api/generate endpoint with vision (base64 image)
    // Strip the data URL prefix to get raw base64
    const base64Image = request.imageDataUrl.replace(/^data:image\/\w+;base64,/, '');

    try {
      const data = await localJsonRequest({
        url: `${this.config.baseUrl}/api/generate`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
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
        method: "GET"
      });
      const installedModels: ModelInfo[] = data.models
        ?.filter((m: any) => {
          // Only show models that are likely vision-capable
          const name = m.name.toLowerCase();
          return name.includes('llava') ||
                 name.includes('bakllava') ||
                 name.includes('moondream') ||
                 name.includes('llava-phi') ||
                 name.includes('minicpm') ||
                 name.includes('vision');
        })
        .map((m: any): ModelInfo => ({
          id: m.name,
          displayName: m.name,
          supportsVision: true
        })) ?? [];

      return installedModels.length > 0 ? installedModels : OLLAMA_VISION_MODELS;
    } catch (error) {
      // Return known vision-capable models as fallback if Ollama is unreachable
      return OLLAMA_VISION_MODELS;
    }
  }

  updateConfig(config: Partial<OllamaProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
