import { ResolvedJobConfig, TaskKind, PluginSettings } from '../models/types';
import { Logger } from '../utils/logger';

export function contentModeToTask(mode: 'text' | 'diagram' | 'mixed'): TaskKind {
    return mode === 'text' ? 'handwriting' : mode;
}

export function resolveJobConfig(
  settings: PluginSettings,
  mode: 'text' | 'diagram' | 'mixed',
  customOptions: any
): ResolvedJobConfig {
  let profileId = settings.activeProfileId;
  const task = contentModeToTask(mode);

  if (customOptions.overrideProfileId) {
     profileId = customOptions.overrideProfileId;
  }

  const profile = settings.profiles.find(p => p.id === profileId);
  if (!profile) throw new Error(`Profile "${profileId}" not found`);
  if (!profile.enabled) throw new Error(`Profile "${profile.displayName}" is disabled. Enable it in settings.`);

  let modelId = customOptions.overrideModelId;

  if (!modelId) {
      if (settings.taskDefaults && settings.taskDefaults[task] && settings.taskDefaults[task]?.profileId === profile.id) {
          modelId = settings.taskDefaults[task]?.modelId;
      }
      if (!modelId && profile.selectedModels) modelId = profile.selectedModels[task];
  }

  if (!modelId) throw new Error(`No model selected for task "${task}" on profile "${profile.displayName}".`);

  let prompt = '';
  switch (mode) {
      case 'text': prompt = customOptions.textPrompt || settings.defaultTextPrompt; break;
      case 'diagram': prompt = customOptions.diagramPrompt || settings.defaultDiagramPrompt; break;
      case 'mixed': prompt = customOptions.mixedPrompt || settings.defaultMixedPrompt; break;
  }
  if (!prompt.trim()) throw new Error(`Prompt for mode "${mode}" cannot be empty.`);

  const resolved: ResolvedJobConfig = { profileId: profile.id, adapterId: profile.adapterId, modelId: modelId, task, prompt, routingPolicy: profile.options || {} };
  Logger.log('Job', 'Resolved configuration', { profileId: resolved.profileId, modelId: resolved.modelId, task: resolved.task });
  return resolved;
}