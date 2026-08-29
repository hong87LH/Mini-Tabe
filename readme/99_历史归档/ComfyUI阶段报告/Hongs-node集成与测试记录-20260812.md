# Hongs-node 集成与测试记录

日期：2026-08-12

## 节点包

- 本地目录：`E:\01_AIGC\ComfyUI_windows_portable_H3\ComfyUI\custom_nodes\Hongs-node`
- 计划远程仓库：`https://github.com/hong87LH/Hongs-node`
- 用途：统一维护自有 ComfyUI 兼容节点与工作流工具节点。
- 不依赖额外 Python 包。

## 首个节点

- 注册名：`H3TurboMixedReferenceFix`
- 显示名：`H3 Turbo Mixed Reference Fix (3-to-2)`
- 分类：`Hongs Nodes / MiniMax H3`
- 适用条件：MiniMax H3 Turbo/Fast 模式，同时存在图片或视频参考以及独立音频参考。
- 作用：把视觉参考和音频参考的条件时间统一为 `1.0`，使三个条件时间分段合并为 Turbo 适配器可处理的两个分段。
- 边界：只修改 conditioning 元数据，不修改原始素材、ComfyUI 核心或第三方 Turbo 插件。

## Lingwu 工程接入

`minimax-h3-Ref-local` 已配置自动路由：仅当 Fast、视觉参考、独立音频三个条件同时成立时，动态插入 `H3TurboMixedReferenceFix`；Quality 模式或单一模态不插入。

修改位置：

- `comfyui/comfyui_client.js`
- `comfyui/workflows/minimax-h3-reference-router/manifest.json`
- `tests/comfyui_protocol.test.mjs`

## 验证结果

- 协议自动测试：10/10 通过。
- ComfyUI 节点加载：`/object_info/H3TurboMixedReferenceFix` 返回成功。
- 真实生成：图片 + 独立 MP3，Turbo 6 步，360P，3:4，3 秒，成功。
- Prompt ID：`35322020-90af-4756-b807-0cd77bd90b81`
- 未出现 `tensor 3 vs 2`。
- 输出文件：`E:\01_AIGC\ComfyUI_windows_portable_H3\ComfyUI\output\video\lingwu_comfyui\minimax-h3-reference-router\1786519699937_d2123f37_00001_.mp4`

## 安装方式

```text
cd ComfyUI/custom_nodes
git clone https://github.com/hong87LH/Hongs-node.git Hongs-node
```

安装后重启 ComfyUI。

## 多参考组合测试矩阵

统一参数：Turbo/Fast 6 步、360P、3:4、3 秒、关闭成品音轨。测试采用顺序执行，避免并发争抢显存。

| 参考组合 | Prompt ID | 耗时 | 结果 | 输出文件 |
|---|---|---:|---|---|
| 1 图片 + 1 音频（基准） | `35322020-90af-4756-b807-0cd77bd90b81` | 约 106 秒 | 成功 | `1786519699937_d2123f37_00001_.mp4` |
| 2 图片 + 1 音频 | `c5b62ae0-399b-4980-86d7-c0580ff0c5f3` | 75.3 秒 | 成功 | `1786520180306_adb8ee60_00001_.mp4` |
| 1 视频 + 1 音频 | `f3783eb3-97ce-4031-bef2-43403cb335a5` | 240.7 秒 | 成功 | `1786520255542_fd2c0a14_00001_.mp4` |
| 1 图片 + 2 音频 | `02c823bd-48a8-48e4-aa88-bf905b5c9a0b` | 85.2 秒 | 成功 | `1786520531327_6a7ca2d2_00001_.mp4` |
| 1 图片 + 1 视频 + 1 音频（干净重启） | `b764af58-b5cd-4ca6-9e85-8c8bfecc2dbd` | 275.7 秒 | 成功 | `1786520675408_80e3a568_00001_.mp4` |

所有成功任务均未出现 `tensor 3 vs 2`。

### 路由边界测试

- Fast + 多图 + 音频：插入修正节点。
- Fast + 视频 + 音频：插入修正节点。
- Fast + 图片 + 视频 + 音频：插入修正节点。
- Fast + 图片 + 多音频：插入修正节点。
- Fast + 仅图片：不插入。
- Fast + 仅音频：不插入。
- Quality + 视觉参考 + 音频：不插入。
- 自动协议测试共 11 项，全部通过。

### 连续重负载运行观察

三条真实任务连续运行后，首次三模态测试 `0900a9cb-8974-4dfb-8e18-9471ea5deb86` 在 `MiniMaxH3ReferenceToVideo` 的音频 VAE 编码阶段出现 `Fault failed: 2`。错误发生在修正节点执行之前，不是 tensor 3 vs 2。保留可见窗口并干净重启 ComfyUI 后，同一素材组合立即重测成功。

这说明：

1. 三模态组合本身可用。
2. 视频参考明显增加耗时与模型换入换出压力。
3. 若连续执行多个包含视频的重负载任务后出现 `Fault failed: 2`，优先重启 ComfyUI 再继续；后续可单独研究模型卸载与显存策略。
