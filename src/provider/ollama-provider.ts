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

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`, {
      method: 'GET',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as OllamaTagsResponse;
    return (data.models ?? []).map((m) => m.name);
  }

  /**
   * Fetch installed models and filter for vision-capable ones.
   * Returns an object with all models and vision-only models.
   */
  async fetchInstalledModels(): Promise<{
    all: string[];
    visionLikely: string[];
  }> {
    const all = await this.listModels();

    // These model name prefixes are known to support vision input
    const VISION_PREFIXES = [
      'llava',
      'llava-llama3',
      'llava-phi3',
      'bakllava',
      'minicpm-v',
      'moondream',
      'llama3.2-vision',
      'llama3-vision',
      'phi3-vision',
      'cogvlm',
      'internvl',
      'qwen-vl',
      'deepseek-vl',
      'omnivore',
      'pixtral',
      'mistral-vision',
    ];

    const visionLikely = all.filter((name) => {
      const lower = name.toLowerCase();
      return VISION_PREFIXES.some((prefix) => lower.startsWith(prefix));
    });

    return { all, visionLikely };
  }

  async validate(): Promise<void> {
    let models: string[];
    try {
      models = await this.listModels();
    } catch (err) {
      throw new Error(
        `Cannot reach Ollama at "${this.baseUrl}".\n` +
          'Steps to fix:\n' +
          '  1. Install Ollama from https://ollama.com\n' +
          '  2. Run: ollama serve\n' +
          '  3. Pull a vision model: ollama pull llava\n' +
          `  4. Verify settings URL is correct (currently: ${this.baseUrl})`
      );
    }

    if (models.length === 0) {
      throw new Error(
        'Ollama is running but no models are installed.\n' +
        'Install a vision model with: ollama pull llava\n' +
        'Other options: ollama pull minicpm-v  |  ollama pull llama3.2-vision'
      );
    }

    const modelName = this.model;
    const baseName = modelName.split(':')[0].toLowerCase();
    const isAvailable = models.some(
      (m) => m.toLowerCase().startsWith(baseName)
    );

    if (!isAvailable) {
      const available = models.join(', ');
      throw new Error(
        `Model "${modelName}" is not installed.\n` +
        `To install it, run: ollama pull ${modelName}\n\n` +
        `Models currently installed: ${available}\n\n` +
        'Go to Settings → PDF Handwriting Transcriber → click "Refresh models" ' +
        'to select an installed model.'
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
        let errorBody = '';
        try {
          const errJson = await response.json() as { error?: string };
          errorBody = errJson.error ?? await response.text();
        } catch {
          errorBody = await response.text().catch(() => 'Unknown error');
        }

        if (response.status === 404) {
          throw new Error(
            `Model "${this.model}" is not installed in Ollama.\n` +
            `Run this command in your terminal: ollama pull ${this.model}\n` +
            `Then retry the transcription.`
          );
        }

        if (response.status === 400 && errorBody.toLowerCase().includes('vision')) {
          throw new Error(
            `Model "${this.model}" does not support vision/image input.\n` +
            `Use a vision-capable model such as: llava, minicpm-v, llama3.2-vision, moondream`
          );
        }

        throw new Error(`Ollama API error ${response.status}: ${errorBody}`);
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