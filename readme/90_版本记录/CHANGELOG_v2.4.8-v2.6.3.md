# Hong's AI Table Studio 版本记录：v2.4.8–v2.6.3

最后整理：2026-08-24  
定位：v2.4.8–v2.6.3 产品稳定基线 Changelog。当前 v2.6.5 / Agent API Phase 4.7 单独记录。

## 版本总览

| 版本 | 主题 |
|---|---|
| v2.4.8 | 多维表格、AI 字段、媒体审阅与本地工程基线 |
| v2.4.9 | 同模型 Provider 协议切换 |
| v2.4.10 | Job 路径与修图尺寸修复 |
| v2.4.11 | OSS 月流量查询 |
| v2.4.12 | `.part` 完整性与 NAS 文件锁 |
| v2.5.0 | ComfyUI Local 通用 Provider 与 Manifest 协议 |
| v2.5.1 | H3 清晰度档位与画幅到 MP 映射 |
| v2.5.2 | 音频附件、预览和媒体类型支持 |
| v2.5.3 | H3 首尾帧/多参考双路由 |
| v2.5.4 | 智能路由、文生视频和多参组合验证 |
| v2.5.5 | 多参 Fast 修正、长队列恢复和 ComfyUI 自动启动 |
| v2.5.6 | Skill System v1.0 |
| v2.5.7 | Skill 稳定化与图片/视频/音频附件导出 |
| v2.5.8 | 文本大屏编辑与 Visual Prompt |
| v2.5.9 | 原生编辑快捷键、Undo 和媒体视觉统一 |
| v2.5.10 | 连续编辑、临时媒体参考与 Effective Context |
| v2.6.1 | 视频/音频非破坏式 A-B 时间裁切 |
| v2.6.2 | 临时参考按列会话锁定 |
| v2.6.3 | 文本换行、OSS SHA256 复用和标签精确匹配修复 |

## v2.4.8

- 建立多表、多字段、多视图和本地工程的主要产品结构。
- 支持普通文本、标签、附件、公式与 AI Text/Image/Video 字段。
- 建立媒体预览、批注、生成结果写回和本地持久化基础。
- 原完整使用指南保留为历史产品基线，不再代表当前全部功能。

## v2.4.9–v2.4.12

- v2.4.9：同一模型可根据 Provider 配置选择不同协议。
- v2.4.10：修复 Job 输出路径和图像修订尺寸传递。
- v2.4.11：加入 OSS 月流量查询与相关维护入口。
- v2.4.12：强化 `.part` 下载完整性、断点恢复与 NAS 文件锁处理。

## v2.5.0

- 新增与远程 Provider 并列的 ComfyUI Local Provider。
- 建立 `workflow_registry.js + manifest.json + API JSON` 的工作流注册结构。
- 打通本地素材上传、Prompt 提交、Queue/History 轮询、View 下载和 Cell 写回。
- 初始注册 MiniMax H3 本地视频工作流。

## v2.5.1

- 前台以 360P/480P/720P/1080P 表达 H3 清晰度。
- 按画幅和目标短边计算十进制 MP，同时兼容 `0.7`、`0.78MP` 等原始值。
- 比例扩展到 1:1、2:3、3:2、3:4、4:3、9:16、16:9、21:9。

## v2.5.2

- 附件选择器支持 MP3、WAV、FLAC、M4A、AAC、OGG、OPUS 等音频。
- 表格 Cell 与统一预览层能够区分并播放音频。
- 保持图片、视频与 v2.5.1 清晰度映射兼容。

## v2.5.3

- `minimax-h3-local` 扩展为文生/首帧/首尾帧路由。
- 新增 `minimax-h3-Ref-local`，支持图片、视频、音频多参考。
- Fast 与 Quality 模板分离，并记录真实模式和路由。

## v2.5.4

- 完成 0 图文生视频路由与多参考素材真实组合验证。
- 定位 Fast 混合视觉/音频的 Conditioning 形状问题。
- 验证条件时间对齐方案，为正式 Hongs-node 修正节点做准备。
- 强化音频内嵌封面和媒体类型标识。

## v2.5.5

