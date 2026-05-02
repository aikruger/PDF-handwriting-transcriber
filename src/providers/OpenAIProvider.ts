import { BaseProvider, TranscriptionRequest, TranscriptionResponse, ModelInfo } from './BaseProvider';

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

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
    if (!this.isConfigured()) {
      throw new Error(this.getConfigurationStatus());
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: request.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: request.prompt },
            { type: 'image_url', image_url: { url: request.imageDataUrl } }
          ]
        }],
        max_tokens: request.maxTokens ?? 4096
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API Error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return {
      text: data.choices[0]?.message?.content || 'No transcription returned',
      model: request.model,
      provider: this.providerName
    };
  }

  async fetchModels(): Promise<ModelInfo[]> {
    if (!this.config.apiKey) return this.getDefaultModels();

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` }
      });

      if (!response.ok) throw new Error('Failed to fetch models');

      const data = await response.json();

      // Filter for vision-capable models — preserve existing logic exactly
      const visionModels = data.data
        .filter((model: any) =>
          model.id.includes('vision') ||
          model.id.includes('gpt-4') ||
          model.id.includes('gpt-4o')
        )
        .map((model: any): ModelInfo => ({
          id: model.id,
          displayName: model.id,
          supportsVision: true
        }));

      return visionModels.length > 0 ? visionModels : this.getDefaultModels();
    } catch (error) {
      return this.getDefaultModels();
    }
  }

  // Preserve original hardcoded fallback models exactly
  getDefaultModels(): ModelInfo[] {
    return [
      { id: 'gpt-4-vision', displayName: 'GPT-4 Vision', supportsVision: true },
      { id: 'gpt-4o', displayName: 'GPT-4o', supportsVision: true },
      { id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo', supportsVision: true }
    ];
  }

  // Allow settings to update the config without reinstantiating
  updateConfig(config: Partial<OpenAIProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
