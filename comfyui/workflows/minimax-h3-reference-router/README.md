# MiniMax H3 多参考素材工作流

工作流 ID：`minimax-h3-reference-router`。推荐模型名：`minimax-h3-Ref-local`。支持最多 9 图、3 视频、3 音频，总参考数至少为 1。

## 环境与节点

- ComfyUI Core：已登记最低版本 `0.31.0`。
- Fast：需要 [ComfyUI-MiniMax-H3-Turbo](https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo)。
- Fast 混合视觉与独立音频：需要 [Hongs-node](https://github.com/hong87LH/Hongs-node) 的 `H3TurboMixedReferenceFix`。
- Quality：不使用 Turbo LoRA，也不注入 Fast 修正节点。

## 模型文件

| 目录 | 文件 | 用途 |
|---|---|---|
| `models/diffusion_models` | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | Ref2VA 主模型 |
| `models/text_encoders` | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | 文本编码器 |
| `models/vae` | `minimax_h3_video_vae_fp16.safetensors` | 视频 VAE |
| `models/vae` | `minimax_h3_audio_vae_fp32.safetensors` | 音频 VAE |
| `models/loras` | `minimax_h3_turbo_v4_step600_ema.safetensors` | Fast 模式 Turbo LoRA |

基础模型来源：[Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3)。精确来源、目录和模式条件见 `manifest.json.modelRequirements`。

## 引用规则

运行时按实际有效素材顺序建立 `<Picture N>`、`<Video N>`、`<Audio N>`。空引用字段跳过，不补齐，也不替用户切换 workflow。已有 Crop/Trim 实例经媒体预处理后继续进入同一生成链路。

Fast 模式混合视觉与独立音频时动态插入节点 `280`；参考视频内嵌音轨当前不重复注入独立音频端口，避免 Turbo 条件形状冲突。

## 验证

```bat
set COMFYUI_MODEL=minimax-h3-Ref-local
npm run check:comfyui
npm run test:comfyui
```

真实生成先用单条、短时长和低分辨率。模型实体、HardLink 和消费者路径以 `F:\01_AIGC\20_models\模型链接登记表.md` 为维护台账。
