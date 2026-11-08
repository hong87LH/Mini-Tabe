import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOptionalMediaReferenceWarnings,
  isGenerationPreviewReady,
  parseResolvedLoraProfiles,
  validateSelectedWorkflowInputs,
  validateSelectedWorkflowLoraProfiles,
  validateSelectedWorkflowResolution
} from '../src/lib/generationPreviewPolicy.ts';

const workflows = [
  {
    id: 'minimax-h3-first-last-router',
    aliases: ['minimax-h3-local'],
    capabilities: {
      inputImages: { min: 0, max: 2 },
      inputVideos: { min: 0, max: 0 },
      inputAudio: { min: 0, max: 0 }
    }
  },
  {
    id: 'minimax-h3-reference-router',
    aliases: ['minimax-h3-Ref-local'],
    capabilities: {
      inputImages: { min: 0, max: 9 },
      inputVideos: { min: 0, max: 3 },
      inputAudio: { min: 0, max: 3 },
      minTotalReferences: 1
    }
  }
];

test('empty media references are warnings and do not block generation', () => {
  const warnings = buildOptionalMediaReferenceWarnings([
    { fieldId: 'fld_image', fieldName: 'AI首帧图', itemCount: 0 }
  ]);

  assert.equal(isGenerationPreviewReady(false, []), true);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'MEDIA_REFERENCE_EMPTY_SKIPPED');
  assert.deepEqual(warnings[0].details.fields, [
    { fieldId: 'fld_image', fieldName: 'AI首帧图' }
  ]);
});

test('mixed media references keep only empty fields in the warning', () => {
  const warnings = buildOptionalMediaReferenceWarnings([
    { fieldId: 'fld_image', fieldName: '参考图片', itemCount: 1 },
    { fieldId: 'fld_video', fieldName: '参考视频', itemCount: 0 },
    { fieldId: 'fld_audio', fieldName: '参考音频', itemCount: 2 }
  ]);

  assert.deepEqual(warnings[0].details.fields, [
    { fieldId: 'fld_video', fieldName: '参考视频' }
  ]);
});

test('non-empty media references produce no warning', () => {
  assert.deepEqual(buildOptionalMediaReferenceWarnings([
    { fieldId: 'fld_image', fieldName: '参考图片', itemCount: 1 }
  ]), []);
});

test('real validation failures still block generation', () => {
  assert.equal(isGenerationPreviewReady(false, [{ code: 'PROMPT_EMPTY' }]), false);
  assert.equal(isGenerationPreviewReady(true, []), false);
});

test('selected text-to-video workflow accepts empty references without changing models', () => {
  const result = validateSelectedWorkflowInputs(
    'comfyui',
    'minimax-h3-local',
    { images: 0, videos: 0, audio: 0 },
    workflows
  );
  assert.equal(result.workflow?.id, 'minimax-h3-first-last-router');
  assert.deepEqual(result.blockingReasons, []);
});

test('selected reference workflow rejects empty inputs instead of changing workflows', () => {
  const result = validateSelectedWorkflowInputs(
    'comfyui',
    'minimax-h3-Ref-local',
    { images: 0, videos: 0, audio: 0 },
    workflows
  );
  assert.equal(result.workflow?.id, 'minimax-h3-reference-router');
  assert.equal(result.blockingReasons[0].code, 'WORKFLOW_INPUT_UNSUPPORTED');
});

test('selected reference workflow accepts any valid remaining reference', () => {
  const result = validateSelectedWorkflowInputs(
    'comfyui',
    'minimax-h3-Ref-local',
    { images: 0, videos: 1, audio: 0 },
    workflows
  );
  assert.equal(result.workflow?.id, 'minimax-h3-reference-router');
  assert.deepEqual(result.blockingReasons, []);
});

test('image workflow cannot preview as video generation', () => {
  const workflows = [{id:'qwen-image-2.1',aliases:['qwen-image-2.1-local'],mediaType:'image',capabilities:{inputImages:{min:0,max:5}}}];
  const counts = {images:0,videos:0,audio:0};
  assert.equal(validateSelectedWorkflowInputs('comfyui','qwen-image-2.1-local',counts,workflows,'image').blockingReasons.length,0);
  assert.equal(validateSelectedWorkflowInputs('comfyui','qwen-image-2.1-local',counts,workflows,'video').blockingReasons[0].code,'WORKFLOW_INPUT_UNSUPPORTED');
});

test('Qwen LoRA profiles resolve explicit and legacy alias configuration', () => {
  const workflow = {
    id: 'qwen-image-2.1',
    aliases: ['qwen-image-2.1-local', 'qwen-image-2.1-consistency-local'],
    loraProfiles: [{ id: 'consistency', file: 'qwen-image-2.1-consistency.safetensors' }],
    aliasLoraProfiles: { 'qwen-image-2.1-consistency-local': ['consistency'] }
  };
  assert.deepEqual(
    validateSelectedWorkflowLoraProfiles(workflow, 'qwen-image-2.1-local', ['consistency']).appliedProfiles,
    ['consistency']
  );
  assert.deepEqual(
    validateSelectedWorkflowLoraProfiles(workflow, 'qwen-image-2.1-consistency-local').appliedProfiles,
    ['consistency']
  );
});

test('preview blocks LoRA profiles that the selected workflow does not register', () => {
  const faceWorkflow = {
    id: 'qwen-image-2.1-face',
    aliases: ['qwen-image-2.1-face-local'],
    loraProfiles: []
  };
  const result = validateSelectedWorkflowLoraProfiles(faceWorkflow, 'qwen-image-2.1-face-local', ['consistency']);
  assert.equal(result.blockingReasons[0].code, 'WORKFLOW_LORA_PROFILE_UNSUPPORTED');
  assert.deepEqual(result.blockingReasons[0].details.unsupportedProfiles, ['consistency']);
});

test('Qwen face preview shares the Qwen 0.5-2K resolution contract', () => {
  const faceWorkflow = {
    id: 'qwen-image-2.1-face',
    aliases: ['qwen-image-2.1-face-local'],
    capabilities: {
      resolutions: ['0.5K', '1K', '1.5K', '2K'],
      resolutionCoefficient: { min: 0.5, max: 2 }
    }
  };
  for (const resolution of ['0.5', '0.5K', '1', '1K', '1.5', '1.5K', '2', '2K', '1024x1024']) {
    assert.deepEqual(
      validateSelectedWorkflowResolution(faceWorkflow, 'qwen-image-2.1-face-local', resolution).blockingReasons,
      []
    );
  }
  const invalid = validateSelectedWorkflowResolution(faceWorkflow, 'qwen-image-2.1-face-local', '4K');
  assert.equal(invalid.blockingReasons[0].code, 'WORKFLOW_RESOLUTION_UNSUPPORTED');
  assert.deepEqual(invalid.blockingReasons[0].details.availableResolutions, ['0.5K', '1K', '1.5K', '2K']);
});

test('resolved LoRA field values support single or delimited profile IDs', () => {
  assert.deepEqual(
    parseResolvedLoraProfiles(['consistency', 'garment-stitch, character-a', 'character-a\nmaterial-detail', '']),
    ['consistency', 'garment-stitch', 'character-a', 'material-detail']
  );
});
