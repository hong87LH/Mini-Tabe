# ComfyUI 双路由升级与测试报告（v2.5.3）

## 1. 版本链

| 版本 | 目录 | 主要内容 |
|---|---|---|
| v2.5.1 | `0812-ComfyUI清晰度映射-v2.5.1` | 清晰度按画幅映射、原始MP兼容 |
| v2.5.2 | `0812-附件音频预览-v2.5.2` | 恢复2K/4K显示、附件音频预览 |
| v2.5.3 | `0812-ComfyUI双路由-v2.5.3` | 首尾帧路由、多参素材路由 |

最终目录：

```text
E:\01_AIGC\00_AIstudio\bitable-clone-配置文件\0812-ComfyUI双路由-v2.5.3
```

旧版本均保留，未覆盖。整个过程没有安装或更新依赖。

## 2. v2.5.2 修改

### 2.1 恢复原显示

前台下拉框中的：

```text
2K（其他模型）
4K（其他模型）
```

已恢复为：

```text
2K
4K
```

### 2.2 附件音频预览

附件预览现支持：

- 图片：保持原图片预览；
- 视频：保持原视频预览；
- 音频：音乐缩略图 + 原生音频播放器。

支持扩展名：

```text
mp3, wav, flac, m4a, aac, ogg, opus
```

音频预览支持播放、暂停、进度拖动、音量和浏览器原生下载菜单。附件选择器已加入 `audio/*`。

## 3. v2.5.3 前台模型

### 3.1 首尾帧路由

模型名称：

```text
minimax-h3-first-last-local
```

兼容别名：

```text
minimax-h3-local
minimax-h3-first-last
minimax-h3
comfyui-minimax-h3
```

路由规则：

| 图片数量 | 行为 |
|---:|---|
| 1张 | 第一张作为首帧，尾帧输入不启用 |
| 2张 | 第一张作为首帧，第二张动态建立LoadImage并连接为尾帧 |
| 0张或超过2张 | 提交前明确报错 |

该模型仍支持 fast 6步和 quality 20步。

### 3.2 多参素材路由

模型名称：

```text
minimax-h3-reference-local
```

兼容别名：

```text
minimax-h3-multiref-local
minimax-h3-multimodal-local
```

能力限制：

| 素材 | 数量 |
|---|---:|
| 图片 | 0–9张 |
| 视频 | 0–3个 |
| 独立音频 | 0–3个 |
| 全部参考素材 | 至少1个 |

路由规则：

- 图片 → 动态 `LoadImage` → `ref_images.ref_image_n`；
- 视频 → 动态 `LoadVideo` → `GetVideoComponents` → `ref_videos.ref_video_n`；
- 独立音频 → 动态 `LoadAudio` → `ref_audios.ref_audio_n`；
- 多类素材可以同时出现；
- 路由按各类型内部的附件顺序编号；
- 提示词缺少标签时自动在前部补充 `<Picture n>`、`<Video n>`、`<Audio n>`；
- 用户已经手写的标签不会重复添加。

## 4. 视频内嵌音轨限制

本机真实测试发现：

- 仅把视频帧连接到 `ref_videos`：成功；
- 独立音频连接到 `ref_audios`：成功；
- 同时把同一视频的帧与内嵌音轨连接到 `ref_videos + ref_video_audios`：当前 Turbo插件在采样时发生张量分段不匹配，错误为 `tensor a (3) / tensor b (2)`。

因此 v2.5.3 的正式路由不会自动把视频内嵌音轨接入 `ref_video_audios`。如果需要引用该声音，建议把音轨另存为独立音频附件，与视频一同输入；独立音频路由已经真实测试成功。

这是有意的安全降级，不是遗漏。

## 5. 清晰度与比例

两个新路由模型都支持：

```text
360P, 480P, 720P, 1080P
```

以及：

```text
1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9
```

继续兼容引用字段传入：

```text
0.3, 0.7, 0.78, 0.78MP, 0.9MP
```

清晰度档位按目标短边和画幅换算MP，原始数字直接作为MP。

## 6. API设置与前台使用

升级启动后，默认 ComfyUI Provider 会迁移为同时登记：

```text
minimax-h3-first-last-local
minimax-h3-reference-local
minimax-h3-local
```

旧配置不会删除；迁移函数会把缺少的两个新模型名称合并到现有 ComfyUI Provider。

使用方法：

1. 首帧或首尾帧视频：AI视频列模型填写/选择 `minimax-h3-first-last-local`；
2. 图片、视频、音频参考生成：选择 `minimax-h3-reference-local`；
3. 在“参考图片/视频”字段中引用附件列；该字段实际支持图片、视频和音频；
4. 使用 `360P + fast + 3秒`先测试路由，再提高质量。

