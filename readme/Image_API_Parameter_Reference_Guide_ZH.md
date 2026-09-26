
### 局部修图优先级（v2.7.2b 维护修复）

以下规则**只在开启局部修图模式时生效**，优先于各 Provider 的普通图生图“自动/指定比例”策略：第一张实际原始图片若保存了 `cropData.ratio`，就以裁切框比例为生成请求的 `aspectRatio`；如果没有裁切记录，再读取第一张原图的实际宽高。不能借用第二张图的裁切比例，也不能使用比例下拉框覆盖局部修图原图比例。Qwen 的本地 Client 接收到这一明确比例后，以 `EmptyLatentImage`（节点90）控制采样画布；普通 Qwen 图生图仍沿用“自动跟随首图、明确指定比例覆盖”的规则。

# v2.7.2 当前智能图片路由清单

核对日期：2026-09-25。以下清单对应当前代码；本文后半部分保留 v2.4.8 的协议细节，其中“统一删除 quality”的旧描述已被本节的按模型映射取代。

## 前台与请求链路

第一行：分辨率、比例、生成数量；第二行：生成模式 `auto / high`、画质 `auto / high / max`，均可通过右侧 `+` 引用字段。

`Grid.tsx` 解析字段引用 → `generate-lingwu-image` IPC → `MediaJobRunner.createImageJob` → 上传参考图 → `buildLingwuImageParams` 按准确模型名映射 → `LingwuClient.createTask` → `POST /v1/media/generate`。

请求体为 `{ model, prompt, params, count }`，模型名原样传递。前台每张图独立创建一个 Job，单次 `count: 1`。模式和画质属于 `params`，不是请求体顶层。`standard/enhanced` 及旧中文值仍兼容，UI 显示小写英文。

## Lingwu Format 按模型分配

| 模型 | 尺寸与比例（现有路径） | mode auto / high | quality auto / high / max | 参考图配置 |
| --- | --- | --- | --- | --- |
| `tt-image-2.5` | 沿用 `imageSize + aspectRatio → size` 原有精确/近似换算，不改成新尺寸协议 | `version: flare / sunburst` | `quality` 原值 | 普通 WebP q90 |
| `gemini-3.1-flash-image-preview`（Nano 2） | `imageSize` 0.5K/1K/2K/4K，`aspectRatio` 原值 | `thinkingLevel: minimal / high` | 不发送，API 无独立画质映射 | Gemini JPEG q95，Profile 上限14张 |
| `gemini-3-pro-image-preview` | `imageSize` 1K/2K/4K，`aspectRatio` 原值 | 明确配置时透传 `mode: auto/high` | 明确配置时透传 `quality` | Gemini JPEG q95，Profile 上限14张 |
| `doubao-seedream-5-0-260128` | `size: 2K/3K`，`aspect_ratio`；0.5/1/2K→2K，3/4K→3K | 明确配置时透传 | 明确配置时透传 | 普通 WebP q90 |
| `gpt-image-2`、`gpt-image-2-guan`、其他未登记专属模型 | 旧 `size` 精确/近似换算 | 明确配置时透传 | 明确配置时透传 | 普通 WebP q90 |

未明确配置新参数的旧表：TT 默认 flare/auto，Nano 2 默认 minimal；其他模型保持原请求字段，不额外注入 mode/quality。透传不代表平台承诺支持这些字段，基础测试表用于人工验证渠道实际响应。参考图压缩质量 q90/q95 与生成 quality 是两个独立概念。

TT 的 `-flare/-sunburst` 后缀别名也识别；缺省模式保留显式后缀版本。Nano 2 保留用户指定的 `gemini-3.1-flash-image-preview`，不替换为文档示例别名 `banana-2`。

### 最终请求示例（high 模式、max 画质）

TT：`params = { size: "1024x1024", version: "sunburst", quality: "max" }`。

Nano 2：`params = { imageSize: "1K", aspectRatio: "1:1", thinkingLevel: "high" }`。没有 `quality` 是正确行为；没有 `thinkingLevel` 才是模式未传递。

本次依据用户提供的灵晤接口文档核对上述新字段。TT 比例分辨率按用户要求保留旧逻辑；不在本次新增其同步编辑协议或改写尺寸路径。

