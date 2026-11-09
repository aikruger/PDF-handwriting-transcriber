import { ResolvedJobConfig } from '../models/types';
import { BaseProvider } from '../providers/BaseProvider';

export async function processImageWithConfig(
    provider: BaseProvider,
    config: ResolvedJobConfig,
    imageDataUrl: string
): Promise<string> {
    const result = await provider.transcribe({ imageDataUrl, prompt: config.prompt, model: config.modelId });
    return result.text;
}