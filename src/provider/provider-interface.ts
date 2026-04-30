/**
 * Abstract interface for AI transcription providers.
 * All providers (OpenAI, Ollama, etc.) must implement this interface.
 */
export interface TranscriptionProvider {
  /**
   * Human-readable name for UI display (e.g. "OpenAI gpt-4o", "Ollama llava")
   */
  readonly displayName: string;

  /**
   * Validate that the provider is correctly configured and reachable.
   * Should throw a descriptive Error if validation fails.
   */
  validate(): Promise<void>;

  /**
   * Transcribe the content of a single image.
   * @param imageDataUrl  A data URL string: "data:image/jpeg;base64,..."
   * @param prompt        The instruction to send to the model
   * @returns             The transcribed text
   */
  transcribeImage(imageDataUrl: string, prompt: string): Promise<string>;
}