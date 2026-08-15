# Hong's AI Table Studio v2.5.10 版本需求
## 文本大屏编辑完善版

**版本定位：**  
在不引入 Flow Canvas / Workflow 的前提下，继续增强现有表格中的普通文本与智能文本编辑体验。

**核心原则：**
- 不改变现有 AI 生成、Provider、Job、Skill Runtime 主链路。
- 不建立第二套媒体引用关系。
- 普通文本的“临时参考”只服务于本次大屏编辑会话，不写入字段配置。
- 智能文本继续读取其真实字段配置中的上游媒体。
- 所有文本编辑优先保留浏览器原生编辑能力。

---

# 1. 本版本目标

v2.5.10 聚焦四件事：

1. 修复大屏文本编辑中的原生键盘操作与撤销逻辑。
2. 完善文本单元格 / 智能文本单元格的大屏编辑 UI。
3. 统一媒体引用的缩略图、编号、配色、@ 插入和 Visual 渲染。
4. 为普通文本增加“临时参考一个智能节点媒体上下文”的轻量能力，并支持上一行 / 下一行连续编辑。

本版本**不实现 Workflow Canvas**。

---

# 2. 大屏文本编辑：原生编辑能力

## 2.1 必须支持的常规文本操作

普通文本和智能文本的大屏编辑器，都必须优先使用浏览器原生文本编辑行为：

- Delete
- Backspace
- Enter
- Shift + Enter
- Ctrl / Cmd + A
- Ctrl / Cmd + C
- Ctrl / Cmd + X
- Ctrl / Cmd + V
- Ctrl / Cmd + Z
- Ctrl / Cmd + Y
- Ctrl / Cmd + Shift + Z
- Shift + 方向键选择
- Ctrl / Cmd + 方向键
- Home / End
- PageUp / PageDown
- 鼠标拖选
- 双击选词
- 右键复制 / 粘贴

## 2.2 全局快捷键隔离

Grid / App 的全局事件必须跳过：

- input
- textarea
- contentEditable
- 大屏文本编辑器内部的原生选择区域

即：

```text
文本编辑器有焦点
→ 浏览器文本快捷键优先
→ Grid 不拦截
→ App 项目级 Undo 不拦截
```

---

# 3. 大屏编辑保存逻辑

## 3.1 删除“完成”按钮

大屏编辑不需要额外的“完成 / 确认”。

编辑行为本身即代表当前内容已经修改。

关闭大屏时：

```text
当前内容
→ 写回当前 Cell
```

## 3.2 行切换自动保存

新增：

```text
← 上一行
下一行 →
```

点击切换时：

```text
保存当前行文本
→ 切换相邻 Record
→ 重新加载同一字段的新 Cell
```

不需要再次确认。

## 3.3 行边界

第一行：

```text
上一行 disabled
```

最后一行：

```text
下一行 disabled
```

---

# 4. 普通 Cell 的展开按钮

## 4.1 常态

普通文本 / 智能文本 Cell 非编辑状态：

- 右上角显示大屏展开按钮。
- 使用浅灰色线性 Expand 图标。
- 不要描边。
- 不要投影。
- 不要高权重背景。
- Hover 可轻微增强。

## 4.2 双击进入普通 Cell 编辑后

**隐藏大屏展开按钮。**

原因：

- 避免和滚动条冲突。
- 避免遮挡文字。
- 已经进入 Cell 内编辑后，再显示大屏入口价值较低。

即：

```text
Cell display
→ 有 Expand

双击 Cell inline edit
→ 无 Expand
```

## 4.3 Cell 右侧文字空间

非编辑状态下，现有右侧 padding 过大。

调整为：

```text
在保证 Expand / AI Generate 按钮不遮挡文字的情况下
文本再向右扩展约 1 个中文字宽度
```

减少无效留白。

---

# 5. 智能文本 Cell 的“重新生成”按钮

现状问题：

- 已生成文本时，需要双击后才容易看到生成按钮。
- 编辑时按钮遮挡正文。

