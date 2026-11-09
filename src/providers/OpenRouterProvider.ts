import { BaseProvider, ProviderDescriptor, TranscriptionRequest, TranscriptionResponse, ModelInfo, ProviderConnectionResult } from './BaseProvider';
import { remoteJsonRequest } from '../utils/http';
import { Logger } from '../utils/logger';

export interface OpenRouterConfig { apiKey: string; requireDataPrivacy: boolean; allowUpstreamFallback: boolean; allowedUpstreamProviders: string[]; }

export class OpenRouterProvider extends BaseProvider {
  readonly providerName = 'openrouter'; readonly displayName = 'OpenRouter'; private config: OpenRouterConfig;
  constructor(config: OpenRouterConfig) { super(); this.config = config; }
  getDescriptor(): ProviderDescriptor { return { id: this.providerName, displayName: this.displayName, locality: 'remote', supportsDiscovery: true, supportsCompatibilityProbe: true, supportsModelDownload: false }; }
  isConfigured(): boolean { return !!this.config.apiKey; }
  getConfigurationStatus(): string { return this.isConfigured() ? 'Configured' : 'OpenRouter API key is not set.'; }
  async testConnection(): Promise<ProviderConnectionResult> {
    if (!this.config.apiKey) return { ok: false, message: 'OpenRouter API key is not set' };
    try {
      const data = await remoteJsonRequest({ url: 'https://openrouter.ai/api/v1/auth/key', method: 'GET', headers: { 'Authorization': `Bearer ${this.config.apiKey}` } });
      return { ok: true, message: `Successfully connected to OpenRouter (Key Label: ${data?.data?.label || 'Unknown'})` };
    } catch (error: any) { return { ok: false, message: error?.message || 'Failed to authenticate with OpenRouter', statusCode: error?.status }; }
  }
  async fetchModels(): Promise<ModelInfo[]> {
    try {
      const data = await remoteJsonRequest({ url: 'https://openrouter.ai/api/v1/models', method: 'GET' });
      const result: ModelInfo[] = [];
      for (const m of (data.data ?? [])) {
        if (m.architecture?.modality?.includes('image') && m.architecture?.modality?.includes('text')) {
            result.push({ id: m.id, displayName: m.name, supportsVision: true, provider: this.providerName, tested: false, testStatus: 'untested' });
        }
      }
      return result;
    } catch (e: any) { Logger.error('OpenRouter', 'Failed to fetch models', { message: e.message }); return []; }
  }
  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
    if (!this.isConfigured()) throw new Error(this.getConfigurationStatus());
    try {
      const headers: any = { 'Authorization': `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/obsidianmd/obsidian-sample-plugin', 'X-Title': 'Obsidian PDF Transcriber' };
      const payload = { model: request.model, messages: [ { role: 'user', content: [ { type: 'text', text: request.prompt }, { type: 'image_url', image_url: { url: request.imageDataUrl } } ] } ], max_tokens: request.maxTokens || 4096, provider: { ...(!this.config.allowUpstreamFallback ? { allow_fallbacks: false } : {}), ...(this.config.requireDataPrivacy ? { data_collection: "deny" } : {}), ...(this.config.allowedUpstreamProviders.length > 0 ? { order: this.config.allowedUpstreamProviders } : {}) } };
      const data = await remoteJsonRequest({ url: 'https://openrouter.ai/api/v1/chat/completions', method: 'POST', headers, body: JSON.stringify(payload) });
      const text = data?.choices?.[0]?.message?.content;
      if (!text && text !== '') throw new Error('Malformed output or empty response');
      return { text: text || '', model: data?.model || request.model, provider: this.providerName };
    } catch (error: any) { Logger.error('OpenRouter', 'Transcription request failed', { error: error.message, model: request.model }); throw new Error(`OpenRouter API Error: ${error.message}`); }
  }
}