## 其他 Provider

| Provider | 当前图片请求与新参数 |
| --- | --- |
| `gemini-custom` | 前台直发 `:generateContent`；Nano 2 模式为 `generationConfig.thinkingConfig.thinkingLevel`，不发送独立 quality；`:predict` 保留既有分支 |
| `openai` | 前台直发既有 `/images/generations`，旧 size/base64Array 路径不变；新增控件映射后加入 payload。平台是否兼容以该渠道为准 |
| `gemini` | 仍不支持本地图片生成分支 |
| `comfyui` | Qwen 图片专属路由，不进入 Lingwu 映射；H3 视频路由保持独立 |

## Qwen 分辨率的准确含义

目前字段中的数字 `1`、`2` 是 **K 系数**，不是 MP 数字：`resolution = 系数 × 1024`。原生节点按目标面积 `resolution²` 对参考图等比缩放，宽高对齐32像素；图生图**未填写比例字段**时 latent 跟随第一张缩放后的参考图，**明确填写比例字段**时会改用 `EmptyLatentImage` 覆盖采样画布。

同一张2048×2048参考图，系数1：参考图和输出均为1024×1024，约1.05MP；系数2：参考图和输出均为2048×2048，约4.19MP。后者像素量四倍，通常需要更多计算/显存，但耗时和画质提升不能按四倍保证。非方图若**未填比例**，仍跟随输入长宽比；若**明确填了比例**，则按该比例重新计算宽高，不保证最长边不超过2048。

画质 auto/high/max → 25/30/40步。模式 high 的16B版本仅预留，目前仍使用同一已安装模型。对照测试保持输入、提示词、画质一致，当前 UI 随机种子不同，适合比较尺寸和运行成本，不能当严格同种子的细节优劣实验。

## 本次核验与手动测试

- 本地模拟请求已覆盖6个已启用云端模型的文生/参考输入，21项ComfyUI与参数回归通过。
- 真实 Electron `MediaJobRunner` → 本机模拟HTTP链路已确认 TT version/quality、Nano 2 thinkingLevel 出现在最终请求体；没有调用真实云端生成。
- “图片模型基础测试 · 2.7.2”15行均通过生成预览，用户手动点击生成。Qwen沿用专项测试表并增加同一2K输入的1/2系数对照。
- 主进程启动时会缓存映射模块，修改后必须保存项目并完整重启 Electron；Vite 热更新仅更新前台。2026-09-25发现运行进程15:54启动，参数映射16:08才更新，这次测试需重启再验证。

---

## v2.4.8 历史协议细节（冲突处以上方 v2.7.2 清单为准）

> **核心逻辑**：图片字段在前端统一提供“分辨率、比例、参考图、生成数量、提示词和模型” → 根据 `provider` 分成不同协议 → 每套协议独立构造请求，不能因为模型名称都叫 Gemini 就混用参数。
>
> **适用版本**：Hong's AI Table Studio v2.4.8  
> **代码依据**：`Grid.tsx`、`media_job_runner.js`、`lingwu_image_model_profiles.js`、`oss_reference_profiles.js`
>
> **本版修正**：补回原有 `Gemini Custom` / Nano Banana 兼容协议的尺寸逻辑，并明确区分 `Gemini Format`、`Gemini Custom` 和 `Lingwu Format`。

---

# Image API 参数映射参考指南

## 一、先分清“模型”和“协议”

同一个 Gemini 模型名称，可以通过不同协议调用。

在当前工程中，图片生成实际分为以下协议：

| Provider | 调用位置 | 图片生成状态 | 请求特点 |
|---|---|---:|---|
| `gemini` | Renderer | 🚫 当前不支持 | 图片分支会直接报错，主要用于文本 |
| `gemini-custom` | Renderer | ✅ 支持 | 直接调用 `:generateContent` 或 `:predict`，参考图使用 Base64 `inlineData` |
| `lingwu` | Electron 主进程 | ✅ 支持 | 调用 `/v1/media/generate`，建立 Job、task_id、轮询和本地下载 |
| `openai` | Renderer | ✅ 部分支持 | 调用 `/images/generations`，参考图依赖非标准 `base64Array` |

