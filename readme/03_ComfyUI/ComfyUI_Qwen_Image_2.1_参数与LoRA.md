# ComfyUI Qwen Image 2.1 参数、Face 与 LoRA

适用工程：AI Table Studio v2.7.7 及兼容后续版本
最后核对：2026-11-15

## 1. 当前入口

| 模型名 | 用途 | 图片输入 | 提示词策略 |
|---|---|---:|---|
| `qwen-image-2.1-local` | 文生图、普通图生图 | 0–5 | 用户提示词原样提交 |
| `qwen-image-2.1-transparent-local` | 透明 PNG 路线 | 0–5 | 自动加入透明输出包装 |
| `qwen-image-2.1-face-local` | 双图换脸 | 恰好 2 | Face 默认提示词后追加用户补充词 |

兼容别名 `qwen-image-2.1-consistency-local` 继续可被旧字段和 Agent 识别，但不在新字段模型列表展示。新配置使用 `qwen-image-2.1-local` 并启用 `loraProfiles: ["consistency"]`。

## 2. 基础模型

三个 Qwen workflow 共用：

| 目录 | 文件 |
|---|---|
| `models/diffusion_models` | `qwen_image_2.1_int8_convrot.safetensors` |
| `models/text_encoders` | `qwen3vl_8b_int8_convrot.safetensors` |
| `models/vae` | `qwen_image_2.1_vae_bf16.safetensors` |

