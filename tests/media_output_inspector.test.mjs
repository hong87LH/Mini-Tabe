import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMediaFormatFromBuffer, imageFormatMeta, normalizeRequestedImageFormat } from '../media_output_inspector.js';

test('detects actual image bytes independently from requested extension', () => {
  assert.equal(detectMediaFormatFromBuffer(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])).format, 'png');
  assert.equal(detectMediaFormatFromBuffer(Buffer.from([0xff,0xd8,0xff])).format, 'jpeg');
  assert.equal(detectMediaFormatFromBuffer(Buffer.from('GIF89a')).format, 'gif');
  assert.equal(detectMediaFormatFromBuffer(Buffer.from('RIFF1234WEBP')).format, 'webp');
  assert.equal(detectMediaFormatFromBuffer(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')).format, 'svg');
});

test('normalizes requested aliases and exposes extension metadata', () => {
  assert.equal(normalizeRequestedImageFormat('JPG'), 'jpeg');
  assert.equal(imageFormatMeta('jpeg').extension, '.jpg');
  assert.equal(imageFormatMeta('svg').mimeType, 'image/svg+xml');
  assert.equal(imageFormatMeta('psd'), null);
});
