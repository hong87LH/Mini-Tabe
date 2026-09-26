import test from 'node:test';
import assert from 'node:assert/strict';
import { ComfyUIClient } from '../comfyui/comfyui_client.js';
import {
  getFirstRetouchSourceItem, getRetouchCropAspectRatio, nearestImageAspectRatio,
  imageRatioRequest, retouchReferenceImages
} from '../src/lib/retouchAspectRatio.js';

const fields = [
  { id:'src', name:'原始图片', type:'attachment' },
  { id:'extra', name:'辅助图', type:'aiImage' },
];
const config = {sourceImageTemplate:'{原始图片} {辅助图}'};
const selected = (args={}) => imageRatioRequest({
  isQwen:true, hasImages:true, isRetouchMode:true,
  hasRetouchSourceRatio:true, hasCustomRatioTemplate:true,
  configuredRatio:'9:16', resolvedRatio:'3:4', ...args
});

test('retouch policy uses the FIRST source image crop ratio, ignoring later refs and manual ratio', () => {
  const record = {src:[{url:'first.png',cropData:{ratio:3/4}},{url:'other.png',cropData:{ratio:1}}],extra:[{url:'extra.png',cropData:{ratio:16/9}}]};
  assert.equal(getFirstRetouchSourceItem(config,fields,record).url,'first.png');
  assert.equal(getRetouchCropAspectRatio(config,fields,record),'3:4');
  assert.equal(selected(),'3:4');
  assert.equal(selected({isQwen:false}),'3:4'); // existing cloud/legacy policy
  assert.equal(selected({configuredRatio:'auto',hasCustomRatioTemplate:false}),'3:4');
});

test('the second image crop must NOT replace an uncropped first image', () => {
  const record = {src:[{url:'first.png'},{url:'second.png',cropData:{ratio:9/16}}]};
  assert.equal(getFirstRetouchSourceItem(config,fields,record).url,'first.png');
  assert.equal(getRetouchCropAspectRatio(config,fields,record),null);
  assert.equal(nearestImageAspectRatio(1200/1600),'3:4');
});

test('retouch original image dimensions map to existing supported aspect ratios', () => {
  assert.equal(nearestImageAspectRatio(1920/1080),'16:9');
  assert.equal(nearestImageAspectRatio(750/1000),'3:4');
  assert.equal(nearestImageAspectRatio(0),null);
});

test('normal Qwen I2I auto keeps native latent; explicit ratio still overrides', () => {
  assert.equal(selected({isRetouchMode:false,hasRetouchSourceRatio:false,hasCustomRatioTemplate:false}),undefined);
  assert.equal(selected({isRetouchMode:false,hasRetouchSourceRatio:false,configuredRatio:'auto'}),undefined);
  assert.equal(selected({isRetouchMode:false,hasRetouchSourceRatio:false,configuredRatio:'9:16'}),'9:16');
  assert.equal(selected({isRetouchMode:false,hasImages:false}),'3:4');
});

test('retouch passes the original source before prompt-only reference images', () => {
  assert.deepEqual(retouchReferenceImages(['crop.png','fabric.png'],['mood.png']),['crop.png','fabric.png','mood.png']);
});

test('Qwen workflow accepts retouch crop ratio as an explicit EmptyLatentImage canvas', async () => {
  const client=new ComfyUIClient('','http://127.0.0.1:1');
  client.uploadImage=async image=>image;
  let prompt;
  client.request=async (_url,opts)=>{prompt=JSON.parse(opts.body).prompt;return{json:async()=>({prompt_id:'retouch-test'})};};
  const ratio=selected();
  await client.createTask('qwen-image-2.1-local','keep crop',{images:retouchReferenceImages(['crop.png'],['style.png']),imageSize:'1K',aspectRatio:ratio});
  assert.equal(prompt['100'].inputs.image,'crop.png');
  assert.equal(prompt['101'].inputs.image,'style.png');
  assert.deepEqual(prompt['8'].inputs.latent_image,['90',0]);
  assert.equal(prompt['90'].class_type,'EmptyLatentImage');
  assert.equal(prompt['90'].inputs.width,896);
  assert.equal(prompt['90'].inputs.height,1184);
  assert.deepEqual(prompt['7'].inputs['images.image_1'],['100',0]);
});
