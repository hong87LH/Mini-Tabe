# Hong's AI Table Studio v2.5.5–v2.5.10 最终版完整更新记录

> **内部维护 / 版本归档 / 回归测试参考**  
> 整理日期：2026-08-15  
> 版本范围：**v2.5.5 → v2.5.10 Final**

---

## 1. 文档定位

本文档汇总 v2.5.5、v2.5.6、v2.5.7、v2.5.8、v2.5.9 与 v2.5.10 最终维护版的累计更新内容。

记录范围包括：

- 用户可见功能；
- 关键实现逻辑；
- 数据与 Provider 兼容边界；
- 主要修改文件；
- 回归测试重点；
- 各版本之间的演进关系。

### 版本主线

```text
v2.5.5
本地 ComfyUI / MiniMax H3 / 音视频素材链路阶段收口
        ↓
v2.5.6
Skill System v1.0 首次接入智能文本
        ↓
v2.5.7
Skill 稳定化 + 图片/视频/音频统一附件导出
        ↓
v2.5.8
文本大屏编辑 + Visual Prompt + @ 媒体引用
        ↓
v2.5.9
contentEditable 原生编辑与媒体视觉统一
        ↓
v2.5.10 Final
跨行连续编辑 + 临时参考 + 媒体预览稳定性收口
```

---

## 2. 版本演进总览

| 版本 | 定位 | 核心更新 | 主要影响范围 |
|---|---|---|---|
| **v2.5.5** | 本地生成链路阶段收口 | ComfyUI Local、MiniMax H3 双路由、多参考、音频附件、长队列、自动启动、下载稳定性 | ComfyUI、AI Video、Attachment、Job Center |
| **v2.5.6** | Skill 基础接入 | Skill Manager、Skill Runtime、GitHub Skill 安装、智能文本 Skill 引用 | AI Text、Skills、Electron IPC |
| **v2.5.7** | Skill / 媒体能力扩展 | Skill 体系稳定化；图片/视频/音频统一附件导出 | Skills、智能文本、批量导出 |
| **v2.5.8** | 文本编辑工作台 | 文本/智能文本大屏编辑；Visual Prompt；`@` 媒体插入；再次生成 | Grid 文本交互 |
| **v2.5.9** | 原生编辑与视觉统一 | Clipboard / Undo 避让；媒体独立编号、配色、缩略图；Cell UI 精简 | Grid、App、CSS |
| **v2.5.10 Final** | 连续编辑与稳定性收口 | 上下行连续编辑；临时参考；光标跟随 `@`；媒体预览与裁切实例切换修复 | Grid 为主，兼容既有数据结构 |

---

# 3. v2.5.5 — ComfyUI Local 与 MiniMax H3 本地视频链路阶段收口

## 3.1 新增 ComfyUI Local

v2.5.5 将本地 ComfyUI 正式纳入 AI Table Studio 主工作流。

过去远程模型常见路径：

```text
本地素材
→ OSS
→ 公网 URL
→ Provider
→ Job
→ 下载
```

本地 ComfyUI 现在可以：

```text
本地素材
→ ComfyUI /upload/image
→ 本地 Workflow
→ Job Center
→ 本地文件 / 表格写回
```

默认 Endpoint：

```text
http://127.0.0.1:8188
```

核心意义：

- 本地素材不需要为了本地模型额外上传 OSS；
- 图片 / 视频 / 音频可直接进入本机 Workflow；
- 本地生成与远程生成统一进入现有 Job Center 管理。

---

## 3.2 MiniMax H3 双路由

推荐模型入口：

```text
minimax-h3-local
minimax-h3-Ref-local
```

### `minimax-h3-local`

自动根据图片输入数量判断：

```text
0 图 → 文生视频
1 图 → 首帧生视频
2 图 → 首尾帧视频
```

兼容旧模型别名：

```text
h3-fl
minimax-h3-first-last-local
minimax-h3-first-last
minimax-h3
comfyui-minimax-h3
```