必须区分：

```text
Gemini Custom 协议
≠
Lingwu Format 中调用 Gemini 模型
```

虽然两边可能都使用：

```text
gemini-3-pro-image-preview
gemini-3.1-flash-image-preview
```

但请求地址、参考图传法、尺寸默认值、结果解析和任务机制都不同。

---

## 二、前端统一配置

智能图片字段向用户提供的主要配置：

| UI 配置 | Grid 中的变量 | 用途 |
|---|---|---|
| 分辨率 | `resolution` | 一般为 1K / 2K / 4K |
| 画面比例 | `ratio` | 1:1 / 3:4 / 16:9 等 |
| 参考图片 | `imageParts` / `finalOriginalUrls` | 根据协议转 Base64 或上传 OSS |
| 生成数量 | `count` | 不同协议的执行方式不同 |
| 提示词 | `finalPrompt` | 发送给模型 |
| 模型 | `resolvedModel` | 选择 Provider 和模型映射 |

这里的“统一”只代表 UI 一致。

进入生成分支以后：

```text
Gemini Custom
→ 直接构造 Gemini JSON

Lingwu Format
→ 构造 imageSize / aspectRatio / images
→ 再进入模型 Profile 映射器

OpenAI Format
→ 转换成 size / n / response_format
```

---

# 第一部分：Gemini 原生与兼容协议

## 三、Gemini Format

### `provider === "gemini"`

当前图片分支不会发送请求，而是直接抛出错误：

```text
Local Gemini Image generation not natively supported...
Please use OpenAI-compatible proxy for images.
```

因此当前工程中：

| 功能 | 状态 |
|---|---:|
| Gemini 文本 | ✅ 支持 |
| Gemini Format 图片 | 🚫 不支持 |
| 本地参考图 | 🚫 不支持 |
| 1K / 2K / 4K 图片尺寸 | 🚫 不进入请求 |
| 图片比例 | 🚫 不进入请求 |

需要生成 Gemini 图片时，应选择：

```text
Gemini Custom
```

或者：

```text
LingwuAI Format + Gemini 图片模型
```

---

## 四、Gemini Custom 协议

### `provider === "gemini-custom"`

这是工程原来用于 Nano Banana / Gemini-compatible 图片接口的分支。

调用发生在 Renderer 中，不经过：

```text
MediaJobRunner
LingwuClient
OSS Uploader
Network Job Store
task_id 轮询
断点下载
```

### 4.1 Endpoint 组合逻辑

如果填写的是基础地址，例如：

```text
https://generativelanguage.googleapis.com/v1beta
```

代码会自动组合：

```text
https://generativelanguage.googleapis.com/v1beta/models/{模型名}:generateContent
```

如果 Endpoint 已包含下面任意动作，代码不会重复追加：

```text
:predict
:generateContent
:generateImages
```

最后统一追加：

```text
?key={API_KEY}
```

---

## 五、Gemini Custom：`:generateContent` 尺寸逻辑

这是当前 Gemini Custom 最主要的图片请求方式。

### 5.1 请求结构

```json
{
  "contents": [
    {
      "parts": [
        {
          "inlineData": {
            "mimeType": "image/jpeg",
            "data": "..."
          }
        },
        {
          "text": "图片生成提示词"
        }
      ],
      "role": "user"
    }
  ],
  "generationConfig": {
    "responseModalities": ["IMAGE"],
    "imageConfig": {
      "aspectRatio": "3:4",
      "numberOfImages": 1,
      "imageSize": "2K"
    }
  }
}
```

### 5.2 分辨率的真实规则

代码逻辑：

```ts
const geminiImageSize =
  resolution
    ? resolution.toUpperCase()
    : undefined;

const imageConfig = {
  aspectRatio: ratio,
  numberOfImages: 1
};

if (
  geminiImageSize &&
  geminiImageSize !== '1K'
) {
  imageConfig.imageSize =
    geminiImageSize;
}
```

因此实际行为是：

