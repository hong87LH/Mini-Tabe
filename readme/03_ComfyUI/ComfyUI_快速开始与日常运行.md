# ComfyUI 快速开始与日常运行

适用工程：AI Table Studio v2.6.3 后续分支  
最后核对：2026-08-24  
当前事实来源：`comfyui/workflows/*/manifest.json`、`comfyui/plugin_catalog.json`、`npm run check:comfyui`

## 1. 当前可用能力

AI Table Studio 当前注册两套 MiniMax H3 本地视频工作流：

| 前台模型 | 用途 | 输入 |
|---|---|---|
| `minimax-h3-local` | 文生、首帧、首尾帧路由 | 0–2 张图片 |
| `minimax-h3-Ref-local` | 多参考素材路由 | 最多 9 图、3 视频、3 音频；总计至少一个参考 |

共同支持：

- 比例：`1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`9:16`、`16:9`、`21:9`
- 清晰度：`360P`、`480P`、`720P`、`1080P`
- 原始 MP：`0.1–16MP`
- 时长：3、5、8、10、15 秒
- 模式：Fast / Quality
- 声音：可开关，默认关闭

## 2. 一次性配置

在 AI Table Studio 的“API 和模型配置”中添加或启用：

```text
提供商：ComfyUI Local
接口地址：http://127.0.0.1:8188
API Key：留空
模型：minimax-h3-local, minimax-h3-Ref-local
状态：启用
```

同名模型不要同时在多个 Provider 中启用。旧工程保存的兼容别名仍可识别，但新字段优先使用上表中的两个名称。

## 3. 日常启动顺序

1. 启动本机 ComfyUI。
2. 浏览器确认 `http://127.0.0.1:8188` 可以访问。
3. 在项目根目录检查工作流：

```bat
cd /d F:\01_AIGC\12_AI_studio\bitable-clone
npm run check:comfyui
```

4. 确认输出包含两套 `registeredWorkflows`，并且 `health.ok=true`、`missingNodeTypes=[]`。
5. 启动 AI Table Studio：

```bat
npm run dev
```

6. 在 AI Video 字段中选择本地 H3 模型并生成。

需要同时让外部 Agent 控制表格时，使用：

```bat
set "HONGS_TABLE_ACTION_API=1" && set "HONGS_TABLE_ACTION_TOKEN=test-123456" && npm run dev
```

## 4. 选择哪套 H3 路由

### `minimax-h3-local`

```text
0 图 → 文生视频
1 图 → 首帧生视频
2 图 → 首尾帧视频
```

不接收参考视频或独立音频。

### `minimax-h3-Ref-local`

用于图片、视频、独立音频的任意组合。Prompt 中的媒体引用顺序会转换为：

```text
<Picture 1>
<Video 1>
<Audio 1>
```

Fast 模式下，如果同时存在视觉参考与独立音频，会自动插入 `H3TurboMixedReferenceFix`。

## 5. Fast 与 Quality

| 模式 | 当前模板 | 建议用途 |
|---|---|---|
| Fast | Turbo LoRA，6 步，Euler | 低成本测试、分镜预览、批量初筛 |
| Quality | 20 步，`res_multistep` | 重要镜头、最终素材、Fast 结果不稳定时 |

先用 `360P + 3秒 + Fast` 验证 Prompt、路由和素材引用；确认后再提高时长或清晰度。

## 6. 必备组件

| 组件 | 提供能力 | 需要方式 |
|---|---|---|
| ComfyUI Core ≥ 0.31.0 | H3、ResolutionSelector、视频/音频加载与保存 | 升级 ComfyUI 本体 |
| ComfyUI-MiniMax-H3-Turbo | `MiniMaxH3TurboLoRA` | Fast 模式必需 |
| Hongs-node | `H3TurboMixedReferenceFix` | 多参考 Fast + 视觉 + 独立音频必需 |

机器可读依赖清单：`comfyui/plugin_catalog.json`。

安装自定义节点后必须重启 ComfyUI；只重启 AI Table Studio 不会重新加载节点。

## 7. 日常检查命令

不依赖真实 ComfyUI、不会产生生成费用的协议测试：

```bat
npm run test:comfyui
```

当前预期：

```text
11 tests
11 pass
0 fail
```

连接当前 ComfyUI 并检查版本、节点和工作流：

```bat
npm run check:comfyui
```

如果 ComfyUI 不在默认地址：

```bat
set COMFYUI_ENDPOINT=http://局域网IP:8188
npm run check:comfyui
```

## 8. 最短排错

| 现象 | 首先检查 |
|---|---|
| 无法连接 | ComfyUI 是否运行、8188 是否可访问、Endpoint 是否正确 |
| 缺 `MiniMaxH3TurboLoRA` | 安装/更新 ComfyUI-MiniMax-H3-Turbo 并重启 |
| 缺 `H3TurboMixedReferenceFix` | 安装/更新 Hongs-node 并重启 |
| 缺 H3/LoadVideo/LoadAudio | 升级 ComfyUI Core，不要搜索同名第三方节点 |
| 未注册模型 | 核对模型名是否匹配 Manifest 的 ID/Alias |
| `node_errors` | API JSON 节点 ID、输入名与 Manifest Binding 不一致 |
| 连续重负载后 `Fault failed: 2` | 停止继续排队，干净重启 ComfyUI 后重试 |
| 完成但无文件 | 工作流必须使用可写入 History 的 SaveVideo/SaveImage 节点 |

完整排错见 `ComfyUI_测试与故障排查.md`。

