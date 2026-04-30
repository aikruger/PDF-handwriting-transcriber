import { TranscriptionProvider } from './provider-interface';

interface OllamaChatRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string;
    images: string[];
  }>;
  stream: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
}

interface OllamaTagsResponse {
  models: Array<{ name: string; modified_at: string; size: number }>;
}

export class OllamaProvider implements TranscriptionProvider {
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;
  private inactivityTimeoutMs: number;
  private disableInactivityAbort: boolean;

  constructor(baseUrl: string, model: string, timeoutMs: number, inactivityTimeoutMs: number, disableInactivityAbort: boolean = false) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.inactivityTimeoutMs = inactivityTimeoutMs;
    this.disableInactivityAbort = disableInactivityAbort;
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

  /**
   * Compress a base64 PNG/JPEG to a maximum width before sending to Ollama.
   * Vision models don't benefit from images wider than 1024-1280px.
   * Reducing a 3000px page to 1024px cuts payload size by ~85%.
   */
  private static async compressBase64Image(
    base64: string,
    maxWidth: number
  ): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();

      img.onload = () => {
        // If already small enough, return original unchanged
        if (img.width <= maxWidth) {
          resolve(base64);
          return;
        }

        const ratio = maxWidth / img.width;
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = Math.floor(img.height * ratio);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(base64); // Fallback: return original if canvas fails
          return;
        }

        // White background (important for handwriting)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // JPEG at 0.88 quality gives excellent text reproduction at smaller size
        const compressed = canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
        resolve(compressed!);
      };

      img.onerror = () => resolve(base64); // Fallback on error
      img.src = `data:image/png;base64,${base64}`;
    });
  }

  async transcribeImage(imageDataUrl: string, prompt: string): Promise<string> {
    // Strip the data URL prefix — Ollama expects raw base64
    const base64 = imageDataUrl.includes(',')
      ? imageDataUrl.split(',')[1]
      : imageDataUrl;

    const compressedImage = await OllamaProvider.compressBase64Image(base64!, 1024);

    const requestBody: OllamaChatRequest = {
      model: this.model,
      messages: [
        {
          role: 'user',
          content: prompt,
          images: [compressedImage],
        }
      ],
      stream: true,
      options: {
        temperature: 0.1,
        num_predict: 4096,
      },
    };

    const controller = new AbortController();

    let inactivityTimer: number;
    let abortReason: string | null = null;
    const resetInactivity = () => {
      if (this.disableInactivityAbort) return;
      window.clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(() => {
        abortReason = "inactivity";
        controller.abort();
      }, this.inactivityTimeoutMs);
    };

    // Also keep an absolute ceiling to prevent infinite hangs
    const absoluteTimer = window.setTimeout(() => {
      abortReason = "absolute-timeout";
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
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

      if (!response.body) {
        throw new Error('Ollama returned no response body. The model may not support vision input.');
      }

      // Read the stream, collecting tokens as they arrive
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullResponse = '';

      resetInactivity(); // Start inactivity timer

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        resetInactivity(); // Reset on every chunk received

        // Each chunk may contain one or more newline-delimited JSON objects
        const chunkText = decoder.decode(value, { stream: true });
        const lines = chunkText.split('\n').filter(line => line.trim().length > 0);

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as { message?: { role: string; content: string }; done?: boolean; error?: string };

            if (parsed.error) {
              throw new Error(`Ollama model error: ${parsed.error}`);
            }

            if (parsed.message && parsed.message.content) {
              fullResponse += parsed.message.content;
            }

            if (parsed.done) {
              // Stream complete
              return fullResponse.trim();
            }
          } catch (parseErr) {
            // Ignore malformed JSON lines (can happen at stream boundaries)
            if ((parseErr as Error).message.startsWith('Ollama model error')) {
              throw parseErr;
            }
          }
        }
      }

      return fullResponse.trim() || '*[Model returned no text]*';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        if (abortReason === "inactivity") {
          throw new Error(
            `Ollama produced no response chunks for ${Math.round(this.inactivityTimeoutMs / 1000)} seconds. ` +
            `Try: (1) reduce Page render scale to 1.0–1.5, (2) use a smaller vision model like moondream or llava:7b, ` +
            `(3) confirm the model is loaded with "ollama ps", (4) increase the inactivity timeout in plugin settings.`
          );
        }
        if (abortReason === "absolute-timeout") {
          throw new Error(
            `Ollama exceeded the absolute timeout of ${Math.round(this.timeoutMs / 1000)} seconds for this page. ` +
            `Increase the timeout or reduce page image size/render scale.`
          );
        }
        throw new Error("Ollama request was aborted before a response completed.");
      }
      throw err;
    } finally {
      window.clearTimeout(inactivityTimer!);
      window.clearTimeout(absoluteTimer);
    }
  }
}