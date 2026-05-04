import { remoteJsonRequest } from '../utils/http';
import { BaseProvider, TranscriptionRequest, TranscriptionResponse, ModelInfo, ProviderConnectionResult, ModelProbeResult } from './BaseProvider';

const OPENAI_FALLBACK_MODELS: ModelInfo[] = [
  { id: 'gpt-4.1', displayName: 'gpt-4.1', supportsVision: true, provider: 'openai', testStatus: 'untested' },
  { id: 'gpt-4o', displayName: 'gpt-4o', supportsVision: true, provider: 'openai', testStatus: 'untested' },
  { id: 'gpt-4-turbo', displayName: 'gpt-4-turbo', supportsVision: true, provider: 'openai', testStatus: 'untested' }
];

const TINY_TEST_IMAGE =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUVFRUWFhUVFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGhAQGy0lICYtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAoACgMBIgACEQEDEQH/xAAXAAADAQAAAAAAAAAAAAAAAAAAAQID/8QAFhABAQEAAAAAAAAAAAAAAAAAAAER/9oACAEBAAEFAjJbN//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8BP//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8BP//Z';

export interface OpenAIProviderConfig {
  apiKey: string;
  selectedModel: string;
}

export class OpenAIProvider extends BaseProvider {
  readonly providerName = 'openai';
  readonly displayName = 'OpenAI';

  private config: OpenAIProviderConfig;

  constructor(config: OpenAIProviderConfig) {
    super();
    this.config = config;
  }

  isConfigured(): boolean {
    return !!this.config.apiKey && this.config.apiKey.startsWith('sk-');
  }

  getConfigurationStatus(): string {
    if (!this.config.apiKey) return 'OpenAI API key is not set. Go to Settings → PDF Transcriber.';
    if (!this.config.apiKey.startsWith('sk-')) return 'OpenAI API key appears invalid (should start with sk-).';
    return 'Configured';
  }

  private scoreModelId(id: string): number {
    const model = id.toLowerCase();
    if (model === 'gpt-4.1') return 100;
    if (model.startsWith('gpt-4.1')) return 95;
    if (model === 'gpt-4o') return 90;
    if (model.startsWith('gpt-4o')) return 85;
    if (model === 'gpt-4-turbo') return 75;
    if (model.startsWith('gpt-4')) return 60;
    return 0;
  }

  private isLikelySupportedVisionModel(id: string): boolean {
    const model = id.toLowerCase();
    return model.startsWith('gpt-4.1') || model.startsWith('gpt-4o') || model.startsWith('gpt-4');
  }

  async testConnection(): Promise<ProviderConnectionResult> {
    if (!this.config.apiKey) {
      return { ok: false, message: 'OpenAI API key is not set' };
    }

    if (!this.config.apiKey.startsWith('sk-')) {
      return { ok: false, message: 'OpenAI API key appears invalid (should start with sk-)' };
    }

    try {
      await remoteJsonRequest({
        url: 'https://api.openai.com/v1/models',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`
        }
      });

      return { ok: true, message: 'Successfully connected to OpenAI' };
    } catch (error: any) {
      return {
        ok: false,
        message: error?.message || 'Failed to connect to OpenAI',
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

    try {
      const data = await remoteJsonRequest({
        url: "https://api.openai.com/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: request.prompt },
                { type: "image_url", image_url: { url: request.imageDataUrl } }
              ]
            }
          ],
          max_tokens: request.maxTokens ?? 4096
        })
      });
      return {
        text: data?.choices?.[0]?.message?.content || "No transcription returned",
        model: request.model,
        provider: this.providerName
      };
    } catch (error: any) {
      const message =
        error?.message ||
        error?.status ||
        "Unknown OpenAI request error";
      throw new Error(`OpenAI API Error: ${message}`);
    }
  }

  async fetchModels(): Promise<ModelInfo[]> {
    if (!this.config.apiKey) return this.getDefaultModels();

    try {
      const data = await remoteJsonRequest({
        url: 'https://api.openai.com/v1/models',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`
        }
      });

      const models: ModelInfo[] = (data.data || [])
        .filter((model: any) => this.isLikelySupportedVisionModel(model.id))
        .map((model: any) => ({
          id: model.id,
          displayName: model.id,
          supportsVision: true,
          provider: this.providerName,
          tested: false,
          testStatus: 'untested',
          score: this.scoreModelId(model.id),
          recommended: false
        }))
        .sort((a: any, b: any) => (b.score || 0) - (a.score || 0));

      return models.length > 0 ? models : this.getDefaultModels();
    } catch {
      return this.getDefaultModels();
    }
  }

  getDefaultModels(): ModelInfo[] {
    return OPENAI_FALLBACK_MODELS.map((m, index) => ({
      ...m,
      recommended: index === 0,
      score: this.scoreModelId(m.id)
    }));
  }

  // Allow settings to update the config without reinstantiating
  updateConfig(config: Partial<OpenAIProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