| 前端分辨率 | 实际请求 | 解读 |
|---|---|---|
| 1K / 1k | **不发送 `imageSize`** | 使用 Gemini 接口默认尺寸 |
| 2K / 2k | `imageSize: "2K"` | 明确请求 2K |
| 4K / 4k | `imageSize: "4K"` | 明确请求 4K |
| 空值 | **不发送 `imageSize`** | 使用接口默认尺寸 |
| 其他值，如 3K | `imageSize: "3K"` | 当前代码不校验，可能被服务端拒绝 |

> **重点：** Gemini Custom 的 1K 不是发送 `"1K"`，而是省略 `imageSize`。

### 5.3 比例逻辑

比例直接放入：

```json
{
  "imageConfig": {
    "aspectRatio": "3:4"
  }
}
```

当前代码不会根据模型建立独立比例白名单，也不会自动纠正非法比例。

因此：

```text
前端填什么
→ Gemini Custom 就传什么
```

服务端是否接受，由目标接口决定。

### 5.4 生成数量逻辑

UI 的 `count` 不会直接变成：

```json
{
  "numberOfImages": 4
}
```

当前每次请求固定：

```json
{
  "numberOfImages": 1
}
```

然后根据 `count` 并行发起多个请求：

```text
count = 1
→ 1 个请求

count = 4
→ 4 个并行请求
→ 每个请求生成 1 张
```

这与 Lingwu Format 的多个独立 Job 类似，但 Gemini Custom 不建立本地 Job 记录。

---

## 六、Gemini Custom：参考图逻辑

### 6.1 参考图传输方式

Gemini Custom 不使用 OSS URL。

本地图片会先在前端转换为：

```json
{
  "inlineData": {
    "mimeType": "image/jpeg",
    "data": "Base64 内容"
  }
}
```

然后与提示词一起放入：

```text
contents[0].parts
```

结构：

```json
{
  "contents": [
    {
      "parts": [
        { "inlineData": { "mimeType": "...", "data": "..." } },
        { "inlineData": { "mimeType": "...", "data": "..." } },
        { "text": "提示词" }
      ],
      "role": "user"
    }
  ]
}
```

### 6.2 多参考图

`imageParts` 中有多少张图，就会向 `contents.parts` 中写入多少个 `inlineData`。

当前 Gemini Custom 分支没有在这里执行：

```text
maxReferenceImages: 14
```

这个 14 张限制属于 Lingwu 图片 Profile，不会自动约束 Gemini Custom。

Gemini Custom 能接受多少张参考图，要以所连接的 Gemini-compatible 服务为准。

### 6.3 弱网特点

所有参考图都会变成 Base64，和提示词一起组成一个大 JSON 请求。

因此：

```text
参考图越多
→ 请求体越大
→ 上传时间越长
→ 公司弱网下越容易超时
```

Gemini Custom 当前没有：

- OSS 上传缓存；
- task_id；
- 后台轮询；
- `.part` 下载；
- 软件重启恢复；
- `submission_unknown` Job 记录。

请求失败后是否已经产生计费，需要根据所连接服务商的规则判断。

---

## 七、Gemini Custom：`:predict` 尺寸逻辑

如果 Endpoint 包含：

```text
:predict
```

代码使用另一套请求：

```json
{
  "instances": [
    {
      "prompt": "图片生成提示词"
    }
  ],
  "parameters": {
    "sampleCount": 1,
    "aspectRatio": "3:4"
  }
}
```

### 7.1 参数状态

| 前端配置 | 实际传给 `:predict` | 状态 |
|---|---|---:|
| 提示词 | `instances[0].prompt` | ✅ |
| 比例 | `parameters.aspectRatio` | ✅ |
| 生成数量 | `sampleCount: 1`，并由外层发起多个请求 | ✅ |
| 1K / 2K / 4K | **未发送** | 🚫 |
| `imageSize` | **未发送** | 🚫 |
| 参考图 `imageParts` | **未发送** | 🚫 |

> 当前 `:predict` 分支只使用提示词和比例。即使前端已经收集了参考图，也不会放入这个 payload。

因此当前 `:predict` 更接近：

```text
文生图
```

不适合依赖多张本地产品参考图的工作流。

### 7.2 `:generateImages` 注意

Endpoint 检测会把 `:generateImages` 视为完整地址，不再追加 `:generateContent`。

但当前请求构造只分为：

