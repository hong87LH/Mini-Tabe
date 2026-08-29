# ComfyUI 通用协议升级、使用与维护手册

> 项目版本：v2.5.0  
> 文档日期：2026-08-11  
> 当前状态：MiniMax H3 本地工作流已完成真实调用验证  
> 适用对象：日常使用人员、工作流维护人员、后续开发人员

## 1. 文档目的

本次升级的目标不是把 ComfyUI 临时伪装成原来的 Lingwu 接口，而是在现有工具中增加一个与 Lingwu 并列的 **ComfyUI Local Provider（本地 ComfyUI 提供方）**。

升级后，前台仍然沿用原有的表格、AI 图片/视频列、任务排队、结果回填和下载逻辑；后台则根据任务选择的 Provider，把任务发送给 Lingwu 或本地 ComfyUI。

以后接入新的 ComfyUI 图片或视频工作流时，绝大多数情况下只需要新增：

1. ComfyUI 导出的 API 工作流 JSON；
2. 一份描述模型名称、能力和节点映射的 `manifest.json`。

不需要为每一个新模型重新开发整套前台和任务系统。

---

## 2. 版本与目录

### 2.1 原版本

```text
E:\01_AIGC\00_AIstudio\bitable-clone-配置文件\0804-1-修复job下载resize逻辑-v2.4.12
```

原版本保持不变，用作回退和历史对照。

### 2.2 新版本

```text
E:\01_AIGC\00_AIstudio\bitable-clone-配置文件\0811-ComfyUI通用协议-v2.5.0
```

### 2.3 ComfyUI

```text
E:\01_AIGC\ComfyUI_windows_portable_H3
```

默认服务地址：

```text
http://127.0.0.1:8188
```

### 2.4 最重要的维护目录

```text
项目根目录\comfyui\workflows
```

当前 MiniMax H3 工作流位于：

```text
comfyui\workflows\minimax-h3-i2v
```

以后新增或修改 ComfyUI 工作流，优先检查这个目录。

---

## 3. 本次升级结果

### 3.1 新增双 Provider 架构

当前支持两种任务提供方：

- `Lingwu`：保留原有远程调用逻辑；
- `ComfyUI Local`：调用本机或局域网中的 ComfyUI。

任务会保存真实的 `provider` 字段，应用重启后恢复轮询时仍能找到正确的服务，不会把 ComfyUI 任务误交给 Lingwu 查询。

### 3.2 新增 ComfyUI 通用调用能力

ComfyUI 客户端目前支持：

- 检查 ComfyUI 服务和必要节点；
- 读取本地路径、UNC 网络路径、HTTP 地址和 data URL 图片；
- 自动上传输入图片到 ComfyUI；
- 把前台参数写入指定工作流节点；
- 向 `/prompt` 提交工作流；
- 通过 `/queue` 和 `/history` 查询排队、运行、成功或失败状态；
- 从保存节点中识别图片、视频和音频输出；
- 通过 `/view` 获取结果；
- 将结果继续交给原应用的下载和表格回填流程。

### 3.3 本地素材不再绕行 OSS

ComfyUI Local 任务可以直接读取本地磁盘或 NAS/UNC 路径素材并上传给本地 ComfyUI，不需要先上传到 OSS。

Lingwu 远程任务仍保留原来的 OSS 处理方式，因此原有云端调用不受影响。

### 3.4 当前已注册模型

工作流 ID：

```text
minimax-h3-i2v
```

可用于前台配置的模型别名：

```text
minimax-h3-local
minimax-h3
comfyui-minimax-h3
```

日常使用建议统一填写：

```text
minimax-h3-local
```

---

## 4. MiniMax H3 当前能力

| 项目 | 当前支持 |
|---|---|
| 类型 | 图生视频 |
| 首帧图片 | 必填，1 张 |
| 尾帧图片 | 可选，第 2 张图片会作为尾帧 |
| 画幅 | `16:9`、`3:4` |
| 分辨率 | `0.7MP`、`0.9MP` |
| 模式 | `fast`、`quality` |
| 时长 | 3、5、8、10、15 秒 |
| 声音 | 可开关模型音轨 |
| Seed | 支持固定；不填则自动生成 |
| 输出 | MP4 视频 |

### 4.1 两种模式

`fast`：

