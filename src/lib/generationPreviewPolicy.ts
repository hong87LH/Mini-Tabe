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

export type MediaInputCounts = {
  images: number;
  videos: number;
  audio: number;
};

export type RegisteredWorkflow = {
  id: string;
  aliases?: string[];
  capabilities?: {
    inputImages?: { min?: number; max?: number };
    inputVideos?: { min?: number; max?: number };
    inputAudio?: { min?: number; max?: number };
    minTotalReferences?: number;
    [key: string]: unknown;
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
  workflows: readonly RegisteredWorkflow[]
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
