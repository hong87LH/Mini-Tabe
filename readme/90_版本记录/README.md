# 版本记录索引

- 历史产品稳定基线：[v2.4.8–v2.6.3 Changelog](CHANGELOG_v2.4.8-v2.6.3.md)
- 当前 v2.7.9 / Phase 4.7：[图片模型引用参数精简](v2.7.9_图片模型引用参数精简.md)
- v2.7.2 / v2.7.2b / Phase 4.7：[完整升级与工程交接报告](../v2.7.2_Qwen图片接入与统一参数.md)
- v2.7.1 / Phase 4.7：[剪切属性与 Skill 下拉修复](../v2.7.1_剪切属性与Skill下拉修复.md)
- v2.7.0 / Phase 4.7：[生成占位符与 Job 回填修复](../v2.7.0_生成占位符与Job回填修复.md)
- v2.6.9 / Phase 4.7：[缩略图路径与裁切预览修复](../v2.6.9_缩略图路径与裁切预览修复.md)
- v2.6.8：[缩略图按需加载与测量报告](../v2.6.8_缩略图按需加载与测量报告.md)
- v2.6.7：[侧边栏与列布局 API 升级报告](../v2.6.7_侧边栏与列布局API_升级报告.md)
- v2.6.6：[筛选插行与图片审阅升级报告](../v2.6.6_筛选插行与审阅Photoshop刷新_2026-09-03.md)
- v2.6.5 / Phase 4.7 API 基线：[Phase 4.7 升级报告](../AI_Table_Studio_v2.6.5_Action_API_Phase4.7_升级报告.md)
- Phase 4.6 Definition / CLI 基线：[Phase 4.6 升级报告](../AI_Table_Studio_v2.6.5_Action_API_Phase4.6_升级报告.md)
- v2.6.3 后 Agent API 累计记录：[Phase 1–4.7 升级报告](../v2.6.3后_Agent_API升级报告_Phase1-4.5.md)（文件名保留兼容）
- ComfyUI 当前文档：[ComfyUI 快速开始](../03_ComfyUI/ComfyUI_快速开始与日常运行.md)
- 历史版本快照：`../99_历史归档/版本快照/`
- 历史 ComfyUI 阶段报告：`../99_历史归档/ComfyUI阶段报告/`

版本含义：

- `v2.x`：AI Table Studio 产品版本。
- `Table Action API v0.1`：localhost 协议版本。
- `phase4.7`：Agent API 能力阶段，不是产品版本。
- ComfyUI 工作流 ID/Alias：本地生成路由标识，不是应用版本。


## v2.7.4（2026-10-09）

局域网ComfyUI、banana-2.1映射、审阅筛选漏图修复及手动裁切预览。详见[更新说明](../v2.7.4_局域网ComfyUI与审阅优化.md)。


## v2.7.5（2026-10-10）

banana-pro映射更名、banana-2兼容验证、模型候选列表修复。详见[更新说明](../v2.7.5_模型更名与候选列表修复.md)。


## v2.7.6（2026-10-14）

项目文件夹、拖拽与折叠导航、标题路径、JSON兼容及Action API扩展。详见[更新说明](../v2.7.6_项目文件夹与导航升级.md)。

## v2.7.7（2026-11-06）

新增本地 Qwen-Image-2.1 双图换脸工作流与通用 LoRA Profile 叠加机制。Face 模板内置结构提示词并追加用户补充；Consistency 复用默认 Qwen 的 0–5 图路由。工作流模型要求、来源、Action 能力和预览校验已在 2026-11-07 完成同步，详见[本版维护报告](v2.7.7_ComfyUI工作流维护与Action同步.md)与[Qwen 当前说明](../03_ComfyUI/ComfyUI_Qwen_Image_2.1_参数与LoRA.md)。

## v2.7.8（2026-11-08）

新增与 TT Image 2.5 平级的 TT Image 2.6 路由，提供复杂度、PNG/SVG/GIF 与 GIF 帧参数；下载器按实际文件字节识别并修正扩展名。附件与审阅视图新增 GIF/SVG/AI/PDF/PSD/PSB 类型角标、专业格式拖拽及 Photoshop/矢量应用分流。Action Definition 升级至 1.4，并公开 TT 模型能力与全部新字段。详见[升级报告](v2.7.8_TT_Image_2.6与专业媒体格式升级.md)。

## v2.7.9（2026-11-08）

精简图片模型字段引用模式：界面统一展示分辨率、比例、数量、模式、画质、复杂度与输出格式，运行时只向实际模型提交其支持的参数。字段引用触发 GIF 时固定采用 9 帧 / 200ms 默认值并忽略旧二级配置；动态 Qwen 默认应用高保真 LoRA，Face 与其他模型不误加载。格式引用新增 `.png/.svg/.gif` 兼容。详见[升级报告](v2.7.9_图片模型引用参数精简.md)。
