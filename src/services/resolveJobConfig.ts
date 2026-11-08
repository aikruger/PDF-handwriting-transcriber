import { ResolvedJobConfig, TaskKind, PluginSettings } from '../models/types';
import { Logger } from '../utils/logger';

export function resolveJobConfig(
  settings: PluginSettings,
  task: TaskKind,
  customOptions: any
): ResolvedJobConfig {
  let profileId = settings.activeProfileId;

  if (customOptions.overrideProvider) {
     profileId = customOptions.overrideProvider;
  }

  const profile = settings.profiles.find(p => p.id === profileId);
  if (!profile) {
      throw new Error(`Profile ${profileId} not found`);
  }

  let modelId = customOptions.overrideModel;

  if (!modelId) {
      // Get the default for the specific task
      if (profile.selectedModels) {
          modelId = profile.selectedModels[task];
      }

      // Fallback if not configured
      if (!modelId) {
           modelId = Object.values(profile.selectedModels || {})[0] as string;
      }
  }

  let prompt = '';
  switch (task) {
      case 'handwriting': prompt = customOptions.textPrompt || settings.defaultTextPrompt; break;
      case 'diagram': prompt = customOptions.diagramPrompt || settings.defaultDiagramPrompt; break;
      case 'mixed': prompt = customOptions.mixedPrompt || settings.defaultMixedPrompt; break;
  }

  const resolved: ResolvedJobConfig = {
      profileId: profile.id,
      adapterId: profile.adapterId,
      modelId: modelId || '',
      task,
      prompt,
      routingPolicy: profile.options || {}
  };

  Logger.log('Job', 'Resolved configuration', {
      profileId: resolved.profileId,
      modelId: resolved.modelId,
      task: resolved.task
  });

  return resolved;
}