```text
包含 :predict
→ predict payload

其他
→ generateContent payload
```

因此 `:generateImages` 当前也会收到 `generateContent` 风格的 payload。

如果目标接口对 `:generateImages` 要求不同结构，可能报参数错误。

---

## 八、Gemini Custom 结果解析

### `:predict` 风格结果

如果响应含：

```text
predictions[]
```

程序读取：

```text
bytesBase64Encoded
```

并生成：

```text
data:image/png;base64,...
```

### `:generateContent` 风格结果

如果响应含：

```text
candidates[0].content.parts
```

程序依次处理：

1. `part.inlineData`
   - 转成 Data URL；
2. `part.text`
   - 尝试识别 Markdown 图片链接；
   - 找不到时直接把文本作为结果。

如果两种结构都不存在，则报：

```text
Invalid response from Gemini Custom Image Endpoint
```

---

## 九、Gemini Custom 快速参数表

### `:generateContent`

| UI 配置 | 实际字段 | 状态 | 说明 |
|---|---|---:|---|
| 1K | 不发送 `imageSize` | ✅ | 使用服务端默认尺寸 |
| 2K | `imageSize: "2K"` | ✅ | 明确请求 2K |
| 4K | `imageSize: "4K"` | ✅ | 明确请求 4K |
| 比例 | `aspectRatio` | ✅ | 原样发送 |
| 参考图 | `contents.parts[].inlineData` | ✅ | 支持多张 |
| 数量 | 多个并行请求 | ✅ | 每次 `numberOfImages: 1` |
| OSS | 不使用 | — | 图片直接 Base64 |
| Job Center | 不使用 | — | 不创建后台 Job |

### `:predict`

| UI 配置 | 实际字段 | 状态 | 说明 |
|---|---|---:|---|
| 1K / 2K / 4K | 不发送 | 🚫 | 当前无尺寸字段 |
| 比例 | `parameters.aspectRatio` | ✅ | 原样发送 |
| 参考图 | 不发送 | 🚫 | 当前 payload 只有 prompt |
| 数量 | 多个并行请求 | ✅ | 每次 `sampleCount: 1` |

---

# 第二部分：Lingwu Format 图片协议

## 十、Lingwu Format 总流程

### `provider === "lingwu"`

前端先构造：

```js
{
  imageSize: "2K",
  aspectRatio: "3:4",
  images: [
    "file:///D:/product/front.jpg",
    "file:///D:/product/detail.jpg"
  ]
}
```

然后进入 Electron 主进程：

```text
选择模型 Profile
→ 本地参考图上传 OSS
→ 图片参数映射
→ POST /v1/media/generate
→ 保存 task_id
→ 后台轮询
→ 下载结果
→ 写回原单元格
```

Lingwu Format 的 Gemini 模型和 Gemini Custom 不共用请求构造器。

---

## 十一、Lingwu + Gemini 图片模型

适用模型：

```text
gemini-3-pro-image-preview
gemini-3.1-flash-image-preview
```

### 11.1 参数映射

| UI 配置 | Lingwu API 参数 | 状态 |
|---|---|---:|
| 分辨率 | `imageSize` | ✅ |
| 比例 | `aspectRatio` | ✅ |
| 参考图 | `images`，内容为 OSS URL | ✅ |
| 质量参数 | 删除 `quality` | 🚫 |
| 传统尺寸 | 不生成 `size` | 🚫 |

### 11.2 分辨率规则

| 前端输入 | 实际 `imageSize` |
|---|---|
| 1K / 1k | `"1K"` |
| 2K / 2k | `"2K"` |
| 4K / 4k | `"4K"` |
| 空值 | `"1K"` |
| 无法识别 | `"1K"` |

这与 Gemini Custom 的 1K 行为不同：

```text
Gemini Custom 1K
→ 不发送 imageSize

Lingwu Gemini 1K
→ 明确发送 imageSize: "1K"
```

### 11.3 比例 Profile

```text
1:1
2:3
3:2
3:4
4:3
4:5
5:4
9:16
16:9
21:9
```

当前 Profile 记录了合法比例，但映射器尚未强制拦截非法比例。

### 11.4 参考图上限

Profile 中记录：