- 使用 Turbo 工作流；
- 6 步；
- Euler 采样；
- 适合预览、动作测试、提示词筛选和批量初筛。

`quality`：

- 使用原质量工作流；
- 20 步；
- `res_multistep` 采样；
- 适合确认动作后生成正式素材。

### 4.2 关于 0.7MP、0.9MP 与 720p/1080p

`0.7MP` 和 `0.9MP` 表示目标总像素量，会根据 `16:9` 或 `3:4` 自动计算宽高，不严格等同于固定的 480p、720p 或 1080p。

当前建议：

- `0.7MP + fast`：动作预览；
- `0.7MP + quality`：普通正式素材；
- `0.9MP + quality`：当前基础生成中的优先高质量档；
- 需要“1080 级交付”时：先用 `0.9MP + quality` 生成，再进入独立超分和轻度去雾/锐化流程。

以后可以只修改前台显示名称，把这些组合显示成“预览、标准、高清、1080 级”，但底层仍建议保留真实的 `0.7MP/0.9MP` 参数，避免产生错误理解。

---

## 5. 日常启动顺序

1. 启动 `E:\01_AIGC\ComfyUI_windows_portable_H3` 中的 NVIDIA 启动批处理文件。
2. 保留 ComfyUI 命令窗口可见，便于查看加载、显存和报错信息。
3. 浏览器确认 `http://127.0.0.1:8188` 可以打开。
4. 启动 v2.5.0 工具。
5. 在工具中选择 `ComfyUI Local` 和 `minimax-h3-local` 后提交任务。

建议先启动 ComfyUI，再启动工具。工具先启动也不会损坏数据，但提交任务时会提示无法连接。

---

## 6. 工具中的一次性配置

进入“API 和模型配置”，新增或检查视频配置：

| 配置项 | 填写内容 |
|---|---|
| 提供商/协议 | `ComfyUI Local` |
| 接口地址 | `http://127.0.0.1:8188` |
| API Key | 留空 |
| 模型名称 | `minimax-h3-local` |
| 状态 | 启用 |

注意事项：

- 模型名称用于找到 `manifest.json` 中注册的工作流，不能随意填写；
- 本机 ComfyUI 默认不需要 API Key；
- 如果将 ComfyUI 部署到另一台局域网电脑，接口地址可以改为该电脑的 IP 和端口；
- 同一个模型名称不要同时启用多个 Provider，否则前台选择可能产生歧义；
- AI 视频列中也应明确选择 `minimax-h3-local`。

---

## 7. 日常生成建议

### 7.1 推荐测试顺序

1. 先用 `0.7MP + fast + 3 秒` 检查人物动作和提示词；
2. 动作满意后用相同图片、提示词和 seed 切换到 `quality` 对照；
3. 正式素材优先测试 `0.9MP + quality`；
4. 只有基础生成清晰且动作正确后，再做 1080 级超分；
5. 不要用超分修复严重错误的动作、手部或服装结构，应先回到基础生成解决。

### 7.2 单图和双图

- 只提供一张图片：按首帧图生视频运行；
- 提供两张图片：第一张作为首帧，第二张作为尾帧；
- 没有明确尾帧设计时，不建议为了凑数量加入第二张图；
- 素材路径可以是本地路径，也可以是类似 `\\服务器\共享目录\图片.jpg` 的 UNC 路径，但运行工具的 Windows 用户必须有读取权限。

### 7.3 声音开关

关闭声音后，工作流不会连接模型生成的音轨。电商服装展示通常可以先关闭声音，减少不必要的不确定性；后期需要音乐时再统一剪辑。

---

## 8. 工作原理

一次 ComfyUI 任务的链路如下：

```text
AI 图片/视频列
  → 根据模型选择 Provider
  → 读取工作流 manifest
  → 选择 fast 或 quality API 模板
  → 上传本地/网络图片到 ComfyUI
  → 写入提示词、画幅、像素、时长、seed、声音等参数
  → 提交到 ComfyUI /prompt
  → 保存 prompt_id
  → 查询 /queue 与 /history
  → 找到保存节点输出
  → 下载结果并回填表格
```

前台看起来仍接近原来的调用方式，是因为这次有意复用了成熟的表格和任务界面；实际任务已经通过独立的 ComfyUI Provider 和工作流注册层运行。

---

## 9. 关键文件及职责

### 9.1 Provider 与任务层

