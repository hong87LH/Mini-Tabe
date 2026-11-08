export type MediaReferenceState = {
  fieldId: string;
  fieldName: string;
  itemCount: number;
};

export type GenerationPreviewWarning = {
  code: string;
  message: string;
  details: {
    fields: Array<{ fieldId: string; fieldName: string }>;
  };
};

export const buildOptionalMediaReferenceWarnings = (
  references: MediaReferenceState[]
): GenerationPreviewWarning[] => {
  const emptyFields = references
    .filter(reference => reference.itemCount === 0)
    .map(({ fieldId, fieldName }) => ({ fieldId, fieldName }));

  if (emptyFields.length === 0) return [];

  return [{
    code: 'MEDIA_REFERENCE_EMPTY_SKIPPED',
    message: 'Empty referenced media fields are optional and will be skipped.',
    details: { fields: emptyFields }
  }];
};

export const isGenerationPreviewReady = (
  skipped: boolean,
  blockingReasons: readonly unknown[]
): boolean => !skipped && blockingReasons.length === 0;

export const parseResolvedLoraProfiles = (values: readonly string[] = []): string[] => (
  [...new Set(values
    .flatMap(value => String(value || '').split(/[,，;；\n]/))
    .map(value => value.trim())
    .filter(Boolean))]
);

export type MediaInputCounts = {
  images: number;
  videos: number;
  audio: number;
};

export type RegisteredWorkflow = {
  id: string;
  aliases?: string[];
  mediaType?: string;
  modelRequirements?: Array<Record<string, unknown>>;
  loraProfiles?: Array<{
    id: string;
    name?: string;
    file?: string;
    defaultStrength?: number;
  }>;
  aliasLoraProfiles?: Record<string, string[]>;
  capabilities?: {
    inputImages?: { min?: number; max?: number };
    inputVideos?: { min?: number; max?: number };
    inputAudio?: { min?: number; max?: number };
    minTotalReferences?: number;
    resolutions?: string[];
    resolutionCoefficient?: { min?: number; max?: number };
    [key: string]: unknown;
  };
};

export type WorkflowResolutionValidation = {
  blockingReasons: Array<{
    code: 'WORKFLOW_RESOLUTION_UNSUPPORTED';
    message: string;
    details: Record<string, unknown>;
  }>;
};

export const validateSelectedWorkflowResolution = (
  workflow: RegisteredWorkflow | null,
  model: string | null | undefined,
  resolution: string | null | undefined
): WorkflowResolutionValidation => {
  if (!workflow || !String(resolution || '').trim()) return { blockingReasons: [] };

  const capabilities = workflow.capabilities || {};
  const available = (capabilities.resolutions || []).map(value => String(value).trim().toUpperCase());
  const raw = String(resolution).trim().toUpperCase();
  const coefficientRange = capabilities.resolutionCoefficient;
  const coefficientMatch = raw.match(/^(\d+(?:\.\d+)?)K?$/);
  const coefficient = raw === '1024X1024' ? 1 : coefficientMatch ? Number(coefficientMatch[1]) : NaN;
  const coefficientAllowed = coefficientRange && Number.isFinite(coefficient)
    && coefficient >= Number(coefficientRange.min ?? Number.NEGATIVE_INFINITY)
    && coefficient <= Number(coefficientRange.max ?? Number.POSITIVE_INFINITY);
  const unrestricted = available.length === 0 && !coefficientRange;
  const exactAllowed = available.includes(raw);

  if (unrestricted || exactAllowed || coefficientAllowed) return { blockingReasons: [] };

  return {
    blockingReasons: [{
      code: 'WORKFLOW_RESOLUTION_UNSUPPORTED',
      message: `The selected workflow ${workflow.id} does not support the resolved resolution ${resolution}.`,
      details: {
        model: model || null,
        workflowId: workflow.id,
        resolution,
        availableResolutions: available,
        resolutionCoefficient: coefficientRange || null
      }
    }]
  };
};

export type WorkflowLoraValidation = {
  appliedProfiles: string[];
  blockingReasons: Array<{
    code: 'WORKFLOW_LORA_PROFILE_UNSUPPORTED';
    message: string;
    details: Record<string, unknown>;
  }>;
};