### `minimax-h3-Ref-local`

多参考模式支持：

```text
图片：0–9
视频：0–3
独立音频：0–3
总参考素材：至少 1 个
```

可组合：

```text
图片
图片 + 视频
图片 + 音频
视频 + 音频
图片 + 视频 + 音频
```

引用标签统一为：

```text
<Picture 1>
<Video 1>
<Audio 1>
```

这套语义后来继续被 v2.5.8–v2.5.10 的 Visual Prompt 使用。

---

## 3.3 Fast / Quality 模式

```text
Fast
→ 6 Steps
→ Turbo LoRA

Quality
→ 20 Steps
→ 原速质量模板
```

Fast 多参考在同时存在：

```text
视觉参考
+
独立音频
```

时支持使用：

```text
H3TurboMixedReferenceFix
```

由 `Hongs-node` 提供。

---

## 3.4 H3 清晰度与比例映射

支持传统清晰度：

```text
360P
480P
720P
1080P
```

支持画幅：

```text
1:1
2:3
3:2
3:4
4:3
9:16
16:9
21:9
```

程序根据：

```text
清晰度 + 画幅
```

转换为 H3 `ResolutionSelector` 需要的 MP。

同时兼容旧 MP 输入，例如：

```text
0.3
0.7
0.78
0.78MP
0.9MP
```

---

## 3.5 音频附件

Attachment 字段扩展支持：

```text
MP3
WAV
FLAC
M4A
AAC
OGG
OPUS
```

同时支持：

- 音频缩略图；
- 内嵌封面；
- 原生播放器；
- H3 独立参考音频。

---

## 3.6 ComfyUI 长队列

本地任务状态：

```text
queued
running
```

不再套用远程 Provider 常见的短周期总 Timeout。

只要 ComfyUI 仍报告任务正在排队或运行：

```text
Job Center
→ 持续轮询
```

避免长队列时误判失败。

---

## 3.7 ComfyUI 自动启动

本地应用设置支持指定 ComfyUI 启动 `.bat`。

执行流程：

```text
提交本地生成
→ 检查 ComfyUI
→ 在线：直接提交
→ 离线：启动 BAT
→ 等待服务恢复
→ 继续提交
```

自动启动仅允许本机地址：

```text
localhost
127.0.0.1
IPv6 loopback
```

避免对远程 Endpoint 执行本地启动逻辑。

---

## 3.8 下载链路稳定性

普通下载：

```text
远程结果
→ .part
→ 下载完整性校验
→ 正式文件
```

需要 resize：

```text
远程结果
→ .part
→ 完整性校验
→ Sharp resize
→ finalize
→ 正式文件
```

保留：

- Range 断点续传；
- `Content-Length`；
- `Content-Range`；
- 图片解码校验；
- 修图实际像素输出；
- NAS / SMB 文件锁重试；
- `EBUSY`；
- `EPERM`；
- `EACCES`。

---

## 3.9 标签字段清理

历史标签可以通过：

```text
标签
→ 文本
→ 标签
```

完成轻量清理：

- 无效 ID；
- 已删除标签；
- 重复标签；
- 旧选项残留。

---

# 4. v2.5.6 — Skill System v1.0 首次接入

## 4.1 版本原则

v2.5.6 的两个核心原则：

1. **兼容原智能文本节点**  
   未配置 Skill 时继续执行 v2.5.5 原有 Prompt、字段引用、参考媒体、模型选择和 Provider 请求逻辑。

2. **控制改动范围**  
   不重写文本 Provider，不增加 Agent Loop，不执行 Skill 脚本，不修改图片 / 视频 / ComfyUI Workflow 主链路。

---

## 4.2 Skill 目录与注册

项目新增：

```text
skills/
├─ catalog.json
├─ registry.json
└─ ...Skill 文件夹
```

设计原则：