```text
maxReferenceImages: 14
```

当前代码尚未在提交前强制截断或弹窗，因此仍应由用户手动控制在 14 张以内。

---

## 十二、Lingwu + 即梦 5

模型：

```text
doubao-seedream-5-0-260128
```

即梦使用：

```text
size
aspect_ratio
```

### 12.1 参数映射

| UI 配置 | 实际字段 |
|---|---|
| `imageSize` | 转换成 `size` |
| `aspectRatio` | 转换成 `aspect_ratio` |
| `quality` | 删除 |
| `images` | 保留 OSS URL |

### 12.2 分辨率映射

| 前端输入 | 实际 `size` |
|---|---|
| 0.5K | `"2K"` |
| 1K | `"2K"` |
| 2K | `"2K"` |
| 3K | `"3K"` |
| 4K | `"3K"` |
| 空值或其他值 | `"2K"` |

因此：

```text
选择 1K
→ 即梦实际收到 2K

选择 4K
→ 即梦实际收到 3K
```

比例会转换字段名后原样发送。

---

## 十三、Lingwu 其他 Legacy 图片模型

未登记专属 Profile 的模型进入：

```text
legacy-lingwu-image-v1
```

逻辑：

```text
imageSize + aspectRatio
→ size: "宽x高"

删除 imageSize
删除 aspectRatio
删除 quality
```

### 13.1 1K 映射

| 比例 | `size` |
|---|---|
| 1:1 | `1024x1024` |
| 2:3 | `1024x1536` |
| 3:2 | `1536x1024` |
| 3:4 | `960x1280` |
| 4:3 | `1280x960` |
| 9:16 | `1088x1920` |
| 16:9 | `1920x1088` |

### 13.2 2K 映射

| 比例 | `size` |
|---|---|
| 1:1 | `2048x2048` |
| 2:3 | `2048x3072` |
| 3:2 | `3072x2048` |
| 3:4 | `1920x2560` |
| 4:3 | `2560x1920` |
| 9:16 | `1440x2560` |
| 16:9 | `2560x1440` |

### 13.3 4K 映射

| 比例 | `size` |
|---|---|
| 1:1 | `2880x2880` |
| 2:3 | `2304x3456` |
| 3:2 | `3456x2304` |
| 3:4 | `2400x3200` |
| 4:3 | `3200x2400` |
| 9:16 | `2160x3840` |
| 16:9 | `3840x2160` |

### 13.4 近似映射

| 配置 | 实际 `size` |
|---|---|
| 1K + 21:9 | `1920x1088` |
| 1K + 4:5 | `960x1280` |
| 1K + 5:4 | `1280x960` |
| 1K + 1:2 | `1024x1536` |
| 1K + 2:1 | `1536x1024` |
| 2K + 21:9 | `2560x1440` |
| 2K + 4:5 | `1920x2560` |
| 2K + 5:4 | `2560x1920` |
| 4K + 21:9 | `3840x2160` |
| 4K + 4:5 | `2400x3200` |
| 4K + 5:4 | `3200x2400` |

如果无法匹配：

- 输入本身是 `1024x1024` 这类像素格式：直接发送；
- 其他无法识别值：发送 `size: "auto"`。

---

## 十四、Lingwu 参考图 OSS Profile

### Gemini JPEG Profile

适用于 Lingwu 下的两个 Gemini 模型：

| 项目 | 规则 |
|---|---|
| Profile ID | `gemini-jpeg-q95-v1` |
| 格式 | JPEG |
| 质量 | 95 |
| 色度采样 | 4:4:4 |
| 尺寸 | 保留原尺寸 |
| Prefix | `references-node-gemini-jpeg-v1/` |
| CSV | `oss_references_gemini_jpeg_node.csv` |
| dHash | 关闭 |

### 普通 WebP Profile

适用于即梦和其他 Legacy 图片模型：

| 项目 | 规则 |
|---|---|
| Profile ID | `legacy-webp-q90-v1` |
| 格式 | WebP |
| 质量 | 90 |
| 尺寸 | 保留原尺寸 |
| Prefix | `references-node/` |
| CSV | `oss_references_node.csv` |
| dHash | 开启 |

这里的 Q95 / Q90 是：

