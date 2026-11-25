<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/91089e78-1698-4f15-91ca-4a320ffec6ee

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`



## FFmpeg Runtime

v2.6.1 的音视频 A-B 裁切、5s / 10s / 15s / 20s 快捷片段依赖 FFmpeg。

官方下载：
https://ffmpeg.org/download.html

Windows 推荐：
https://www.gyan.dev/ffmpeg/builds/

建议下载：

```text
ffmpeg-release-essentials.zip
````

不要下载 `Source code` 源码包。

目录：

```text
Hong's AI Table Studio/
└─ ffmpeg/
   └─ bin/
      ├─ ffmpeg.exe
      └─ ffprobe.exe
```

`ffmpeg.exe` 负责裁切 / 转码，`ffprobe.exe` 负责读取媒体时长和参数。FFmpeg 作为独立运行库，后续程序升级一般无需重复覆盖。




## Version Timeline

### v2.4.9 → v2.8.3

```text
v2.4.9   同模型 Provider 协议切换
v2.4.10  Job 路径 / 修图尺寸修复
v2.4.11  OSS 月流量查询
v2.4.12  .part 完整性 / NAS 文件锁
v2.5.0   ComfyUI 通用协议
v2.5.1   H3 清晰度映射
v2.5.2   音频附件
v2.5.3   H3 双路由 / 多参考
v2.5.4   多参真实组合验证
v2.5.5   Fast 多参 / 长队列 / 自动启动
v2.5.6   Skill System v1.0 / 智能文本 Skill Registry
v2.5.7   批量附件导出增强 / Skill System 稳定性修复
v2.5.8   文本大屏编辑 / Visual Prompt / 当前行媒体引用 / @ 插入
v2.5.9   文本 Clipboard / Undo 修复 / 媒体独立编号 / 缩略图与引用 UI 优化
v2.5.10  大屏连续编辑 / 临时智能节点参考 / 媒体预览与同源多裁切修复
v2.6.1   音视频非破坏式 Trim / A-B 时间点 / FFmpeg Media Preprocessor
v2.6.2   临时参考会话固定 / 同列跨行沿用参考节点
v2.6.3   引用渲染换行 / OSS SHA256 精确复用 / 标签匹配修复
v2.6.4   Table Action API v0.1 / Revision / 事务 / 幂等 / Job / SSE
v2.6.5   Action API phase4.7 / Action Definition / Job 与 CLI 增强
v2.6.6   筛选分组插行 / 图片审阅 / Photoshop 联动
v2.6.7   侧边栏与列布局 / 隐藏列 / 连续与单独冻结
v2.6.8   媒体缩略图按可视区域加载 / 并发与去重调度
v2.6.9   Windows 缩略图路径 / 历史裁切预览复原
v2.7.0   生成占位符 / 多 Job 与重启回填修复
v2.7.1   剪切属性保留 / 粘贴完整性 / Skill 下拉精简
v2.7.2   Qwen 本地图片与透明 PNG / 统一参数 / 图生图比例
v2.7.3   ComfyUI 局域网服务地址
v2.7.4   banana-2.1 / 审阅筛选与裁切预览
v2.7.5   banana-pro 更名 / 模型候选列表修复
v2.7.6   项目文件夹 / 导航 / JSON 兼容 / Action 项目操作
v2.7.7   Qwen Face / Consistency / LoRA Profile 与提示词策略
v2.7.8   TT Image 2.6 / PNG·SVG·GIF / 专业媒体附件
v2.7.9   图片模型引用参数精简 / GIF 默认参数 / Qwen 高保真
v2.8.0   Qwen 人物 LoRA / 即梦 5.5 / MiniMax H3 图片模型
v2.8.2   双模型智能裁切 / 发顶与服装轮廓 / 近似比例
v2.8.3   裁切软硬约束 / 媒体身份安全写回 / 批量幂等
```

### Release Notes

- [v2.7.4 · 局域网 ComfyUI 与审阅优化](readme/v2.7.4_局域网ComfyUI与审阅优化.md)
- [v2.7.5 · 模型更名与候选列表修复](readme/v2.7.5_模型更名与候选列表修复.md)
- [v2.7.6 · 项目文件夹与导航升级](readme/v2.7.6_项目文件夹与导航升级.md)
- [v2.7.7 · Qwen Face 与 LoRA 工作流](readme/90_版本记录/v2.7.7_ComfyUI工作流维护与Action同步.md)
- [v2.7.8 · TT Image 2.6 与专业媒体格式](readme/90_版本记录/v2.7.8_TT_Image_2.6与专业媒体格式升级.md)
- [v2.7.9 · 图片模型引用参数精简](readme/90_版本记录/v2.7.9_图片模型引用参数精简.md)
- [v2.8.0 · Qwen 功能 LoRA 与图片模型扩展](readme/90_版本记录/v2.8.0_Qwen功能LoRA与图片模型扩展.md)
- [v2.8.2 · 双模型智能裁切](readme/90_版本记录/v2.8.2_智能裁切双模型轮廓版.md)
- [v2.8.3 · 智能裁切约束与安全写回](readme/90_版本记录/v2.8.3_智能裁切约束与安全写回.md)
