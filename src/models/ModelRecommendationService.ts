import { ModelEvidence, TaskKind } from './types';
import { Logger } from '../utils/logger';

export interface RecommendationPolicy {
    strategy: 'quality' | 'balanced' | 'local-only';
}

export class ModelRecommendationService {
    recommend(
        candidates: ModelEvidence[],
        task: TaskKind,
        policy: RecommendationPolicy
    ): string | null {
        if (!candidates || candidates.length === 0) return null;

        // Filter out those with failed compatibility
        let eligible = candidates.filter(c => c.compatibility.status !== 'failed');

        if (eligible.length === 0) return null;

        if (policy.strategy === 'local-only') {
            // Note: We'd need to know if it's local. We can infer from profileId if it contains "ollama"
            // For now just basic filtering
            eligible = eligible.filter(c => c.profileId.includes('ollama'));
        }

        // Rank by quality score
        eligible.sort((a, b) => {
            const scoreA = a.quality[task]?.score || 0;
            const scoreB = b.quality[task]?.score || 0;
            return scoreB - scoreA;
        });

        const best = eligible[0];

        // If highest score is 0 and we haven't evaluated, just return the first one as fallback,
        // but log it's unverified.
        const isVerified = (best.quality[task]?.score || 0) > 0;

        Logger.log('Recommendation', 'Selected model for task', {
            task,
            modelId: best.modelId,
            verified: isVerified
        });

        return best.modelId;
    }
}
