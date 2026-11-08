# MiniMax H3 文生 / 首帧 / 首尾帧工作流

工作流 ID：`minimax-h3-first-last-router`。推荐模型名：`minimax-h3-local`。支持 0 图文生、1 图首帧、2 图首尾帧，不接收参考视频或独立音频。

## 环境与节点

- ComfyUI Core：已登记最低版本 `0.31.0`。
- Fast：需要 [ComfyUI-MiniMax-H3-Turbo](https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo) 的 `MiniMaxH3TurboLoRA`。
- Quality：不使用 Turbo LoRA。
- 其他必需节点以 `manifest.json.requiredNodeTypes` 为准。

## 模型文件

| 目录 | 文件 | 用途 |
|---|---|---|
| `models/diffusion_models` | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | FL2VA 主模型 |
| `models/text_encoders` | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | 文本编码器 |
| `models/vae` | `minimax_h3_video_vae_fp16.safetensors` | 视频 VAE |
| `models/vae` | `minimax_h3_audio_vae_fp32.safetensors` | 音频 VAE |
| `models/loras` | `minimax_h3_turbo_v4_step600_ema.safetensors` | Fast 模式 Turbo LoRA |

基础模型来源：[Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3)。Turbo 文件由上述 Turbo 插件路线维护。精确下载地址同时登记在 `manifest.json.modelRequirements`。

## 运行语义

- Fast：6 步、Euler、Turbo LoRA；用于预览和低成本测试。
- Quality：20 步、`res_multistep`；用于重要镜头。
- 声音默认关闭；启用时保留模板的音频输出链。
- 分辨率、比例、时长和输出路径由 Manifest Binding 注入，不直接修改 API JSON。

## 验证

```bat
set COMFYUI_MODEL=minimax-h3-local
npm run check:comfyui
npm run test:comfyui
```

真实生成建议先用 `360P + 3 秒 + Fast + 固定 Seed`。模型实体、HardLink 和消费者路径以 `F:\01_AIGC\20_models\模型链接登记表.md` 为维护台账。
