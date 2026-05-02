export interface TranscriptionRequest {
  imageDataUrl: string;   // base64 JPEG data URL of the rendered PDF page
  prompt: string;         // The instruction prompt for the model
  model: string;          // Model identifier string
  maxTokens?: number;     // Default 4096
}

export interface TranscriptionResponse {
  text: string;           // The transcribed/processed text
  model: string;          // Model that was used
  provider: string;       // Provider name (for logging/debugging)
}

export interface ModelInfo {
  id: string;             // Model identifier used in API calls
  displayName: string;    // Human-readable name shown in settings dropdown
  supportsVision: boolean; // Whether this model can process images
}

export abstract class BaseProvider {
  abstract readonly providerName: string;  // e.g., 'openai', 'ollama'
  abstract readonly displayName: string;   // e.g., 'OpenAI', 'Ollama (Local)'

  // Core transcription call — must be implemented by all providers
  abstract transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse>;

  // Fetch list of available models from the provider
  abstract fetchModels(): Promise<ModelInfo[]>;

  // Check if the provider is correctly configured (API key set, server reachable, etc.)
  abstract isConfigured(): boolean;

  // Return a human-readable string explaining what configuration is missing
  abstract getConfigurationStatus(): string;
}
