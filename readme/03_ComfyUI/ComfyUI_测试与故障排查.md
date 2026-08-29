# ComfyUI 测试与故障排查

适用工程：AI Table Studio v2.6.3 后续分支  
最后核对：2026-08-24

## 1. 三层测试

不要用单一结果代表整条链路已经通过。

### 第一层：协议自动测试

```bat
cd /d F:\01_AIGC\12_AI_studio\bitable-clone
npm run test:comfyui
```

不连接真实 ComfyUI，不产生生成费用。当前基线：

```text
11 tests
11 pass
0 fail
```

覆盖：两套 H3 注册、0 图文生、Fast/Quality、混合参考修正、清晰度映射、图片/视频/音频上传路由、Manifest Binding 和结果 URL 解析。

### 第二层：真实环境检查

```bat
npm run check:comfyui
```

检查：

- Endpoint 是否可连接；
- ComfyUI 版本和设备；
- 两套工作流是否注册；
- Fast/Quality 模板步数和 Sampler；
- Required Node Types；
- 缺失插件与安装建议。

2026-08-24 本机检查：ComfyUI `0.31.0`、RTX 4060 Laptop GPU、Health 正常、当前目标工作流无缺失节点。

### 第三层：真实生成

真实生成才验证模型文件、显存、耗时、声音、最终尺寸、History 输出、下载与 Cell 写回。

第一轮建议：

```text
3 秒
360P
Fast
声音关闭
固定 Seed
每次只跑 1 条
```

记录：Prompt ID、输入组合、模式、耗时、实际宽高、输出文件、Job 状态和是否写回。

## 2. Agent API 联调

在 UI 与 API 都启动后：

1. `generation.get_capabilities`：确认 ComfyUI Provider/Model 可用。
2. `generation.preview`：确认 Prompt、媒体顺序、Crop/Trim、分辨率、时长、目录和阻塞原因。
3. `generation.run --confirmed`：使用唯一 `idempotencyKey`。
4. `job.list/get` 或 SSE：核对 Job Center。
5. 相同 Key 重试必须复用原任务，不新增付费/计算任务。

## 3. 常见错误

### 无法连接 ComfyUI

检查：

1. ComfyUI 黑色窗口是否仍在运行；
2. 浏览器能否打开 `http://127.0.0.1:8188`；
3. API 设置的 Endpoint；
4. 8188 是否被其他程序占用；
5. 远程机器不能填写 `127.0.0.1`，应使用远程机器局域网 IP。

### 未注册的 ComfyUI 工作流模型

模型名没有匹配 Manifest 的 `id` 或 `aliases`。新字段优先使用：

```text
minimax-h3-local
minimax-h3-Ref-local
```

### 缺失节点

| 缺失类型 | 处理 |
|---|---|
| `MiniMaxH3TurboLoRA` | 安装/更新 ComfyUI-MiniMax-H3-Turbo |
| `H3TurboMixedReferenceFix` | 安装/更新 Hongs-node |
| H3、ResolutionSelector、LoadVideo、LoadAudio、CreateVideo | 升级 ComfyUI Core |

插件目录存在但节点仍缺失时，查看 ComfyUI 启动窗口中的 Import Error；安装或更新后必须重启 ComfyUI。

### `node_errors`

常见原因：

- API JSON 与 Manifest 来自不同版本；
- 节点 ID 已改变；
- Binding 的输入名错误；
- Fast/Quality 模板结构不一致；
- 工作流要求的模型或插件未加载。

回到当前可运行的 ComfyUI 工作流重新导出 API Format，并逐项核对 Manifest。

### `tensor 3 vs 2`

历史上多参考 Fast 的视觉 + 独立音频会出现 Conditioning 分段不一致。当前正式路由应自动插入 `H3TurboMixedReferenceFix`。

先运行协议测试中的混合参考用例；如果提交 Prompt 中没有节点 `280` 或 Guider 没有连接它，说明 Manifest、Client 或模板版本不一致。

### `Fault failed: 2`

在多个包含视频参考的重负载任务连续运行后，错误可能发生在音频 VAE 或模型换入换出阶段，并早于 Hongs-node 修正节点。

处理：

1. 停止继续提交；
2. 保留 Job 与错误信息；
3. 干净关闭并重启 ComfyUI；
4. 用同一素材单条重测；
5. 若单条成功，按显存/连续负载问题记录，不误判为素材或路由不兼容。

### Job 一直等待或处理中

检查 `/queue`、`/history/<prompt_id>`、ComfyUI 控制台和 AI Table Studio Job Center。重启 AI Table Studio 后可恢复已有 ComfyUI Prompt 的查询；关闭 ComfyUI 会中断正在采样的任务。

### 完成但没有结果文件

工作流必须使用能写入 History 的 SaveVideo/SaveImage 节点，并返回 `filename/subfolder/type`。只有 Preview 节点或自定义非标准输出时，Client 无法生成 `/view` 结果地址。

### 输出尺寸与档位不完全相等

清晰度先换算为目标 MP，再由 ResolutionSelector 按 `multiple` 对齐。当前模板使用 `multiple=32`，应以 ffprobe 的实际尺寸为验收结果。

## 4. 回归顺序

修改 Client、Manifest、API JSON 或插件后依次执行：

```bat
npm run test:comfyui
npm run check:comfyui
npm run test:action-api
```

然后只做必要的低成本真实生成。协议测试失败时不要进入真实付费/长耗时测试。

## 5. 记录模板

```text
日期：
工程版本：
ComfyUI 版本：
GPU：
工作流 ID / Alias：
输入组合：
Mode / Steps / Sampler：
清晰度 / 画幅 / multiple：
时长 / Sound / Seed：
Prompt ID：
耗时：
实际输出宽高 / 帧率 / 时长：
Job 状态与 Cell 写回：
结果：
错误原文：
```