- Skill 本体保存在实际目录；
- `registry.json` 只保存注册 / 启停状态；
- 递归扫描包含 `SKILL.md` 的目录；
- 用户可以直接复制 Skill 文件夹后扫描；
- 用户可以安装公开 GitHub Skill 目录。

显示名优先级：

```text
agents/openai.yaml → interface.display_name
SKILL.md frontmatter → display_name
SKILL.md frontmatter → name
文件夹名
```

重复显示名会标记冲突并拒绝调用。

---

## 4.3 Skill 管理界面

“API 和模型配置”增加：

```text
API 与模型 | Skills
```

Skills Tab 支持：

- 扫描；
- 自动注册；
- 启用 / 停用；
- 卸载；
- 来源信息；
- Reference 数量；
- 冲突检测；
- Skill Library；
- GitHub 地址安装。

本地复制 / 私有 Skill 显示为 `Custom`，不伪造公开来源。

---

## 4.4 智能文本 Skill 配置

智能文本新增：

```text
skillTemplate?: string
```

支持：

### 固定 Skill

```text
MiniMax H3 Prompt Writing
```

### 字段引用

```text
{Skill}
```

规则：

```text
Skill 为空
→ 不使用 Skill
→ 继续原智能文本逻辑
```

如果引用 Skill：

- 不存在；
- 已停用；
- 显示名冲突；

则明确报错，不静默回退。

---

## 4.5 Skill Runtime v1.0

定位：

> **Preloaded Structured Skill Context Runtime / 预加载结构化 Skill 上下文运行时**

执行流程：

```text
智能文本字段
→ 解析 Prompt 字段引用
→ 解析 Skill
→ Skill Registry
→ 读取 SKILL.md
→ 读取 references/
→ Skill Context Compiler
→ 结构化 Prompt
→ 原智能文本 Provider
→ 一次 LLM 请求
→ 写回结果
```

结构设计不是简单拼接：

```text
SKILL.md + ref1 + ref2 + 用户 Prompt
```

而是保留：

```text
<skill_runtime>
  <skill_context>
  <runtime_context>
  <current_task>
```

Reference 保留来源路径，并被明确标注为支持资料 / 示例，避免模型把示例内容误当成当前任务。

---

## 4.6 支持范围

支持：

```text
✓ SKILL.md
✓ references/*.md
✓ references/*.txt
✓ references/*.json
✓ references/*.yaml / *.yml
✓ agents/openai.yaml UI 元数据
✓ 项目目录扫描
✓ GitHub 公开 Skill 安装
✓ 来源记录
✓ 启用 / 停用
✓ 固定 Skill
✓ 字段引用 Skill
✓ 一次 LLM 调用
```

不支持：

```text
× scripts 执行
× Shell
× Python
× MCP
× Tool Calling
× Agent Loop
× 多 Skill Stack
× Auto Skill 自动选择
× Reference 按需二次读取
× Skill 在线更新检测
```

---

## 4.7 主要文件变化

修改：

```text
src/components/Grid.tsx
src/components/ApiSettings.tsx
src/types.ts
main.js
preload.js
package.json
package-lock.json
README.md
```

新增：

```text
skill_manager.js
skills/catalog.json
skills/registry.json
skills/README.md
readme/v2.5.6升级说明.md
```

未修改主链路：

```text
图片 Provider
视频 Provider
Lingwu 参数映射
ComfyUI Workflow Registry
ComfyUI H3 路由
Network Job Center
.part 下载器
OSS
修图 resize
附件音频逻辑
```

---

# 5. v2.5.7 — Skill 稳定化与统一附件导出

## 5.1 Skill System / Runtime 延续

v2.5.7 延续 v2.5.6 的 Skill 架构，重点在于把 Skill 能力进一步稳定到日常智能文本工作流。

继续保持：

```text
无 Skill
→ 原 AI Text Provider 链路

有 Skill
→ 编译 Skill Context
→ 原 AI Text Provider 链路
```