`provider_registry.js`

- 根据任务的 `provider` 创建 Lingwu 或 ComfyUI 客户端；
- 是两套调用协议的入口分流位置。

`media_job_runner.js`

- 创建媒体任务；
- 保存真实 Provider；
- ComfyUI 本地素材绕过 OSS；
- 调用对应 Provider 的 `createTask`。

`network_polling.js`

- 恢复和轮询后台任务；
- 根据 `job.provider` 查询正确的服务；
- 负责任务完成后的后续处理。

### 9.2 ComfyUI 协议层

`comfyui/comfyui_client.js`

- 素材读取和上传；
- 参数标准化；
- 工作流提交；
- 队列与历史查询；
- 输出文件识别。

只有出现新的输入/输出类型或协议能力时才通常需要修改它，例如：

- 视频作为输入；
- 外部音频输入；
- 遮罩图；
- 一次提交多批次；
- 不同于标准保存节点的特殊输出。

`comfyui/workflow_registry.js`

- 扫描 `comfyui/workflows/*/manifest.json`；
- 根据模型 ID 或别名查找工作流；
- 选择 fast/quality 模板；
- 安全写入节点参数；
- 支持带 BOM 的 JSON 文件。

通常新增普通图片或视频工作流不需要修改这个文件。

### 9.3 工作流注册目录

`comfyui/workflows/<工作流目录>/manifest.json`

- 声明工作流 ID、别名和名称；
- 声明是图片还是视频；
- 声明输入数量、画幅、分辨率、模式、时长和声音能力；
- 把通用参数绑定到具体节点路径；
- 声明结果保存节点和必需的自定义节点。

`fast_api.json` / `quality_api.json`

- 来自 ComfyUI 的 API 格式工作流；
- 保存真实节点和连线；
- 可以按需求使用其他文件名，只要在 manifest 的 `templates` 中一致。

### 9.4 前台配置

`src/components/ApiSettings.tsx`

- Provider 配置界面；
- 包含 `ComfyUI Local` 选项。

`src/components/Grid.tsx`

- AI 图片和 AI 视频列的模型选择与任务提交；
- 包含分辨率、画幅、时长等前台选项。

`src/App.tsx`

- 旧配置迁移；
- 在需要时自动补充默认本地 ComfyUI 配置。

### 9.5 Electron 与诊断

`main.js`、`preload.js`

- 提供只读的 ComfyUI 健康检查能力；
- 保留原有 Electron 和 Lingwu 接口。

本次没有另行改造 Electron 打包体系，产品名仍为 `LingwuApp`。

---

## 10. 如何新增一个 ComfyUI 工作流

### 10.1 先在 ComfyUI 中完成验证

新增工作流前，必须先在 ComfyUI 页面中独立运行成功，确认：

- 模型和自定义节点齐全；
- 输入素材能被正确读取；
- 所需参数确实有效；
- 保存节点可以产生图片或视频文件；
- 快速和高质量模式分别能独立运行。

不要直接使用未在 ComfyUI 中验证过的工作流做应用接入。

### 10.2 导出 API 格式

从 ComfyUI 导出 **API Format** JSON，而不是只保存普通界面工作流 JSON。

普通界面工作流通常带有画布布局信息；API 格式则以节点 ID 为键，节点中包含 `inputs` 和 `class_type`，更适合程序提交。

### 10.3 建立独立目录

示例：

```text
comfyui\workflows\wan-i2v
  manifest.json
  fast_api.json
  quality_api.json
```

每个工作流使用独立目录，不要把多个模型的 JSON 混在同一目录中。

### 10.4 编写 manifest

可以复制 `minimax-h3-i2v/manifest.json` 后修改。示例骨架：