```text
参考图上传 OSS 时的压缩质量
```

不是：

```text
生成图片 API 的 quality 参数
```

---

## 十五、两套 Gemini 图片协议对比

| 项目 | Gemini Custom | Lingwu + Gemini |
|---|---|---|
| Provider | `gemini-custom` | `lingwu` |
| 请求位置 | Renderer | Electron 主进程 |
| Endpoint | `:generateContent` / `:predict` | `/v1/media/generate` |
| 1K | 不发送 `imageSize` | 发送 `"1K"` |
| 2K | 发送 `"2K"` | 发送 `"2K"` |
| 4K | 发送 `"4K"` | 发送 `"4K"` |
| 比例 | `imageConfig.aspectRatio` | `params.aspectRatio` |
| 参考图 | Base64 `inlineData` | OSS URL |
| 参考图上限 | 当前代码未限制 | Profile 写 14，但未强制执行 |
| 数量 | 多个并行 HTTP 请求 | 多个独立 Job |
| task_id | 无 | 有 |
| Job Center | 无 | 有 |
| 重启恢复 | 无 | 有 |
| 断点下载 | 无 | 有 |
| 弱网大图上传 | 一个大 JSON | 先缓存到 OSS |
| 结果 | Data URL / 文本 URL | 远程 URL 后下载本地 |

---

## 十六、一图看懂协议流向

```text
┌────────────────────────────────────────────────────────────────────┐
│                         图片字段 UI                                │
│ resolution  ratio  source images  count  prompt  model            │
└───────────────────────────────┬────────────────────────────────────┘
                                │
                  根据 provider 选择协议
                                │
          ┌─────────────────────┼────────────────────────┐
          ▼                     ▼                        ▼
┌──────────────────┐  ┌────────────────────┐  ┌────────────────────┐
│ Gemini Format    │  │ Gemini Custom      │  │ Lingwu Format      │
├──────────────────┤  ├────────────────────┤  ├────────────────────┤
│ 当前图片不支持    │  │ Renderer fetch     │  │ Electron 主进程     │
│ 直接提示改协议    │  │ Base64 inlineData  │  │ OSS + Job + 轮询     │
└──────────────────┘  └─────────┬──────────┘  └──────────┬─────────┘
                                │                        │
                  ┌─────────────┴──────────┐   ┌─────────┼───────────┐
                  ▼                        ▼   ▼         ▼           ▼
          ┌────────────────┐       ┌──────────┐ ┌──────────┐ ┌────────────┐
          │ generateContent│       │ predict  │ │ Gemini   │ │ 即梦 / 旧模型│
          ├────────────────┤       ├──────────┤ ├──────────┤ ├────────────┤
          │ 1K 不传 size   │       │ 不传尺寸  │ │ imageSize│ │ size       │
          │ 2K/4K 明确传   │       │ 只传比例  │ │ ratio    │ │ 宽x高       │
          │ 支持 inlineData│       │ 不传参考图 │ │ OSS JPEG │ │ OSS WebP   │
          └────────────────┘       └──────────┘ └──────────┘ └────────────┘
```

---

## 十七、常见报错速查

| 报错或现象 | 可能原因 | 处理方式 |
|---|---|---|
| Gemini 图片提示不支持 | Provider 选成普通 `gemini` | 改成 `gemini-custom` 或 `lingwu` |
| 1K 请求里找不到 `imageSize` | 使用 Gemini Custom | 正常，1K 会省略该字段 |
| 2K / 4K 没生效 | 使用了 `:predict` Endpoint | `:predict` 当前不发送分辨率 |
| 多参考图没有进入请求 | 使用了 `:predict` | 改用 `:generateContent` |
| `:generateImages` 参数错误 | 当前发送的是 generateContent 风格 payload | 使用兼容的 `:generateContent`，或单独增加适配器 |
| 请求体过大或超时 | Gemini Custom 把参考图全部转 Base64 | 减少图片、压缩图片，或改用 Lingwu OSS 流程 |
| Gemini 服务端提示非法 `imageSize` | UI 传了 3K 等未校验值 | 使用 1K / 2K / 4K |
| Lingwu Gemini 提示未知字段 `size` | 模型名未命中 Gemini Profile | 检查模型名完全一致 |
| Lingwu 参考图细节变差 | 错误使用普通 WebP Profile | 检查模型 Profile 和 `referenceProfileId` |
| 即梦选择 4K 实际收到 3K | 即梦映射规则 | 当前为正常行为 |
| Legacy 返回 `size: auto` 报错 | 分辨率或比例没有映射 | 使用映射表中的标准组合 |
| 重复付费任务 | 创建超时后立即再次点击 | Lingwu 先查看 `submission_unknown` Job |