Provider 本身无需理解 Skill。

---

## 5.2 图片 / 视频 / 音频统一附件导出

批量导出由“图片导出”扩展为统一媒体导出。

支持字段：

- Attachment；
- AI Image；
- AI Video。

支持分类：

```text
全部
图片
视频
音频
```

媒体识别综合：

- MIME；
- 文件名；
- URL 扩展名；
- 本地媒体协议。

导出时尽可能保留真实扩展名。

使用命名模板时，根据真实媒体类型生成匹配扩展名。

---

# 6. v2.5.8 — 文本大屏编辑与 Visual Prompt

## 6.1 文本 / 智能文本大屏编辑

适用：

```text
text
aiText
```

单元格增加轻量大屏展开入口。

原双击小单元格编辑方式保留。

大屏支持：

- 多行文本；
- 文本选择；
- 复制 / 粘贴；
- 浏览器原生 Undo / Redo；
- `Ctrl/Cmd + S`；
- `Esc`；
- 字符数显示。

---

## 6.2 Visual Prompt

AI Text 大屏增加：

```text
Raw | Visual
```

后续中文统一为：

```text
纯文本 | 引用渲染
```

Visual 识别：

```text
<Picture N>
<Image N>
<Video N>
<Audio N>
```

并临时渲染为媒体 Chip。

关键数据原则：

> Visual 是 Renderer，不产生第二套富文本数据。

保存回 Cell 的仍然是原始 Token。

---

## 6.3 当前行引用媒体

大屏顶部根据智能文本媒体配置读取当前行真实引用媒体。

保持：

- 字段引用顺序；
- 字段内部附件顺序。

顶部缩略图继续复用：

```text
ThumbnailImage
原媒体大屏预览器
```

避免建立第二套媒体系统。

---

## 6.4 `@` 插入媒体

Visual 模式输入：

```text
@
```

可以选择当前有效媒体并在光标位置插入：

```text
<Picture N>
<Video N>
<Audio N>
```

只修改当前 Text Cell 内容，不修改 `sourceImageTemplate`。

---

## 6.5 AI Text 再次生成

优化：

- 已有文本的 AI Text 仍可直接重新生成；
- 选中单元格即可访问再次生成入口；
- 大屏 Header 提供重新生成；
- 重新生成前先保存当前文本；
- 原批量 AI 生成函数保持不变。

---

# 7. v2.5.9 — contentEditable 原生行为与媒体视觉统一

## 7.1 Clipboard 修复

修复 Visual / `contentEditable` 中：

```text
Ctrl/Cmd+C
Ctrl/Cmd+X
Ctrl/Cmd+V
```

被 Grid 全局剪贴板逻辑抢占。

现在以下编辑目标均优先走浏览器原生行为：

```text
input
textarea
select
contentEditable
```

---

## 7.2 Undo / Redo 修复

App 全局 Undo / Redo 对 `contentEditable` 增加避让。

Visual 内：

```text
Ctrl/Cmd+Z
Ctrl/Cmd+Y
Shift+Cmd/Ctrl+Z
```

交由浏览器文本历史。

---

## 7.3 媒体编号语义统一

Picture / Audio / Video 不再共用一个全局编号。

例如：

```text
Picture 1
Picture 2
Audio 1
Video 1
Audio 2
```

分别独立编号，与视频模型引用语义一致。

---

## 7.4 媒体视觉色

媒体采用独立且一致的视觉识别：

- Picture：蓝色；
- Audio：紫色；
- Video：紫红 / Pink。

统一作用到：

- 顶部媒体；
- Visual Chip；
- `@` 菜单；
- 编号圆点。

---

## 7.5 Visual Prompt 缩略图

- Picture / Video Chip 显示真实缩略图；
- Audio 使用统一音乐视觉；
- Thumbnail 尚未加载时先显示占位；
- 异步完成后原位更新；
- 不重建整个 `contentEditable` DOM。