```json
{
  "id": "wan-i2v",
  "aliases": ["wan-video-local"],
  "name": "WAN 图生视频",
  "provider": "comfyui",
  "mediaType": "video",
  "templates": {
    "fast": "fast_api.json",
    "quality": "quality_api.json"
  },
  "defaults": {
    "mode": "fast",
    "resolution": "0.7MP",
    "aspectRatio": "16:9",
    "duration": 5,
    "sound": false
  },
  "capabilities": {
    "inputImages": { "min": 1, "max": 1 },
    "inputVideos": { "min": 0, "max": 0 },
    "inputAudio": { "min": 0, "max": 0 },
    "aspectRatios": ["16:9", "3:4"],
    "resolutions": ["0.7MP", "0.9MP"],
    "modes": ["fast", "quality"],
    "durations": [3, 5],
    "audio": false
  },
  "bindings": {
    "prompt": "提示词节点ID.inputs.text",
    "aspectRatio": "分辨率节点ID.inputs.aspect_ratio",
    "megapixels": "分辨率节点ID.inputs.megapixels",
    "duration": "时长节点ID.inputs.value",
    "seed": "采样节点ID.inputs.seed",
    "outputPrefix": "保存节点ID.inputs.filename_prefix",
    "firstImage": "载图节点ID.inputs.image"
  },
  "maps": {
    "aspectRatio": {
      "16:9": "工作流实际需要的值",
      "3:4": "工作流实际需要的值"
    },
    "resolution": {
      "0.7MP": 0.7,
      "0.9MP": 0.9
    }
  },
  "output": {
    "node": "保存节点ID",
    "type": "video"
  },
  "requiredNodeTypes": [
    "工作流必需的关键自定义节点 class_type"
  ]
}
```

### 10.5 节点绑定规则

绑定路径采用点号路径：

```text
节点ID.inputs.参数名
```

例如：

```text
131.inputs.prompt
115.inputs.aspect_ratio
129.inputs.noise_seed
```

节点 ID 和输入字段名必须以导出的 API JSON 为准。只要重新增删过节点，ComfyUI 节点 ID 就可能变化，因此更新工作流 JSON 后必须重新核对 manifest。

### 10.6 注册前台模型名称

把希望在 API 设置和 AI 列中使用的模型名称加入 `aliases`。建议本地模型统一使用 `-local` 结尾，例如：

```text
flux-image-local
wan-video-local
qwen-image-local
minimax-h3-local
```

模型名称只负责找到工作流，不等于底层模型文件名。

### 10.7 图片工作流

图片协议通路已经接通，但每个图片模型仍需自己的 API JSON 和 manifest。

图片工作流应设置：

```json
"mediaType": "image"
```

并保证保存节点能在 ComfyUI 历史记录中返回带 `filename` 的输出。若工作流使用标准 `SaveImage`，通常不需要修改通用客户端。

### 10.8 什么时候必须修改代码

以下情况可能不能只靠 manifest 完成：

- 工作流要接收参考视频或外部音频；
- 需要上传遮罩、深度图或特殊二进制文件；
- 一个参数要同时控制多个节点；
- 参数需要复杂计算，而不是简单值映射；
- 输出没有写入标准 ComfyUI history；
- 需要 WebSocket 实时进度或预览图；
- 一个任务需要连续提交多个工作流。

遇到这些情况，优先扩展 `comfyui_client.js` 的通用能力，避免把某个模型的特殊逻辑硬编码进前台。

---

## 11. 新工作流验收清单

每接入一个新工作流，至少完成以下检查：

- [ ] 在 ComfyUI 页面中可以独立运行；
- [ ] 导出的文件确实是 API Format；
- [ ] manifest 的 ID 与别名没有和现有工作流冲突；
- [ ] fast/quality 模板文件都存在；
- [ ] 提示词、图片、画幅、分辨率、时长和 seed 绑定正确；
- [ ] 输入图片数量限制正确；
- [ ] 必需节点 `requiredNodeTypes` 填写正确；
- [ ] 输出节点能够被 history 找到；
- [ ] 健康检查无缺失节点；
- [ ] 先完成低成本快速任务；
- [ ] 再完成高质量真实任务；
- [ ] 任务排队、运行、失败和完成状态显示正确；
- [ ] 结果能够下载并回填；
- [ ] 应用重启后未完成任务仍可继续查询；
- [ ] 在升级报告中记录新增工作流和测试结果。

---

## 12. 检查和测试命令

在 v2.5.0 项目目录中运行。

### 12.1 检查 ComfyUI 服务和工作流节点

```powershell
npm run check:comfyui
```

成功时应看到：

- `health.ok` 为 `true`；
- 正确的 ComfyUI 版本和显卡名称；
- `missingNodeTypes` 为空数组；
- 已注册的工作流列表中包含 `minimax-h3-i2v`。

### 12.2 协议自动测试

```powershell
npm run test:comfyui
```

