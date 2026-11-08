import { BaseProvider } from './BaseProvider';
import { ProviderProfile } from '../models/types';
import { OpenAIProvider } from './OpenAIProvider';
import { OllamaProvider } from './OllamaProvider';
import { OpenRouterProvider } from './OpenRouterProvider';

export class ProviderRegistry {
  private adapters = new Map<string, typeof BaseProvider>();

  constructor() {
    // Register known adapters
    this.adapters.set('openai', OpenAIProvider as any);
    this.adapters.set('ollama', OllamaProvider as any);
    this.adapters.set('openrouter', OpenRouterProvider as any);
  }

  getAdapter(profile: ProviderProfile): BaseProvider {
    if (!profile.enabled && profile.adapterId !== 'openai' && profile.adapterId !== 'openrouter') {
      throw new Error(`Profile ${profile.displayName} is disabled.`);
    }

    const AdapterClass = this.adapters.get(profile.adapterId);
    if (!AdapterClass) {
      throw new Error(`Unknown adapter ID: ${profile.adapterId}`);
    }

    let config: any = {};
    if (profile.adapterId === 'openai') {
      config = { apiKey: profile.credentialRef || '' };
    } else if (profile.adapterId === 'ollama') {
      config = { baseUrl: profile.baseUrl || '', selectedModel: profile.selectedModels.handwriting || '' };
    } else if (profile.adapterId === 'openrouter') {
      config = {
        apiKey: profile.credentialRef || '',
        requireDataPrivacy: profile.options?.requireDataPrivacy ?? true,
        allowUpstreamFallback: profile.options?.allowUpstreamFallback ?? false,
        allowedUpstreamProviders: profile.options?.allowedUpstreamProviders ?? []
      };
    }

    // @ts-ignore
    const adapter = new AdapterClass(config);
    return adapter;
  }
}