同时修复：

> 第一次打开引用渲染没有缩略图，必须 Raw / Visual 来回切换后才显示。

---

## 7.6 `@` 菜单分组

顺序：

```text
图片
音频
视频
```

不同媒体类型之间增加分隔。

---

## 7.7 Cell 与大屏 UI 精简

- 取消额外“完成”确认，大屏关闭即保存；
- 保留 `Ctrl/Cmd + S`；
- 再次生成按钮与 AI Image / AI Video 视觉体系对齐；
- 大屏展开按钮去描边 / 投影；
- Inline Edit 时隐藏展开按钮，减少覆盖误触；
- Visual 支持 `<...>`、`[...]`、`【...】` 基础结构强调，但只影响显示。

---

# 8. v2.5.10 Final — 连续编辑、临时参考与稳定性收口

## 8.1 大屏文本快捷键补齐

修复以下浏览器原生行为被 Cell / Grid 快捷键抢占的问题：

```text
Enter
Shift+Enter
Delete
Backspace
Home
End
Shift + 方向键
Ctrl/Cmd + A
Ctrl/Cmd + C
Ctrl/Cmd + X
Ctrl/Cmd + V
Ctrl/Cmd + Z
Ctrl/Cmd + Y
```

同时保持：

- 鼠标拖选；
- 双击选词；
- 右键复制粘贴。

大屏编辑器只阻止事件继续冒泡，不阻止浏览器默认文本编辑行为。

---

## 8.2 上一行 / 下一行连续编辑

大屏 Header 增加：

```text
上一行
当前可见位置 / 总数
下一行
```

流程：

```text
自动保存当前行
→ 查找同字段上一/下一可见记录
→ 切换目标记录
→ 同步虚拟列表定位
→ 加载目标文本与媒体上下文
```

### 闪屏 Bug 修复

旧逻辑：

```text
关闭当前 Modal
→ 底层表格绘制一帧
→ 打开下一行 Modal
```

导致屏幕明显闪烁。

最终版改为在浏览器绘制前完成下一条编辑器接管，使跨行切换视觉连续。

---

## 8.3 普通 Text 临时参考智能节点

普通 Text 大屏可临时选择：

```text
AI Text
AI Image
AI Video
```

作为媒体参考来源。

这里参考的是：

> 被选智能节点当前行**实际使用的输入媒体上下文**

而不是直接拿节点输出内容。

临时媒体可用于：

- 顶部媒体预览；
- `@` 菜单；
- Visual Prompt Chip；
- 点击进入原媒体大屏预览。

临时参考属于当前编辑 Session：

```text
不修改 Record
不修改 Field Config
不建立永久字段依赖
```

跨上一行 / 下一行时：

```text
沿用同一个参考节点
但重新解析目标行的实际媒体
```

---

## 8.4 AI Text 无正式媒体时也支持临时参考

当 AI Text：

```text
没有配置任何媒体引用字段
且当前没有正式媒体上下文
```

可以和普通 Text 一样使用临时参考。

如果 AI Text 已经有正式媒体配置：

```text
继续优先使用自身正式媒体
不叠加临时参考
```

避免两套参考来源混用。

---

## 8.5 Effective Media Context

统一解析智能节点真实媒体上下文。

涉及：

```text
sourceImageTemplate
sourceVideoTemplate
sourceAudioTemplate
```

只把真正可承载媒体的字段纳入上下文，例如：

```text
attachment
aiImage
aiVideo
url
```

避免普通文本路径字符串被错误识别为媒体。

Picture / Audio / Video 的独立编号在：

- 顶部媒体；
- `@` 菜单；
- Visual Chip；

保持一致。

---

## 8.6 `@` 菜单跟随光标

原问题：

> `@` 菜单固定在编辑器某个区域，没有跟随输入光标。

修复后：

