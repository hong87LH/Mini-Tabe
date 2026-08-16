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

### v2.5.x → v2.6.x

```text
v2.5.0  ComfyUI 通用协议
v2.5.1  H3 清晰度映射
v2.5.2  音频附件
v2.5.3  H3 双路由 / 多参考
v2.5.4  多参真实组合验证
v2.5.5  Fast 多参 / 长队列 / 自动启动
v2.5.6  Skill System v1.0 / 智能文本 Skill Registry
v2.5.7  批量附件导出增强 / Skill System 稳定性修复
v2.5.8  文本大屏编辑 / Visual Prompt / 当前行媒体引用 / @ 插入
v2.5.9  文本 Clipboard / Undo 修复 / 媒体独立编号 / 缩略图与引用 UI 优化
v2.5.10 大屏连续编辑 / 临时智能节点参考 / @ 光标跟随 / 媒体预览与同源多裁切修复
v2.6.1  音视频非破坏式 Trim / A-B 时间点 / 5s·10s·15s·20s 快捷片段 / FFmpeg Media Preprocessor
```

### v2.4.x → v2.5.x

```text
v2.4.9   同模型 Provider 协议切换
v2.4.10  Job 路径 / 修图尺寸修复
v2.4.11  OSS 月流量查询
v2.4.12  .part 完整性 / NAS 文件锁
v2.5.0   ComfyUI Local 架构
v2.5.5   本地 H3 多参生产链路收口
v2.5.6   智能文本 Skill 注册与结构化上下文
v2.5.7   图片、视频、音频附件分类导出
```