- 多参考 Fast 正式接入 `H3TurboMixedReferenceFix`，不修改第三方 Turbo 插件。
- 本地 ComfyUI Job 只要仍处于 Queued/Running 就持续轮询，不套用远程 Provider 的固定总超时。
- 支持配置本机 ComfyUI 启动 BAT，在回环地址不可用时自动恢复服务。
- 收口音频缩略图、标签字段往返清理和多参实际生成链路。

## v2.5.6

- 建立 `skills/`、Registry、Catalog 和 Skill 管理界面。
- 智能文本字段可固定选择 Skill 或通过字段引用动态选择。
- Skill v1.0 读取 `SKILL.md` 与文本 References，编译为结构化上下文后继续执行一次原有 LLM 调用。
- 不执行 Skill 中的 Shell/Python/MCP，不新增 Agent Loop。

## v2.5.7

- 稳定 Skill 安装、扫描、启用/停用、来源显示和网络重试。
- 批量附件导出从图片扩展到图片、视频和音频，并保持正确扩展名。
- Skill 为空时继续完全使用旧智能文本路径。

## v2.5.8

- 普通文本和智能文本增加大屏编辑入口。
- 智能文本提供 Raw/Visual Prompt 视图。
- 当前行媒体引用和 `@` 插入支持真实媒体缩略图。
- 优化 AI Text 再次生成交互。

## v2.5.9

- 修复引用渲染模式 Clipboard 与 Undo/Redo 被表格快捷键抢占。
- 大屏编辑改为自动保存并降低多余确认。
- 图片、视频、音频独立编号、配色和菜单分组。
- 优化 Cell 展开按钮与文本编辑覆盖层。

## v2.5.10

- 完善大屏文本原生键盘操作、上一行/下一行连续编辑与自动保存。
- 普通 Text 的临时参考改为选择一个智能节点，复用其真实 Effective Media Context。
- AI Text 没有正式媒体配置时也可使用临时参考。
- 优化 `@` 菜单跟随光标、媒体缩略图和视觉降噪。
- 修复同源图片不同 Crop 实例切换与媒体预览细节。

## v2.6.1

- 为视频和音频增加非破坏式 `trimData`，源文件不改变。
- 媒体大屏支持 A/B 点、标准片段、边界拖动、选区拖动和循环预览。
- 图片 Crop、视频/音频 Trim 在 Cell 内复制时保留。
- 新增 `media_preprocessor.js`；生成前通过独立 FFmpeg 目录制作临时片段。
- 支持 `HONGS_FFMPEG_DIR`，并兼容项目内、上一级目录和系统 PATH。

## v2.6.2

- 延续 v2.6.1 的 Reference Clip 能力。
- 普通文本临时参考增加“本列固定”：同列切换行时沿用智能节点。
- 锁定只保存在 `sessionStorage`，不写 Record/Field Config，关闭窗口或解除后失效。

## v2.6.3

- 修复引用渲染模式中普通换行、连续空行和末尾换行丢失。
- OSS 自动复用改为 SHA256 完全一致才复用；dHash 只保留兼容索引，不再决定自动复用。
- 标签 Enter 改为名称完全一致才复用，避免输入 `AI` 时误选已有 `A`。
- 不改变现有表格结构、Crop/Trim、FFmpeg、ComfyUI、Job Center 和 Provider 配置。

## v2.6.3 后 Agent API 探索线

从 v2.6.3 分出的 Table Action API `v0.1` 当前已纳入产品 `v2.6.5`，能力阶段达到 `phase4.7`。API Phase 不是产品版本。

完整记录：`../v2.6.3后_Agent_API升级报告_Phase1-4.5.md`。

v2.6.5 / Phase 4.7 本轮记录：`../AI_Table_Studio_v2.6.5_Action_API_Phase4.7_升级报告.md`。Phase 4.6 Definition / CLI 基线仍见相邻历史报告。

## 历史原文

原始升级说明和测试报告已移至：

```text
readme/99_历史归档/版本快照/
readme/99_历史归档/ComfyUI阶段报告/
```

历史文件保留具体实现过程、旧目录、测试 ID 和当时限制；当前操作应以当前代码、Manifest、Schema 和现行文档为准。
