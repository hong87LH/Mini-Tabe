# Qwen Image 2.1 双图换脸工作流

工作流 ID：`qwen-image-2.1-face`。前台模型名：`qwen-image-2.1-face-local`。固定要求两张图片：图 1 是待编辑基图，图 2 是身份参考图。

## 环境与节点

- 已验证 ComfyUI `0.37.0` 或兼容更新版本。
- 使用 ComfyUI Core 的 Qwen Image 2.1、`LoraLoaderModelOnly`、采样、VAE 和保存节点。
- 不依赖 H3 Turbo 或 Hongs-node。

## 模型文件

| 目录 | 文件 | 用途 |
|---|---|---|
| `models/diffusion_models` | `qwen_image_2.1_int8_convrot.safetensors` | Qwen Image 2.1 主模型 |
| `models/text_encoders` | `qwen3vl_8b_int8_convrot.safetensors` | 文本编码器 |
| `models/vae` | `qwen_image_2.1_vae_bf16.safetensors` | VAE |
| `models/loras` | `bfs_head_v1.1_qwen_2.1.safetensors` | BFS Head Swap LoRA，强度 1 |

基础模型来源：[Comfy-Org/Qwen-Image-2.1](https://huggingface.co/Comfy-Org/Qwen-Image-2.1)。Face LoRA 来源：[Alissonerdx/BFS-Best-Face-Swap](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap)。LoRA SHA-256 为 `d1d748d5601077f3b6d05766f6823510e901970d916afa404a97e85dc92fa88e`。

## 提示词策略

模板自带 `head_swap` 结构提示词。表格提示词为空时使用模板提示词；有内容时按“模板提示词 + 换行 + 用户补充词”提交。普通 Qwen 和 Consistency 不继承该提示词。

双图顺序不可交换：

```text
image_1 = 基图
image_2 = 身份参考
```

Face 工作流不登记通用 `loraProfiles`。如果 Agent 把 `consistency` 配到 Face 模型，`generation.preview` 会返回 `WORKFLOW_LORA_PROFILE_UNSUPPORTED`，避免静默忽略。

Face 与默认 Qwen Image 2.1 共用分辨率协议：支持 `0.5K / 1K / 1.5K / 2K`（也接受 `0.5 / 1 / 1.5 / 2` 数值标签），最高 2K。字段设置面板和 `generation.preview` 都按这组能力判断；4K 会在预览阶段阻塞，不会等到 ComfyUI 提交时才失败。

## Action API 示例

```json
{
  "model": "qwen-image-2.1-face-local",
  "sourceImage": "{基图} {身份参考图}",
  "quality": "high",
  "resolution": "1K"
}
```

先调用 `field.configure_ai`，再调用 `generation.preview` 核对 `workflowId`、图片数量、模型与输出路径；确认后才执行 `generation.run`。

## 验证

```bat
set COMFYUI_MODEL=qwen-image-2.1-face-local
npm run check:comfyui
npm run test:comfyui
```

模型实体、HardLink、Hash 和消费者路径以 `F:\01_AIGC\20_models\qwen image 2.1\Qwen-Image-2.1_使用与链接维护指南.md` 为维护台账。
