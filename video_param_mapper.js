export function mapVideoParams(model, params) {
  if (!params) return {};
  
  const mapped = { ...params };
  const mode = params.mode;
  const resolution = params.resolution;
  const duration = params.duration;
  const aspect_ratio = params.aspectRatio || params.aspect_ratio;
  const sound = params.sound;
  const enhancePrompt = params.enhancePrompt;
  const offPeak = params.offPeak;

  // Clean up uniform keys to avoid sending them if not needed
  delete mapped.aspectRatio; 
  delete mapped.enhancePrompt;
  delete mapped.offPeak;
  // keep duration, mode, resolution, sound for now, we will delete/remap them per model

  if (model.includes('veo3.1')) {
     if (model === 'veo3.1-lite') {
       if (resolution === '720P' || resolution === '1080P' || resolution === 'sd') {
          mapped.quality = 'sd';
       } else if (resolution === '4K' || resolution === '4k') {
          mapped.quality = '4k';
       }
     } else {
       // veo3.1 or veo3.1-4k
       if (mode === 'fast') mapped.generation_mode = 'fast';
       else if (mode === 'standard' || mode === 'std' || !mode) mapped.generation_mode = 'null';
       else if (mode === 'pro' || mode === 'quality') mapped.generation_mode = 'pro';
       else if (mode === 'components') mapped.generation_mode = 'components';
       else mapped.generation_mode = mode; // fallback to user provided mode string
       
       if (params.enableUpsample) {
          mapped.enable_upsample = params.enableUpsample ? "true" : "false";
          delete mapped.enableUpsample;
       }
     }
     
     if (aspect_ratio) mapped.aspect_ratio = aspect_ratio;
     
     // veo takes enhance_prompt as boolean or string? "true" / "false"
     if (enhancePrompt !== undefined) {
         mapped.enhance_prompt = enhancePrompt ? "true" : "false";
     }
     
     // Clean up unused global parameters for Veo series
     delete mapped.mode;
     delete mapped.duration;
     delete mapped.resolution;
  } 
  else if (model.includes('grok-video')) {
     // grok-video series
     
     if (model === 'grok-videos') {
         if (aspect_ratio) mapped.size = aspect_ratio; 
         if (duration) mapped.seconds = String(duration);
         
         delete mapped.aspect_ratio;
         delete mapped.duration;
     } 
     else if (model.includes('grok-video-3')) {
         if (aspect_ratio) mapped.aspect_ratio = aspect_ratio;
         // 只有 grok-video-3 需要传 size(画质) 参数，plus版本不需要
         if (model === 'grok-video-3' && resolution) mapped.size = resolution;
         if (duration) mapped.duration = String(duration);
     }
     
     if (sound !== undefined) mapped.generate_audio = sound ? "true" : "false";
     
     // 清理 Grok 系列不需要的冗余参数
     delete mapped.mode;
     delete mapped.resolution;
  }
  else if (model.includes('viduq3')) {
     // vidu series
     if (mode === 'turbo' || mode === 'fast') mapped.model_variant = 'turbo';
     else if (mode === 'pro' || mode === 'quality') mapped.model_variant = 'pro';
     
     if (aspect_ratio) mapped.aspect_ratio = aspect_ratio;
     if (resolution) mapped.resolution = resolution;
     if (duration) mapped.duration = String(duration);
     if (offPeak !== undefined) mapped.off_peak = offPeak ? "true" : "false";
     
     if (model === 'viduq3-cankaosheng') {
         if (mode === 'turbo' || mode === 'fast' || mode === 'std') mapped.model_version = 'viduq3';
         else if (mode === 'pro' || mode === 'quality') mapped.model_version = 'viduq3-mix';
         delete mapped.model_variant;
     }
     delete mapped.mode;
  }
  else if (model === 'vidu-mv') {
     if (aspect_ratio) mapped.aspect_ratio = aspect_ratio;
     if (resolution) mapped.resolution = resolution;
     if (mapped.audio && Array.isArray(mapped.audio) && mapped.audio.length > 0) {
         mapped.audio_url = mapped.audio[0];
         delete mapped.audio;
     }
     // custom lip_sync and add_subtitle are passed via params
     if (params.lip_sync !== undefined) mapped.lip_sync = params.lip_sync ? "true" : "false";
     if (params.add_subtitle !== undefined) mapped.add_subtitle = params.add_subtitle ? "true" : "false";
     
     delete mapped.lip_sync;
     delete mapped.add_subtitle;
  }
  else if (model === 'kling-v3-video') {
     if (duration) mapped.duration = String(duration);
     if (mode === 'std' || mode === 'fast') mapped.mode = 'std';
     else if (mode === 'pro' || mode === 'quality') mapped.mode = 'pro';
     if (aspect_ratio) mapped.aspect_ratio = aspect_ratio;
  }
  else if (model === 'doubao-seedance-1-5-pro-251215') {
     if (duration) mapped.audio_duration = String(duration);
     delete mapped.duration;
     if (resolution) mapped.resolution = resolution;
     if (aspect_ratio) mapped.ratio = aspect_ratio;
     delete mapped.aspect_ratio;
     if (sound !== undefined) mapped.generate_audio = sound ? "true" : "false";
  }

  // Common cleanups
  if (mapped.sound !== undefined) delete mapped.sound;
  
  return mapped;
}
