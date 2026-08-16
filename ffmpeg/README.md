# FFmpeg 外置运行库说明

Hong's AI Table Studio v2.6.1 的音频 / 视频时间片段功能需要 FFmpeg。

本项目不会把 FFmpeg 二进制文件混入源码升级包。请把 FFmpeg 作为独立运行库放在本目录中，
这样后续只更新 AI Table Studio 代码时，不需要反复覆盖 FFmpeg。

## 推荐下载来源

### 1. FFmpeg 官方 Windows 下载入口
https://ffmpeg.org/download.html#build-windows

### 2. Gyan Windows Builds
https://www.gyan.dev/ffmpeg/builds/

### 3. GyanD GitHub Releases
https://github.com/GyanD/codexffmpeg/releases

推荐下载 Windows x64 的：

- `ffmpeg-*-essentials_build.zip`
- 或 `ffmpeg-*-essentials_build.7z`

当前项目只需要常用音视频裁切、转码和媒体信息读取能力，Essentials 版本即可。

**不要下载 GitHub 页面里的 `Source code (zip)` / `Source code (tar.gz)`。**
源码包会出现 `libavcodec`、`ffbuild`、`configure`、`tests` 等大量源码目录，
它不是本项目直接使用的 Windows 可执行版本。

## 正确目录

解压下载的 Essentials Build 后，找到其中的 `bin` 文件夹。

最终保证项目目录中存在：

```text
ffmpeg/
└─ bin/
   ├─ ffmpeg.exe
   ├─ ffprobe.exe
   └─ ffplay.exe      # 可选，不需要也可以删除
```

Hong's AI Table Studio 实际只要求：

- `ffmpeg/bin/ffmpeg.exe`
- `ffmpeg/bin/ffprobe.exe`

`ffplay.exe` 不参与 v2.6.1 的媒体预处理，可以保留，也可以删除。

## 快速检查

在项目根目录打开命令行执行：

```bat
ffmpeg\bin\ffmpeg.exe -version
ffmpeg\bin\ffprobe.exe -version
```

能正常输出版本信息，即表示运行库位置正确。

## 路径兼容

v2.6.1 默认优先读取：

1. `./ffmpeg/bin/ffmpeg.exe`
2. `./ffmpeg/bin/ffprobe.exe`

同时保留对旧目录、项目上一级公共 `ffmpeg/bin/`、环境变量和系统 PATH 的兼容兜底。

## 许可证

FFmpeg 是第三方开源项目。对外分发 FFmpeg 二进制文件时，请同时遵守所使用构建版本对应的许可证要求。