优化：

```text
Cell 被选中
+
不是 inline edit 状态
→ 显示 AI Generate / Regenerate
```

按钮视觉必须复用：

```text
AI Image / AI Video
```

现有生成按钮体系。

不要另做一套颜色。

Inline edit 状态：

```text
不在文本区域内部显示 Generate
```

避免遮挡。

---

# 6. 大屏模式切换

原：

```text
Raw
Visual
```

调整中文：

```text
纯文本
引用渲染
```

可以保留 Tooltip：

```text
纯文本 Raw
引用渲染 Visual
```

---

# 7. 媒体类型配色

整体降低一档明度 / 饱和度，参考现有表头配色体系。

固定语义：

```text
Image   → 蓝色
Audio   → 紫色
Video   → 紫红色
```

三个位置必须完全一致：

1. 顶部媒体缩略图编号 / 文案
2. @ 菜单
3. Visual Prompt 内媒体 Chip

禁止三个区域各用一套颜色。

---

# 8. 媒体编号规则

不同媒体类型分别编号。

例如同一节点当前行引用：

```text
3 Images
2 Audio
1 Video
```

显示为：

```text
Picture 1
Picture 2
Picture 3

Audio 1
Audio 2

Video 1
```

而不是所有媒体共享：

```text
1 / 2 / 3 / 4 / 5 / 6
```

---

# 9. 顶部“当前行引用媒体”

删除媒体卡片下重复的：

```text
参考
```

只保留：

```text
Picture 1
Audio 1
Video 1
```

以及实际缩略图。

图片、音频、视频继续沿用现有附件 / 预览体系。

点击：

```text
媒体缩略图
→ 原来的媒体大屏预览
```

---

# 10. Visual Prompt 的媒体 Chip

## 10.1 必须使用真实缩略图

当前问题：

```text
Visual Chip 左侧小框偶尔只是默认 Icon
```

调整为：

```text
Picture
→ 真实图片 Thumbnail

Video
→ 视频 Thumbnail / Poster

Audio
→ 统一 Audio Thumbnail
```

## 10.2 首次进入 Visual 必须立即正确显示

现有问题：

```text
第一次进入引用渲染
→ 图片 Thumbnail 未显示

纯文本 → 引用渲染重新切换
→ 才出现
```

必须修复为：

```text
打开大屏
→ 媒体 Thumbnail async resolve
→ Visual Chip 自动就地刷新
```

不要求用户切换模式。

## 10.3 对齐

Chip 内：

```text
Thumbnail / Icon
文字
```

必须垂直居中。

Image / Audio / Video Chip 高度一致。

---

# 11. @ 媒体菜单

在“引用渲染”编辑器中输入：

```text
@
```

弹出媒体菜单。

按类型分组：

```text
图片
────────────────
Picture 1
Picture 2

音频
────────────────
Audio 1

视频
────────────────
Video 1
```

只展示当前编辑器**有效 Media Context** 中存在的媒体。

插入位置：

```text
当前文本光标
```

---

# 12. 智能文本大屏编辑的 Media Context

智能文本继续沿用现有真实配置。

例如：

```text
aiText.sourceImageTemplate
以及未来其它实际媒体输入配置
```

系统解析：

```text
当前 Field Config
+
当前 Record
→ 当前行真实 Media Context
```

顶部媒体、@ 菜单、Visual Chip 都使用这套 Context。

不允许用户在这里额外手工重新选择附件字段。

---

# 13. 普通文本：临时参考功能重新设计

## 13.1 废弃旧方案

废弃：

```text
普通文本
→ 手工勾选一个个 Attachment 字段
```

不再实现。

## 13.2 新方案

普通文本大屏新增：

```text
临时参考
[ 选择参考节点 ▾ ]
```

用户选择一个**智能节点**。

允许：

- AI Text
- AI Image
- AI Video

第一版只允许选择**一个节点**。

不允许多选。

---