- 根据当前文字 Caret 定位；
- 跟随光标弹出；
- 接近底部时自动向上展开；
- 编辑区域滚动后重新计算位置。

### `@` 菜单缩略图降噪

菜单尺寸较小，而且已经按媒体类型分组，所以：

- 视频缩略图不增加黑色遮罩；
- 视频不显示播放三角；
- 音频不叠加音符图标；
- 类型由分组本身表达。

---

## 8.7 大屏编辑视觉降噪

去除：

- 激活编辑时蓝色 Focus 边框；
- 模式切换时蓝色 Ring；
- 复杂高亮特效。

顶部媒体卡片同时减少重复“参考”等来源文字。

整体媒体配色降低明度 / 饱和度，避免长时间编辑时过强干扰。

---

## 8.8 大屏音频 / 视频缩略图统一

大屏顶部预览区：

### Video

- 保留缩略图；
- 加轻量黑色半透明遮罩；
- 播放图标采用半透明显示。

### Audio

- 使用与表格单元格一致的低饱和暗蓝渐变；
- 使用轻量半透明音符识别。

注意：

> 上述遮罩 / 播放 / 音符只用于**大屏顶部媒体区**，不用于 `@` 小菜单。

---

## 8.9 表格内音频缩略图对齐修复

修复音频 Thumbnail 与 Picture / Video：

- 高度不一致；
- 容器尺寸计算不同；
- 横向排列时产生错位。

统一使用与图片 / 视频相同的缩略图尺寸容器逻辑。

---

## 8.10 同一原图不同裁切版本的左右切换修复

### 原问题

一个 Cell 内连续贴入相同原图：

```text
原图 A → Crop 1
原图 A → Crop 2
原图 A → Crop 3
```

三条 Attachment 的 URL 相同。

旧媒体预览主要通过：

```text
url
```

判断是否切换到新媒体。

结果：

```text
不同裁切实例
→ 被认为是同一张图片
→ 左右键 index 虽变化
→ cropData 没有重新同步
→ 画面卡在一个裁切状态
```

### 修复方式

引入“媒体条目实例”级识别。

切换依据不再只有 URL，而结合：

- 当前媒体 index；
- 实例 key；
- 对应 attachment 实例。

左右切换时重新同步：

```text
cropData
裁切比例
缩放值
X
Y
isOutpaint
```

因此：

> 同一张原图可以在同一个 Cell 中保留多个不同裁切版本，并通过左右方向键逐个正确预览。

同时避免简单把 `cropData` 直接作为预览 Effect 的触发条件，防止“保存取景”后错误重新进入裁切状态。

---

# 9. 数据兼容性

## 9.1 v2.5.10 临时参考

无需迁移旧项目数据。

临时参考属于：

```text
Modal / Editor Session State
```

不会写入：

```text
Record
Field Config
```

---

## 9.2 Skill

`skillTemplate` 为可选配置。

旧工程没有该字段时：

```text
行为不变
```

---

## 9.3 Provider / Workflow 主链路

v2.5.5–v2.5.10 没有因为文本大屏或 Skill 功能重新设计：

```text
Provider Registry
Gemini / OpenAI / Lingwu 请求协议
ComfyUI Workflow Registry
OSS
Job Center
下载器
```

v2.5.6 Skill 只在需要时编译最终 Prompt，然后继续进入既有 AI Text Provider。

---

# 10. 主要代码文件变化