该测试使用模拟 ComfyUI 服务验证素材上传、参数映射、提交和 MP4 结果解析，不会执行真实模型采样。

### 12.3 TypeScript 检查

```powershell
npm run lint
```

### 12.4 前台构建

```powershell
npm run build
```

### 12.5 本地开发运行

```powershell
npm run dev
```

Electron 已有独立成熟运行库时，可以继续沿用现有启动方式；本次升级不要求重新制作 Electron 安装包。

---

## 13. 已完成验证

本次版本已经完成：

- JavaScript 语法检查；
- TypeScript `tsc --noEmit`；
- Vite 正式构建；
- 5 项 ComfyUI 协议自动测试；
- 本地图片上传模拟；
- `0.9MP + 3:4 + quality 20 步 + 3 秒 + 固定 seed + 关闭声音` 参数映射模拟；
- `/prompt` 提交模拟；
- MP4 输出地址解析模拟；
- ComfyUI 服务启动检查；
- MiniMax H3 真实调用。

最终用户验收结果：**已经从新版本工具成功调用本地 ComfyUI 生成任务。**

因此 v2.5.0 的核心调用链已经验证可用。

---

## 14. 常见问题与排查

### 14.1 提示无法连接 ComfyUI

检查顺序：

1. ComfyUI 命令窗口是否仍在运行；
2. `http://127.0.0.1:8188` 是否能打开；
3. API 设置中的地址是否正确；
4. 防火墙或其他程序是否占用 8188 端口；
5. 如果 ComfyUI 在另一台电脑，不能填写 `127.0.0.1`，应填写那台电脑的局域网 IP。

### 14.2 提示“未注册的 ComfyUI 工作流模型”

原因通常是模型名称没有匹配 manifest 的 `id` 或 `aliases`。

检查：

```text
comfyui\workflows\对应目录\manifest.json
```

确认 API 设置和 AI 列中的模型名称完全一致。MiniMax H3 推荐使用 `minimax-h3-local`。

### 14.3 提示缺失节点

说明工作流依赖的自定义节点没有安装、加载失败，或节点的 `class_type` 已改变。

处理方法：

1. 在 ComfyUI 中打开工作流检查红色节点；
2. 安装或更新缺失的自定义节点；
3. 重启 ComfyUI；
4. 再运行 `npm run check:comfyui`。

### 14.4 提交时出现 node_errors

这通常是 API JSON 或 manifest 绑定不一致：

- 节点 ID 已变化；
- 参数名已变化；
- 参数值格式不符合节点要求；
- fast/quality JSON 与 manifest 来自不同版本。

建议重新从当前可运行的 ComfyUI 工作流导出 API JSON，并逐项核对节点。

### 14.5 网络共享图片无法读取

检查：

- 路径是否以 `\\服务器\共享目录` 开头；
- 当前 Windows 用户能否在资源管理器中直接打开图片；
- NAS 登录凭据是否过期；
- 文件是否被移动或改名；
- 如果应用以其他 Windows 账户运行，该账户是否同样拥有共享目录权限。

### 14.6 任务一直显示等待或处理中

1. 查看 ComfyUI 命令窗口是否仍在采样；
2. 查看 ComfyUI 页面队列；
3. 检查显存是否不足；
4. 检查是否有人手动清空了队列或历史；
5. 重启应用后仍可通过已保存的 `prompt_id` 继续查询，但关闭 ComfyUI 会中断正在执行的采样。

### 14.7 已完成但没有结果文件

工作流必须使用能写入 history 的保存节点。如果只使用预览节点或自定义节点不返回 `filename`，应用会认为任务完成但找不到输出。

优先使用标准 `SaveImage`、可识别的 `SaveVideo`，或扩展客户端以适配特殊保存节点。

### 14.8 视频发雾或清晰度不足

建议按以下顺序处理：

1. 使用清晰、无压缩损坏的原始输入图；
2. 确认动作和镜头不要过大，减少运动造成的细节漂移；
3. 从 `fast` 切换到 `quality`；
4. 从 `0.7MP` 切换到 `0.9MP`；
5. 在满意的基础视频上进行视频超分、轻度去雾和适量锐化；
6. 不要单纯无限增加步数，超过当前工作流合理范围未必更清晰，反而可能降低稳定性。

### 14.9 两个 Provider 使用相同模型名

