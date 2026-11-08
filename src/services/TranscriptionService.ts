import { ResolvedJobConfig } from '../models/types';
import { BaseProvider } from '../providers/BaseProvider';
import { Logger } from '../utils/logger';

export async function processImageWithConfig(
    provider: BaseProvider,
    config: ResolvedJobConfig,
    imageDataUrl: string
): Promise<string> {

    // Core transcription call
    const result = await provider.transcribe({
        imageDataUrl,
        prompt: config.prompt,
        model: config.modelId
    });

    return result.text;
}

export async function detectDiagramWithConfig(
    provider: BaseProvider,
    config: ResolvedJobConfig,
    imageDataUrl: string
): Promise<boolean> {
    try {
        const result = await provider.transcribe({
            imageDataUrl,
            prompt: "Does this image contain a diagram, chart, drawing, or visual representation? Answer only with 'yes' or 'no'.",
            model: config.modelId,
            maxTokens: 10
        });
        return result.text.toLowerCase().includes('yes');
    } catch (error) {
        Logger.error('Job', 'Failed diagram detection', { error: (error as any).message });
        return false;
    }
}