# 14. “参考节点”实际代表什么

普通文本不是引用该智能节点的文字内容。

而是：

> 临时继承该智能节点当前行实际使用的媒体上下文。

内部概念：

```text
Effective Media Context
```

例如：

```text
普通文本：视频提示

临时参考：
视频提示优化
```

系统读取：

```text
“视频提示优化” AI Text
当前行
真正引用了哪些媒体
```

得到：

```text
Picture 1
Picture 2
Audio 1
...
```

普通文本编辑器即可使用这些媒体进行：

- 顶部缩略图参考
- 点击预览
- @ 插入
- Visual Prompt 渲染

---

# 15. 不默认包含智能节点自己的输出

第一版“参考节点”的 Effective Media Context：

```text
只读取该节点使用的输入媒体
```

默认不包含：

```text
AI Image 生成结果
AI Video 生成结果
AI Text 输出本身
```

例如：

```text
AI Image
├─ 引用 Picture A
├─ 引用 Picture B
└─ 输出 Result.png
```

普通文本参考这个 AI Image 节点时：

```text
得到 A + B
```

不自动得到：

```text
Result.png
```

以后如果有必要，可单独增加：

```text
□ 包含节点输出
```

v2.5.10 不做。

---

# 16. Effective Media Context 推荐内部结构

推荐建立一个轻量解析函数，而不是为大屏编辑重新写媒体逻辑：

```ts
type EffectiveMediaItem = {
  type: 'image' | 'audio' | 'video';
  sourceFieldId: string;
  sourceFieldName: string;
  attachment: AttachmentItem;
};
```

核心接口：

```ts
resolveEffectiveMediaContext(
  sourceField,
  record
)
```

输出：

```ts
EffectiveMediaItem[]
```

以后可以同时被：

- 普通文本临时参考
- 智能文本 Visual
- Flow Canvas

复用。

---

# 17. 普通文本的临时参考生命周期

这是**编辑辅助状态**。

不写入：

```text
Field Config
Record Cell
```

即：

```text
打开大屏
→ 选择“视频提示优化”
→ 使用媒体编辑
→ 关闭大屏

文本保存
临时参考选择不成为永久字段依赖
```

---

# 18. 上一行 / 下一行与临时参考

这是本版重要交互。

例如：

```text
当前字段：视频提示
临时参考：视频提示优化
```

从第 17 行点击：

```text
下一行
```

系统：

```text
保存第17行文本
→ 第18行
→ 临时参考仍然 = 视频提示优化
→ 重新解析第18行“视频提示优化”的 Media Context
```

继续下一行：

```text
第19行
→ 同样沿用
```

也就是说：

```text
参考“哪个节点”
保持不变

这个节点在“当前行引用了哪些媒体”
随行实时变化
```

关闭大屏后临时选择清空。

---

# 19. 普通文本临时参考 UI

建议非常轻：

```text
临时参考
[ 视频提示优化                 ▾ ]
```

下面直接进入：

```text
当前行引用媒体

[Picture 1] [Picture 2] [Audio 1]
```

不要显示：

```text
来源附件字段：
参考
音乐
首帧
……
```

普通文本用户不需要理解底层附件列关系。

---

# 20. Visual Prompt 结构渲染 v1

第一批支持结构化强调：

```text
<...>
[...]

【...】
```

显示：

```text
font-weight: 600 / 700
```

但原始文本不改变。

例如：

```text
<Subject 1>
```

Visual：

```text
<Subject 1>  ← Bold
```

Raw：

```text
<Subject 1>
```

仍然完全一样。

---

# 21. Visual Syntax Renderer 必须可扩展

不要把规则散落在 JSX 中。

建议统一函数：

```ts
highlightLargeVisualSyntax(text)
```

或：

```ts
VISUAL_TEXT_RULES
```

第一版：

```text
<>
[]
【】
```

以后可以继续追加：

- 时间戳
- Subject
- Shot
- Camera
- JSON key
- Markdown-like heading
- 模型专用 Token

