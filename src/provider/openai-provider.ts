import { TranscriptionProvider } from './provider-interface';
import { OPENAI_API_URL } from '../constants';

export class OpenAIProvider implements TranscriptionProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  get displayName(): string {
    return `OpenAI ${this.model}`;
  }

  async validate(): Promise<void> {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error(
        'OpenAI API key is not set. Go to Settings → PDF Transcriber and enter your API key.'
      );
    }
    if (!this.apiKey.startsWith('sk-')) {
      throw new Error(
        'OpenAI API key appears invalid (should start with "sk-"). Check your settings.'
      );
    }
  }

  async transcribeImage(imageDataUrl: string, prompt: string): Promise<string> {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: imageDataUrl, detail: 'high' },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as any)?.error?.message || `HTTP ${response.status}`;
      if (response.status === 401) {
        throw new Error(`Invalid OpenAI API key: ${errorMessage}`);
      }
      if (response.status === 429) {
        throw new Error(`OpenAI rate limit exceeded: ${errorMessage}`);
      }
      throw new Error(`OpenAI API error: ${errorMessage}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('OpenAI returned an empty response.');
    }

    return content.trim();
  }
}