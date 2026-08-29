# ComfyUI 默认工作流必备插件清单

适用工程：Lingwu v2.5.5

机器可读清单：`comfyui/plugin_catalog.json`

## 一、所有默认工作流的基础要求

### ComfyUI 核心

- 最低建议版本：`0.31.0`
- 仓库：<https://github.com/comfyanonymous/ComfyUI>
- Windows NVIDIA 便携版：<https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z>
- 安装位置：这是 ComfyUI 本体，不要放进 `custom_nodes`。

下列节点都来自新版 ComfyUI 核心，不是第三方插件：

- `MiniMaxH3ImageToVideo`
- `MiniMaxH3ReferenceToVideo`
- `ResolutionSelector`
- `LoadVideo` / `GetVideoComponents`
- `LoadAudio`
- `CreateVideo` / `SaveVideo`
- `VAEDecodeAudio`

如果这些节点缺失，应升级 ComfyUI，而不是搜索同名自定义节点。

## 二、Fast/Turbo 必备插件

### ComfyUI-MiniMax-H3-Turbo

- 提供节点：`MiniMaxH3TurboLoRA`
- 仓库：<https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo>
- 适用：两个默认工作流的 Fast 模式。

在 `ComfyUI/custom_nodes` 中执行：

```text
git clone https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo.git ComfyUI-MiniMax-H3-Turbo
```

## 三、多参 Fast 混合素材必备插件

### Hongs-node

- 提供节点：`H3TurboMixedReferenceFix`
- 仓库：<https://github.com/hong87LH/Hongs-node>
- 发布状态：已正式发布为公开 Git 仓库；如果当前安装包已经自带该目录，无需重复克隆。
- 适用：`minimax-h3-Ref-local` 在 Fast 模式混合图片/视频与独立音频时。
- 额外 Python 依赖：无。

在 `ComfyUI/custom_nodes` 中执行：

```text
git clone https://github.com/hong87LH/Hongs-node.git Hongs-node
```

## 四、默认工作流对应关系

| 前台模型 | Quality 原速 | Fast 加速 |
|---|---|---|
| `minimax-h3-local` | 新版 ComfyUI 核心 | 核心 + MiniMax H3 Turbo |
| `minimax-h3-Ref-local` | 新版 ComfyUI 核心 | 核心 + MiniMax H3 Turbo + Hongs-node |

`Hongs-node` 在多参 Fast 中属于工程必备插件。实际路由只会在视觉参考与独立音频同时存在时插入修正节点。

## 五、用户或 Agent 的安装流程

1. 关闭 ComfyUI。
2. 打开 `ComfyUI/custom_nodes`。
3. 对缺失的 `custom_node` 执行清单中的 `installCommand`；默认安装包已附带的插件无需重复克隆。
4. 若清单的 `kind` 为 `core`，升级 ComfyUI 本体，不要克隆到 `custom_nodes`。
5. 根据各插件自己的说明安装依赖；当前 `Hongs-node` 无额外依赖。
6. 重新启动 ComfyUI。
7. 运行：

```text
node scripts/check_comfyui_protocol.mjs
```

健康检查返回的 `missingNodeTypes` 表示缺失节点；`missingPlugins` 会进一步给出对应插件、仓库及安装命令，Agent 可直接读取后执行。

## 六、典型报错对应处理

| 报错或缺失节点 | 处理方式 |
|---|---|
| `MiniMaxH3TurboLoRA` | 安装或更新 `ComfyUI-MiniMax-H3-Turbo` |
| `H3TurboMixedReferenceFix` | 安装或更新 `Hongs-node` |
| `MiniMaxH3ImageToVideo` / `MiniMaxH3ReferenceToVideo` | 升级 ComfyUI 核心 |
| `LoadVideo` / `LoadAudio` / `CreateVideo` | 升级 ComfyUI 核心 |
| 插件已经存在但仍提示缺失 | 查看 ComfyUI 黑色窗口中的插件导入错误，并按插件 README 补依赖 |

安装或更新插件后必须重启 ComfyUI，单独重启 Lingwu 前台无法让 ComfyUI 重新加载节点。