来源：[Comfy-Org/Qwen-Image-2.1](https://huggingface.co/Comfy-Org/Qwen-Image-2.1)。工程使用的精确文件名和下载地址登记在各自 `manifest.json.modelRequirements`。

## 3. Consistency 保真增强

- 文件：`models/loras/qwen-image-2.1-consistency.safetensors`
- 默认强度：`1`
- SHA-256：`4f44ada1be2189cc23b3d010f9603543403f48454e2f76842a3d30109b20bd63`
- 来源：[zimageapp/qwen-image-2.1-loras](https://huggingface.co/zimageapp/qwen-image-2.1-loras/blob/main/qwen-image-2.1-consistency.safetensors)

它是默认 Qwen workflow 上的可选 Profile，不是独立 workflow。支持与默认 0–5 图路由叠加，提示词保持用户原文。无参考图时可以运行，但没有“保留原图”的实际意义。

字段配置：

```json
{
  "model": "qwen-image-2.1-local",
  "loraProfiles": ["consistency"]
}
```

“保真增强”只控制 Consistency；右侧“功能 LoRA”是以后注册工艺、人物或具体编辑 LoRA 的独立入口。

功能 LoRA 即使暂时没有注册项，也保留“+ 引用”入口。字段配置保存为现有 `loraProfiles` 数组中的 `{字段名}`；生成和 `generation.preview` 会按当前行解析字段值。一个字段可填写单个 Profile ID，也可用逗号、分号或换行分隔多个 ID。解析出的名称仍必须存在于当前 Workflow Manifest，未登记时返回 `WORKFLOW_LORA_PROFILE_UNSUPPORTED`，不会静默加载任意本地文件。

当前人物 Profile：

| Profile ID（字段值） | 界面显示名 | LoRA 文件 | 默认提示词 |
|---|---|---|---|
| `xiaoxue-a` | Xiaoxue A · High Bun | `Xiaoxue-A-high-bun-512-2250.safetensors` | 完整 Xiaoxue 身份、高盘发及保持结构提示词前置 |
| `mumu-v02` | Mumu v02 | `Mumu-v02-step-2000.safetensors` | 完整 Mumu 身份及保持结构提示词前置 |

字段引用识别的是 **Profile ID**，不是界面显示名，也不是 `.safetensors` 文件名。模型设置页标有“字段值”的复制按钮复制的就是可直接填写的 ID，例如 `xiaoxue-a`。ID 按 Manifest 精确匹配，建议保持小写和连字符不变。

模型设置页的 ComfyUI Provider 会只读展示当前 Manifest 已登记的 LoRA：可配置 Profile 提供可复制的字段值，Face 等随工作流固定加载的 LoRA 标为“内置”并提供文件名复制。该清单不另建存储，避免与 Manifest 产生双份配置。

### LoRA 提示词模式

LoRA Profile 可独立声明提示词策略，工作流级默认提示词继续保留在模板中：

```json
{
  "promptPolicy": {
    "mode": "prepend",
    "kind": "trigger",
    "text": "atelier_style",
    "separator": ", "
  }
}
```

- `prepend + trigger`：把短触发词放在用户提示词前面。
- `prepend + default-prefix`：把 LoRA 建议的大段默认提示词放在用户提示词前面。
- `append`：少数需要后置词的 LoRA 可放在用户提示词后面。
- `none` 或不填写：完全不注入词汇，只使用用户提示词和字段引用。

最终顺序为：工作流模板默认词 → LoRA 前置词/触发词 → 用户提示词 → LoRA 后置词。Face 的 `head_swap` 仍属于工作流模板默认词；注册表会从实际 Prompt 绑定节点自动抽取并在模型设置页显示，无需在 Manifest 重抄大段文字。只有 Workflow `promptPolicy.mode=append` 时该模板文字才标记为实际默认词；普通 Qwen 模板中的示例占位词不会误显示为生效提示词。

### 后续功能 LoRA 的最小注册流程

沿用默认 Qwen 2.1 基础模型且使用 `LoraLoaderModelOnly` 的 LoRA，不需要修改 Grid、Client、Action 或 `image_api.json`。正常只维护以下位置：

1. 将权重登记到 `F:\01_AIGC\20_models`，并按现有规范建立/核验消费者 HardLink；权重不进入 Git。
2. 编辑唯一注册源 `comfyui/workflows/qwen-image-2.1/manifest.json`：
   - 在 `modelRequirements` 增加文件、目录、Hash、加载节点和 Profile 关联；
   - 在 `loraProfiles` 增加稳定的 Profile ID、显示名、文件、默认强度和 `promptPolicy`。
3. 在本文件“当前人物 Profile”或未来对应类别表中增加一行；单工作流安装路径有变化时再同步 workflow README，不另建重复注册说明。
4. 同步 `F:\01_AIGC\20_models` 的模型链接登记表和维护指南，并运行 `npm run test:comfyui`、`npm run test:action-api`。

只有以下情况才需要新增独立 workflow 包或修改模板 JSON：LoRA 使用不同加载节点/模型拓扑、固定多图语义、专属 conditioning 链，或不能安全插入默认 Qwen 模型管线。单纯更换 LoRA 文件、默认提示词、触发词或强度不属于这些情况。

## 4. Face 双图工作流

- 文件：`models/loras/bfs_head_v1.1_qwen_2.1.safetensors`
- 默认强度：`1`
- SHA-256：`d1d748d5601077f3b6d05766f6823510e901970d916afa404a97e85dc92fa88e`
- 来源：[Alissonerdx/BFS-Best-Face-Swap](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap)

图 1 是基图，图 2 是身份参考。Face 模板有固定 `head_swap` 提示词，用户文本仅作为补充。它不接受 Consistency Profile；Agent 误配时预览阶段会明确阻塞。

Face 仍属于 Qwen Image 2.1 分辨率体系，和默认工作流一样支持 `0.5K / 1K / 1.5K / 2K`，数值标签 `0.5 / 1 / 1.5 / 2` 也可解析，最高 2K。UI 与 Action `generation.preview` 使用同一份 Manifest 能力，超限会返回 `WORKFLOW_RESOLUTION_UNSUPPORTED`。

## 5. Action API

标准顺序：

```text
generation.get_capabilities
→ field.configure_ai
→ generation.preview
→ generation.run
```

`generation.get_capabilities` 的 `comfyuiWorkflows` 现在返回：

- `modelRequirements`：精确模型文件、目录、来源和可选 Hash；
- `loraProfiles`：可用 Profile、文件和默认强度；
- `aliasLoraProfiles`：旧模型别名隐式启用的 Profile。

`generation.preview` 对图片字段回显 `resolvedConfig.loraProfiles`，并在 Profile 与 workflow 不匹配时返回 `WORKFLOW_LORA_PROFILE_UNSUPPORTED`。

## 6. 兼容性与维护

- v2.7.6 表格无需迁移；`loraProfiles` 仍是可选字段。
- 旧 Consistency 模型名继续兼容，不再作为新模型展示。
- 新增 LoRA 时先在 Manifest 登记 Profile 和模型要求，再开放 UI 选项，不能让 Agent 直接传任意本机文件名。
- 模型实体、HardLink、消费者入口和 Hash 以 `F:\01_AIGC\20_models` 下的登记表为唯一资产台账。
- workflow 随附 README 负责单工作流复现；本文件负责产品层使用；版本记录只写变化摘要。
