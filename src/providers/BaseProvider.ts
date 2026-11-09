
export interface TranscriptionRequest { imageDataUrl: string; prompt: string; model: string; maxTokens?: number; }
export interface TranscriptionResponse { text: string; model: string; provider: string; }
export interface ModelInfo { id: string; displayName: string; supportsVision: boolean; recommended?: boolean; tested?: boolean; testStatus?: 'passed' | 'failed' | 'untested'; score?: number; reason?: string; provider?: string; }
export interface ProviderConnectionResult { ok: boolean; message: string; statusCode?: number; }
export interface ModelProbeResult { ok: boolean; model: string; reason?: string; }
export interface ProviderDescriptor { id: string; displayName: string; locality: 'local' | 'remote' | 'configurable'; supportsDiscovery: boolean; supportsCompatibilityProbe: boolean; supportsModelDownload: boolean; }
export abstract class BaseProvider {
  abstract readonly providerName: string;
  abstract readonly displayName: string;
  abstract getDescriptor(): ProviderDescriptor;
  abstract transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse>;
  abstract fetchModels(): Promise<ModelInfo[]>;
  abstract isConfigured(): boolean;
  abstract getConfigurationStatus(): string;
  async testConnection(): Promise<ProviderConnectionResult> {
    return { ok: this.isConfigured(), message: this.isConfigured() ? 'Configured' : this.getConfigurationStatus() };
  }
  async probeModelCompatibility(_model: string): Promise<ModelProbeResult> {
    if (!this.getDescriptor().supportsCompatibilityProbe) return { ok: false, model: _model, reason: 'Model probing not supported by this provider' };
    return { ok: false, model: _model, reason: 'Not implemented in subclass' };
  }
}