无需重新改整个 Editor。

---

# 22. 数据写回原则

## 普通文本

```text
大屏编辑文本
→ record[fieldId]
```

临时参考：

```text
只存在 modal session state
```

## 智能文本

编辑生成结果：

```text
→ 当前 aiText Cell
```

媒体上下文：

```text
来自现有 Field Config
```

不建立新媒体配置。

---

# 23. 本版明确不做

v2.5.10 不做：

- Flow Canvas
- 节点永久连线
- 多参考智能节点
- 普通文本永久 referenceTemplate
- 把临时参考写入 Field Config
- 新的 Media 数据结构
- 修改 Provider
- 修改 API 协议
- 修改 Job Runtime
- 修改 Skill Runtime
- 修改 AI Image / Video 主生成逻辑

---

# 24. 预计修改范围

尽量控制在现有文件内。

重点：

```text
src/components/Grid.tsx
src/App.tsx
src/index.css
```

版本同步：

```text
package.json
package-lock.json
```

文档：

```text
readme/v2.5.10升级说明.md
v2.5.10修改日志.md
```

如果 `Effective Media Context` 逻辑很短：

```text
优先继续放现有 Grid helper 区域
```

如果开始被三个以上模块复用，再考虑抽独立 helper。

第一版不要为了“架构漂亮”增加很多小文件。

---

# 25. 回归测试清单

## 编辑快捷键

- [ ] Delete
- [ ] Backspace
- [ ] Enter
- [ ] Ctrl+A
- [ ] Ctrl+C
- [ ] Ctrl+X
- [ ] Ctrl+V
- [ ] Ctrl+Z
- [ ] Ctrl+Y
- [ ] Shift+方向键
- [ ] 右键复制粘贴

## Cell

- [ ] 非编辑显示 Expand
- [ ] Inline edit 隐藏 Expand
- [ ] Expand 不遮挡 Scrollbar
- [ ] 文本右侧无过度留白
- [ ] 下方其它行不误显示 Expand

## Smart Text

- [ ] 外部选中即可重新生成
- [ ] 生成按钮视觉与 AI Image / Video 一致
- [ ] Visual 首次打开 Thumbnail 正确
- [ ] @ 图片
- [ ] @ 音频
- [ ] @ 视频
- [ ] 图片 / 音频 / 视频独立编号

## Ordinary Text Temporary Reference

- [ ] 只显示 AI Text / AI Image / AI Video 候选
- [ ] 单选节点
- [ ] 正确解析该节点当前行 Media Context
- [ ] 不包含节点生成输出
- [ ] @ 菜单正确
- [ ] Visual 正确
- [ ] 上一行沿用参考节点
- [ ] 下一行沿用参考节点
- [ ] 每行媒体重新解析
- [ ] 关闭大屏后临时设置不写 Field Config

## Visual Syntax

- [ ] `<...>` 加粗
- [ ] `[...]` 加粗
- [ ] `【...】` 加粗
- [ ] Raw 数据无变化

---

# 26. v2.5.10 最终用户流程

## 智能文本

```text
选中 AI Text Cell
→ 点击 Expand
→ 大屏编辑
→ 当前行引用媒体自动出现
→ 纯文本 / 引用渲染
→ @ Picture / Audio / Video
→ 上一行 / 下一行
→ 编辑自动保存
```

## 普通文本

```text
选中 Text Cell
→ 点击 Expand
→ 大屏编辑
→ 临时参考：选择一个 AI 节点
→ 自动继承该节点当前行使用的媒体
→ 顶部 Thumbnail
→ @ 插入
→ 引用渲染
→ 下一行
→ 沿用相同参考节点
→ 自动换成下一行的媒体 Context
```

---

# 27. 一句话定义 v2.5.10

> **把现有表格的文本编辑，从“小格子里改文字”升级成一个真正适合长 Prompt 连续编辑、媒体参考和逐行校对的轻量工作台，但不引入 Workflow 的复杂度。**