应在 API 设置中停用其中一个，或给本地模型使用明确的 `-local` 别名。推荐本地 ComfyUI 始终使用 `minimax-h3-local`。

---

## 15. 更新和备份原则

### 15.1 更新 ComfyUI 前

建议备份：

- `ComfyUI\custom_nodes`；
- `ComfyUI\user`；
- 当前可运行的工作流 JSON；
- 模型映射配置；
- 新版本项目的 `comfyui\workflows`；
- 本文档和升级报告。

大型模型文件可以继续使用映射或共享目录，不一定重复复制，但必须记录真实源路径。

### 15.2 更新工作流 JSON 前

不要直接覆盖唯一可用版本。建议：

1. 复制当前工作流目录作为备份；
2. 在 ComfyUI 中验证新工作流；
3. 导出 API JSON；
4. 核对 manifest 节点绑定；
5. 完成 fast 和 quality 的小样测试；
6. 再替换正式文件。

### 15.3 更新应用代码时

- 不要直接修改 v2.4.12 回退版本；
- 新的大版本建议复制新目录继续升级；
- 保留用户数据和原有未关联修改；
- 更新后依次运行协议测试、类型检查和构建；
- 最后执行真实小样调用。

### 15.4 依赖安全提示

项目依赖树中存在历史安全警告。本次没有运行可能造成破坏性升级的：

```text
npm audit fix --force
```

后续如需处理依赖，应单独建立测试副本并完整回归，不要在生产可用目录中直接强制升级。

---

## 16. 当前限制与后续建议

当前限制：

- 正式注册的工作流目前只有 MiniMax H3 图生视频；
- 图片 Provider 的通路已存在，但具体图片模型仍需注册各自工作流；
- 当前主要通过轮询获取状态，没有接入 WebSocket 精细进度；
- 0.7MP/0.9MP 仍按真实模型参数显示，没有转换成更友好的档位名称；
- 1080 级超分尚未作为独立 ComfyUI 工作流接入应用；
- 参考视频、外部音频和遮罩输入尚未实现通用上传绑定。

建议后续按优先级推进：

1. 增加“预览 / 标准 / 高清 / 1080 级”友好档位映射；
2. 把视频超分做成独立 ComfyUI 工作流并注册；
3. 注册常用图片生成或修图工作流；
4. 为 manifest 增加自动结构校验；
5. 为每个新工作流建立固定的小样回归测试；
6. 需要更细体验时，再加入 WebSocket 实时进度。

---

## 17. 维护速查

| 想做的事情 | 优先维护位置 |
|---|---|
| 修改 H3 快速/原速节点 | `comfyui/workflows/minimax-h3-i2v/*.json` |
| 修改 H3 模型名、参数或节点映射 | `comfyui/workflows/minimax-h3-i2v/manifest.json` |
| 新增普通图片/视频工作流 | `comfyui/workflows/<新目录>` |
| 增加新的素材类型或复杂协议能力 | `comfyui/comfyui_client.js` |
| 修改工作流发现和模板选择 | `comfyui/workflow_registry.js` |
| 修改 Lingwu/ComfyUI 分流 | `provider_registry.js` |
| 修改任务创建和本地素材处理 | `media_job_runner.js` |
| 修改任务恢复和轮询 | `network_polling.js` |
| 修改 API 设置页面 | `src/components/ApiSettings.tsx` |
| 修改 AI 列参数和显示名称 | `src/components/Grid.tsx` |
| 修改默认配置迁移 | `src/App.tsx` |
| 检查 ComfyUI 和关键节点 | `npm run check:comfyui` |
| 运行协议回归测试 | `npm run test:comfyui` |

## 18. 最终结论

v2.5.0 已经完成从“只有 Lingwu 调用逻辑”到“Lingwu + ComfyUI 通用 Provider”的升级，并已通过 MiniMax H3 的真实调用验证。

以后扩展普通 ComfyUI 工作流时，维护重点是：

```text
comfyui\workflows\<工作流目录>\manifest.json
comfyui\workflows\<工作流目录>\*_api.json
```

只有在出现新的素材类型、复杂参数或特殊输出协议时，才需要扩展通用客户端。这样可以最大限度保留现有表格、工作流、模型、插件和下载回填逻辑，同时让后续的 ComfyUI 图片、视频和超分流程逐步接入同一个工具。
