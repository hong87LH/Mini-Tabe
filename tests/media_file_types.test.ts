import test from 'node:test';
import assert from 'node:assert/strict';
import { getMediaFileInfo, isInlinePreviewableProfessionalMedia, isSupportedAttachmentDescriptor } from '../src/lib/mediaFileTypes';

test('classifies professional and animated media for badges and app routing', () => {
  assert.deepEqual(getMediaFileInfo('demo.psd').kind, 'photoshop');
  assert.equal(getMediaFileInfo('demo.psb').appKind, 'photoshop');
  assert.equal(getMediaFileInfo('demo.ai').accent, 'orange');
  assert.equal(getMediaFileInfo('demo.pdf').appKind, 'vector');
  assert.equal(getMediaFileInfo('demo.svg').badge, 'SVG');
  assert.equal(getMediaFileInfo('demo.gif').badge, 'GIF');
});

test('accepts professional files even when drag MIME is empty', () => {
  for (const name of ['a.psd','a.psb','a.ai','a.pdf','a.svg']) assert.equal(isSupportedAttachmentDescriptor(name, ''), true);
  assert.equal(isSupportedAttachmentDescriptor('', 'application/pdf'), true);
  assert.equal(isSupportedAttachmentDescriptor('readme.txt', 'text/plain'), false);
});

test('keeps SVG and PDF in the built-in preview while source formats use external apps', () => {
  assert.equal(isInlinePreviewableProfessionalMedia('drawing.svg'), true);
  assert.equal(isInlinePreviewableProfessionalMedia('document.pdf'), true);
  assert.equal(isInlinePreviewableProfessionalMedia('source.psd'), false);
  assert.equal(isInlinePreviewableProfessionalMedia('source.ai'), false);
});
