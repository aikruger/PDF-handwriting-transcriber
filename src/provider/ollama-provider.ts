import { TranscriptionProvider } from './provider-interface';

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  images: string[]; // raw base64 strings — NO "data:..." prefix
  stream: false;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

interface OllamaTagsResponse {
  models: Array<{ name: string; modified_at: string; size: number }>;
}

export class OllamaProvider implements TranscriptionProvider {
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;

  constructor(baseUrl: string, model: string, timeoutMs: number) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  get displayName(): string {
    return `Ollama ${this.model}`;
  }

  async validate(): Promise<void> {
    let models: string[];
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as OllamaTagsResponse;
      models = (data.models ?? []).map((m) => m.name);
    } catch (err) {
      throw new Error(
        `Cannot connect to Ollama at "${this.baseUrl}". ` +
          `Make sure Ollama is running (run: ollama serve). ` +
          `Error: ${(err as Error).message}`
      );
    }

    const baseName = this.model.split(':');
    const available = models.some((m) => m.startsWith(baseName[0] as string));

    if (!available) {
      const list = models.join(', ') || 'none installed';
      throw new Error(
        `Ollama model "${this.model}" is not installed. ` +
          `Run: ollama pull ${this.model}\n` +
          `Currently available: ${list}`
      );
    }
  }

  async transcribeImage(imageDataUrl: string, prompt: string): Promise<string> {
    // Strip the data URL prefix — Ollama expects raw base64
    const base64 = imageDataUrl.includes(',')
      ? imageDataUrl.split(',')[1]
      : imageDataUrl;

    const requestBody: OllamaGenerateRequest = {
      model: this.model,
      prompt,
      images: [base64 as string],
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 4096,
      },
    };

    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      this.timeoutMs
    );

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(
          `Ollama API error ${response.status}: ${errorText}. ` +
            `Ensure model "${this.model}" supports vision input.`
        );
      }

      const data = (await response.json()) as OllamaGenerateResponse;

      if (!data.response) {
        throw new Error(
          'Ollama returned an empty response. The model may not support vision/image input.'
        );
      }

      return data.response.trim();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(
          `Ollama request timed out after ${this.timeoutMs / 1000}s. ` +
            'Try increasing the timeout in settings, or use a smaller/faster model.'
        );
      }
      throw err;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
}