export const validateSelectedWorkflowLoraProfiles = (
  workflow: RegisteredWorkflow | null,
  model: string | null | undefined,
  requestedProfiles: readonly string[] = []
): WorkflowLoraValidation => {
  if (!workflow) return { appliedProfiles: [], blockingReasons: [] };

  const normalizedModel = String(model || '').trim().toLowerCase();
  const aliasProfiles = Object.entries(workflow.aliasLoraProfiles || {})
    .find(([alias]) => alias.trim().toLowerCase() === normalizedModel)?.[1] || [];
  const appliedProfiles = [...new Set([...aliasProfiles, ...requestedProfiles]
    .map(profile => String(profile).trim())
    .filter(Boolean))];
  const availableProfiles = new Set((workflow.loraProfiles || []).map(profile => profile.id));
  const unsupported = appliedProfiles.filter(profile => !availableProfiles.has(profile));

  return {
    appliedProfiles,
    blockingReasons: unsupported.length === 0 ? [] : [{
      code: 'WORKFLOW_LORA_PROFILE_UNSUPPORTED',
      message: `The selected workflow ${workflow.id} does not register one or more requested LoRA profiles.`,
      details: {
        model: model || null,
        workflowId: workflow.id,
        requestedProfiles: appliedProfiles,
        unsupportedProfiles: unsupported,
        availableProfiles: [...availableProfiles]
      }
    }]
  };
};

export type WorkflowInputValidation = {
  workflow: RegisteredWorkflow | null;
  blockingReasons: Array<{
    code: 'WORKFLOW_NOT_REGISTERED' | 'WORKFLOW_INPUT_UNSUPPORTED';
    message: string;
    details: Record<string, unknown>;
  }>;
};

export const validateSelectedWorkflowInputs = (
  provider: string | null | undefined,
  model: string | null | undefined,
  counts: MediaInputCounts,
  workflows: readonly RegisteredWorkflow[],
  expectedMediaType?: string
): WorkflowInputValidation => {
  if (provider !== 'comfyui' || workflows.length === 0) {
    return { workflow: null, blockingReasons: [] };
  }

  const normalizedModel = String(model || '').trim().toLowerCase();
  const workflow = workflows.find(candidate => (
    [candidate.id, ...(candidate.aliases || [])]
      .map(name => String(name).trim().toLowerCase())
      .includes(normalizedModel)
  )) || null;

  if (!workflow) {
    return {
      workflow: null,
      blockingReasons: [{
        code: 'WORKFLOW_NOT_REGISTERED',
        message: `The selected ComfyUI workflow is not registered: ${model || ''}`,
        details: { model: model || null }
      }]
    };
  }

  const capabilities = workflow.capabilities || {};
  const violations: string[] = [];
  if (expectedMediaType && workflow.mediaType && expectedMediaType !== workflow.mediaType) {
    violations.push(`workflow generates ${workflow.mediaType}, field requires ${expectedMediaType}`);
  }
  const checkRange = (label: string, value: number, range?: { min?: number; max?: number }) => {
    if (!range) return;
    const min = Number(range.min ?? 0);
    const max = Number(range.max ?? Number.POSITIVE_INFINITY);
    if (value < min || value > max) violations.push(`${label} requires ${min}-${max}, received ${value}`);
  };
  checkRange('images', counts.images, capabilities.inputImages);
  checkRange('videos', counts.videos, capabilities.inputVideos);
  checkRange('audio', counts.audio, capabilities.inputAudio);
  const totalReferences = counts.images + counts.videos + counts.audio;
  const minTotalReferences = Number(capabilities.minTotalReferences ?? 0);
  if (totalReferences < minTotalReferences) {
    violations.push(`total references requires at least ${minTotalReferences}, received ${totalReferences}`);
  }

  return {
    workflow,
    blockingReasons: violations.length === 0 ? [] : [{
      code: 'WORKFLOW_INPUT_UNSUPPORTED',
      message: `The selected workflow ${workflow.id} does not support the resolved media inputs.`,
      details: {
        model: model || null,
        workflowId: workflow.id,
        counts,
        violations
      }
    }]
  };
};