---

## 十八、推荐配置

### Gemini Custom：Nano Banana Pro

| 项目 | 推荐值 |
|---|---|
| Provider | `Gemini Custom` |
| Endpoint | Gemini-compatible 的 `/v1beta` 基础地址或完整 `:generateContent` |
| 模型 | `gemini-3-pro-image-preview` |
| 分辨率 | 2K 或 4K |
| 比例 | 3:4 / 1:1 / 16:9 |
| 参考图 | 根据网络情况控制数量和大小 |
| 适合 | 快速直接调用、无需 OSS 的图片生成 |

### Lingwu + Gemini Pro

| 项目 | 推荐值 |
|---|---|
| Provider | `灵悟AI Format` |
| 模型 | `gemini-3-pro-image-preview` |
| 分辨率 | 4K |
| 比例 | 3:4 / 1:1 / 16:9 |
| 参考图 | 建议 3～10 张，手动控制不超过 14 张 |
| 适合 | 需要 Job 恢复、OSS 缓存和本地自动保存 |

### Gemini Custom 与 Lingwu 怎么选

```text
参考图少、网络稳定、希望直接返回 Data URL
→ Gemini Custom

参考图多、公司弱网、希望任务可恢复和自动落盘
→ Lingwu Format
```

---

## 十九、新模型接入原则

### Gemini Custom 新 Endpoint

先确认它属于：

```text
:generateContent
:predict
:generateImages
其他自定义动作
```

不要只因为模型是 Gemini，就默认使用同一 payload。

### Lingwu 新图片模型

在：

```text
LINGWU_IMAGE_MODEL_PROFILES
```

中登记：

- 精确模型名；
- `requestMode`；
- `referenceProfileId`；
- 分辨率枚举；
- 比例枚举；
- 参考图数量上限。

然后在：

```text
buildLingwuImageParams()
```

中添加字段转换和删除规则。

---

## 二十、更新日志

| 文档版本 | 更新内容 | 状态 |
|---|---|---|
| v1.0 | Lingwu Gemini / 即梦 / Legacy 映射 | ✅ |
| v1.1 | 双 OSS 参考图 Profile | ✅ |
| v1.2 | Legacy 像素尺寸表和常见报错 | ✅ |
| v1.3 | 新模型接入流程 | ✅ |
| **v1.4** | **补回 Gemini Custom 1K / 2K / 4K、`:predict` 和 Base64 参考图逻辑** | ✅ |

---

## 二十一、快速结论

```text
普通 Gemini Format
→ 当前不能用于图片生成

Gemini Custom + generateContent
→ 1K：不传 imageSize
→ 2K：imageSize = "2K"
→ 4K：imageSize = "4K"
→ 比例放 imageConfig.aspectRatio
→ 参考图放 contents.parts[].inlineData
→ count 个并行请求，每次 1 张

Gemini Custom + predict
→ 只传 prompt、aspectRatio、sampleCount
→ 不传 1K / 2K / 4K
→ 当前不传参考图

Lingwu + Gemini
→ 明确传 imageSize = 1K / 2K / 4K
→ 明确传 aspectRatio
→ 参考图先转 JPEG Q95 上传 OSS
→ 建立 Job、task_id、轮询和本地下载
```

最需要记住：

1. **Gemini Custom 和 Lingwu Gemini 是两套协议。**
2. **Gemini Custom 的 1K 会省略 `imageSize`；Lingwu Gemini 会明确发送 `"1K"`。**
3. **`:predict` 当前没有分辨率和参考图逻辑。**
4. **只有 Lingwu 分支有 Job Center、弱网恢复、OSS 缓存和断点下载。**