## 7. 修改文件

### v2.5.2

- `src/components/Grid.tsx`：音频识别、缩略图、播放器、附件选择；恢复2K/4K显示；
- `package.json` / `package-lock.json`：2.5.2；
- `readme/v2.5.2升级说明.md`。

### v2.5.3

- `comfyui/comfyui_client.js`：通用媒体上传、音视频读取、多参动态路由、标签补齐、输入数量验证；
- `comfyui/workflows/minimax-h3-i2v/manifest.json`：升级为首尾帧路由注册；
- `comfyui/workflows/minimax-h3-reference-router/manifest.json`：多参模型注册；
- `comfyui/workflows/minimax-h3-reference-router/fast_api.json`：Ref2VA Turbo 6步；
- `comfyui/workflows/minimax-h3-reference-router/quality_api.json`：Ref2VA 原质量20步；
- `src/App.tsx`：旧配置自动合并两个新模型；
- `src/components/Grid.tsx`：扩展素材分类；
- `tests/comfyui_protocol.test.mjs`：双路由协议测试；
- `package.json` / `package-lock.json`：2.5.3。

## 8. 测试结果

### 8.1 ComfyUI能力检查

本机 ComfyUI 0.31.0 的 `MiniMaxH3ReferenceToVideo` 节点确认支持：

- 9张图片；
- 3个视频；
- 3个视频配套音频；
- 3个独立音频。

本机已存在 `minimax_h3_ref2va_pruned_int8_convrot.safetensors` 模型。

### 8.2 多参可行性真实测试

| 测试 | 结果 | 说明 |
|---|---|---|
| 视频参考帧 | 成功 | 360P、2:3、3秒，约217秒 |
| 独立音频参考 | 成功 | 360P、2:3、3秒，约27秒（模型已热） |
| 视频帧+配套视频音轨 | 失败 | Turbo插件张量3/2不匹配，正式路由已规避 |

真实测试输出位于：

```text
E:\01_AIGC\ComfyUI_windows_portable_H3\ComfyUI\output\video\codex_tests
```

### 8.3 v2.5.3 正式客户端真实验收

| 模型 | 输入 | 结果 |
|---|---|---|
| `minimax-h3-reference-local` | 独立WAV | 成功提交并完成 |
| `minimax-h3-first-last-local` | 两张图片 | 成功提交并完成，第二张作为尾帧 |

首尾帧真实输出：

```text
E:\01_AIGC\ComfyUI_windows_portable_H3\ComfyUI\output\video\lingwu_comfyui\minimax-h3-first-last-router\1786508975282_364272c8_00001_.mp4
```

### 8.4 协议测试

`npm run test:comfyui`：8项全部通过，包括：

- 两个模型注册；
- 清晰度与原始MP；
- 图片、视频、音频自动上传；
- 动态LoadImage/LoadVideo/GetVideoComponents/LoadAudio节点；
- 自动标签；
- 禁用不稳定的视频配套音轨连接；
- 首尾帧原有端到端任务；
- MP4输出解析。

### 8.5 类型检查和构建说明

按用户要求未安装依赖。v2.5.3目录中没有本地 `tsc` / `vite` 可执行文件，因此类型检查和Vite构建无法在不安装依赖的前提下执行。已执行：

- JavaScript语法检查；
- JSON解析；
- 8项Node协议测试；
- ComfyUI节点健康检查；
- 三项成功的真实生成测试；
- 一项失败组合的错误定位与正式规避。

用户使用成熟依赖库启动后，建议补跑 `npm run lint` 与 `npm run build`。

## 9. 建议回归测试

1. 打开API设置，确认现有 ComfyUI Provider 的模型名称包含两个新模型；
2. 新建首尾帧AI视频列，分别测试1张图和2张图；
3. 新建多参AI视频列，分别测试图片、视频、音频；
4. 再测试图片+视频+独立音频混合输入；
5. 点击附件中的MP3/WAV，确认播放器正常；
6. 测试清晰度引用字段：720P、0.7、0.78MP；
7. 确认旧的 `minimax-h3-local` 仍能生成。

## 10. 最终结论

v2.5.3 已完成两个可在前台注册和选择的 MiniMax H3 本地模型，并在内部根据素材类型自动建立 ComfyUI 输入路由。视频参考和独立音频参考均已通过本机真实采样；不稳定的视频配套音轨组合已被明确识别和规避。附件预览现已覆盖图片、视频和音频。