| 文件 | 涉及版本 | 主要职责 |
|---|---|---|
| `src/components/Grid.tsx` | v2.5.6–v2.5.10 | Skill 选择、媒体导出、大屏文本、Visual Prompt、临时参考、媒体 Context、跨行编辑、预览切换、UI 修复 |
| `src/components/ApiSettings.tsx` | v2.5.6+ | Skills Tab、扫描、启停、来源、GitHub Library |
| `src/types.ts` | v2.5.6 | `skillTemplate` 可选字段 |
| `skill_manager.js` | v2.5.6 | Skill 扫描、注册、下载、Reference、Context 编译 |
| `main.js` | v2.5.5–v2.5.6 | ComfyUI / Skill IPC 等桌面业务入口 |
| `preload.js` | v2.5.6 | Skill API 暴露 |
| `src/App.tsx` | v2.5.9 | 全局 Undo / Redo 对 `contentEditable` 避让 |
| `src/index.css` | v2.5.9–v2.5.10 | Text Cell / Inline Edit / 大屏相关视觉交互 |
| `package.json` / `package-lock.json` | 各版本 | 版本号与打包资源同步 |
| `skills/*` | v2.5.6+ | Skill Library / Registry / 用户 Skill |

---

# 11. v2.5.10 Final 建议回归清单

## 文本编辑

- [ ] Enter / Shift+Enter 正常
- [ ] Delete / Backspace 正常
- [ ] Home / End 正常
- [ ] Shift + 方向键选择正常
- [ ] Ctrl/Cmd+A/C/X/V 正常
- [ ] Ctrl/Cmd+Z/Y 正常
- [ ] 右键复制 / 粘贴正常
- [ ] 鼠标拖选 / 双击选词正常
- [ ] 纯文本 / 引用渲染来回切换不丢内容

## Visual Prompt / 媒体

- [ ] 首次打开 Visual 即显示缩略图
- [ ] Picture / Audio / Video 独立编号
- [ ] `@` 菜单按图片 / 音频 / 视频分组
- [ ] `@` 菜单跟随当前光标
- [ ] 编辑区滚动后菜单位置正确
- [ ] `@` 小菜单无多余视频遮罩 / 播放图标 / 音符
- [ ] 大屏顶部音频 / 视频视觉正确
- [ ] 单元格音频缩略图与图片 / 视频对齐

## 临时参考

- [ ] 普通 Text 可临时参考 AI Text
- [ ] 普通 Text 可临时参考 AI Image
- [ ] 普通 Text 可临时参考 AI Video
- [ ] AI Text 无正式媒体时可临时参考
- [ ] AI Text 有正式媒体时不混入临时参考
- [ ] 上下行切换时继续沿用参考节点
- [ ] 不写 Record / Field Config

## 上下行切换

- [ ] 切换前自动保存当前行
- [ ] 虚拟列表定位正确
- [ ] 当前可见序号正确
- [ ] 媒体上下文切换正确
- [ ] 无整屏闪烁

## 媒体大屏

- [ ] 普通不同图片左右切换正常
- [ ] 同一 URL 的多个不同 Crop 可逐个切换
- [ ] 每个 Crop 的比例 / X / Y / Scale 正确
- [ ] Outpaint 状态正确
- [ ] 保存裁切后不会错误重进裁切模式

## v2.5.5 本地 ComfyUI

- [ ] ComfyUI Local 可连接
- [ ] BAT 自动启动正常
- [ ] 0 / 1 / 2 图 H3 自动路由正常
- [ ] H3 Ref 多参考正常
- [ ] 音频附件正常
- [ ] 长队列不会误超时
- [ ] Job Center 写回正常
- [ ] `.part` 下载与 finalize 正常

---

# 12. 最终阶段总结

v2.5.5–v2.5.10 可以看作两个连续阶段：

### 第一阶段：把 AI 后端能力扩展完整

```text
远程 Provider
+
ComfyUI Local
+
H3 多参考
+
图片 / 视频 / 音频
+
Job Center
```

### 第二阶段：把设计师在表格中的编辑体验补完整

```text
Skill
+
长 Prompt 大屏
+
Visual Prompt
+
@ 媒体引用
+
临时参考
+
连续逐行校对
+
媒体预览稳定性
```

最终目标没有改变：

> **让 AI Table Studio 从“调用模型的表格”逐步成为可以承载设计师长期工作流、媒体素材、Prompt、任务与审核过程的 AI 内容生产工作台。**
