export type TaskKind = 'handwriting' | 'diagram' | 'mixed';

export interface ProviderProfile {
  id: string;
  adapterId: string;
  displayName: string;
  enabled: boolean;
  baseUrl?: string;
  credentialRef?: string;
  selectedModels: {
    handwriting?: string;
    diagram?: string;
    mixed?: string;
  };
  options: Record<string, unknown>;
}

export interface ModelSelection {
  profileId: string;
  modelId: string;
}

export interface TaskSelections {
  handwriting?: ModelSelection;
  diagram?: ModelSelection;
  mixed?: ModelSelection;
}

export interface ModelEvidence {
  profileId: string;
  modelId: string;
  capabilitySource: 'catalogue' | 'provider-metadata' | 'manual' | 'unknown';
  compatibility: {
    status: 'untested' | 'passed' | 'failed' | 'inconclusive';
    testedAt?: string;
    reason?: string;
  };
  quality: Partial<Record<TaskKind, {
    score: number;
    sampleCount: number;
    benchmarkVersion: string;
    testedAt: string;
    evidenceLevel: 'small-sample' | 'evaluated';
  }>>;
}

export interface ResolvedJobConfig {
  profileId: string;
  adapterId: string;
  modelId: string;
  task: TaskKind;
  prompt: string;
  routingPolicy: Readonly<Record<string, unknown>>;
}

export interface PluginSettings {
  version: number;
  profiles: ProviderProfile[];
  activeProfileId: string;
  taskDefaults: TaskSelections;
  defaultPdfFolder: string;
  maxPages: number;
  pageStart: number;
  pageEnd: number;
  batchSize: number;
  renderScale: number;
  imageQuality: number;
  defaultTextPrompt: string;
  defaultDiagramPrompt: string;
  defaultMixedPrompt: string;
  detectDiagrams: boolean;
  useMermaid: boolean;
  contentMode: 'text' | 'diagram' | 'mixed';
  legacyApiKey?: string;
}
