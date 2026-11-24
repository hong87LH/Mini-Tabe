# 智能裁切与 Agent 批量裁切

最后更新：2026-11-23
适用版本：AI Table Studio v2.8.2

## 能力概览

智能裁切把原独立裁切工作台的本地姿态识别与确定性裁切求解器内置到表格工程中。右键菜单和 Agent Action 共用同一份预设，不要求 Agent 自行估算坐标。

这里的“内置”指完整功能随 AI Table Studio 工程和安装包一起运行：不打开、不调用原来的 HTML 工作台，也不依赖原 `dwpose_crop_tool` 目录、浏览器驱动或额外裁切服务。原 HTML 只作为算法与交互参考；实际运行代码、模型、WASM、预设、缓存和结果回写都位于当前表格工程内。

- 支持图片/AI 图片列的单元格、框选区域和多选单元格；
- 一个单元格有多张图片时默认逐张处理；
- 成功项写入现有 `cropData`，原裁切预览、局部修图和生成引用继续复用原流程；
- 缺少人物或目标身体部位时跳过该图片，不覆盖原数据；
- UI 批量写入通过一次批量更新完成；Agent 写入返回一个 Undo token；
- 图片、模型推理与裁切求解均在本机完成，不上传图片。
- 本地图片的姿态结果与人物轮廓结果分别按路径、文件大小与修改时间缓存到 IndexedDB；切换预设时同时复用两类识别结果，不重复跑模型。

## 使用方法

### 表格右键

1. 在图片附件列选择一个单元格、连续区域或多个单元格。
2. 右键打开菜单，悬停“智能裁切”进入二级菜单并选择预设。
3. 右下角会持续显示识别、计算与写入进度；失败时显示具体原因，失败项保留原裁切。
4. 双击/预览图片可继续用既有裁切界面人工微调。

当前内置预设：

- `face_swap_1_1`：换脸 · 紧凑头肩 (1:1)
- `portrait_long_hair_3_4`：长发/胸像 · 头部到胸口 (3:4)
- `upper_body_3_4`：上衣修复 · 头部到胯 (3:4)
- `garment_only_3_4`：上衣主体 · 肩部到胯 (3:4)
- `pants_3_4`：裤子/下装 · 腰上到脚踝 (3:4)
- `shorts_skirt_3_4`：短裤/半裙 · 腰上到膝上（近似比例）

### Agent Action

先查询预设：

```json
{
  "version": "0.1",
  "action": "media.list_crop_presets",
  "params": {}
}
```

预览，不写表：

```json
{
  "version": "0.1",
  "action": "media.smart_crop_preview",
  "params": {
    "tableId": "table_xxx",
    "presetId": "upper_body_3_4",
    "targets": [
      { "rowId": "row_1", "fieldId": "field_images" },
      { "rowId": "row_2", "fieldId": "field_images", "index": 0 }
    ]
  }
}
```

确认后批量写入：

```json
{
  "version": "0.1",
  "action": "media.smart_crop_apply",
  "confirmed": true,
  "idempotencyKey": "crop-upper-body-batch-001",
  "params": {
    "tableId": "table_xxx",
    "presetId": "upper_body_3_4",
    "rowIds": ["row_1", "row_2"],
    "fieldIds": ["field_images"]
  }
}
```

`targets` 不写 `index` 时处理该 Cell 的全部可识别图片；写 `index` 时只处理对应媒体实例。Agent 应始终先读取预设，不应自行生成内部 `cropData`。

### Agent 临时参数

`media.smart_crop_preview` 和 `media.smart_crop_apply` 支持可选的 `overrides`。它会先读取 `presetId` 对应的共享预设，再合并本次参数；不会修改 `public/smart_crop/presets.json`，右键菜单也不会受到影响。建议始终先 preview，再以完全相同的参数 confirmed apply：

```json
{
  "version": "0.1",
  "action": "media.smart_crop_preview",
  "params": {
    "tableId": "table_xxx",
    "presetId": "face_swap_1_1",
    "overrides": {
      "aspect": "3:4",
      "headshot": {
        "topMargin": 0.18,
        "minTopMargin": 0.06,
        "sideMargin": 0.12,
        "shoulderDepth": 0.6
      }
    },
    "targets": [
      { "rowId": "row_1", "fieldId": "field_images", "index": 0 }
    ]
  }
}
```

紧凑头像只接受 `aspect` 与 `headshot`；通用人体预设接受 `aspect`、`aspectMode`、`aspectCandidates`、`framing`、`protection` 与 `spacing`。Action Schema 会拒绝 `strategy`、模型地址、内部 `cropData`、超范围数字和未知字段。成功应用后，本次覆盖值会记录在 `cropData.smartCrop.overrides` 中，便于审计和复现。

通用人体预设还支持临时切换到近似比例。`aspect` 是首选比例，`aspectCandidates` 是本次允许求解器比较的常用比例集合：

```json
{
  "version": "0.1",
  "action": "media.smart_crop_preview",
  "params": {
    "tableId": "table_xxx",
    "presetId": "shorts_skirt_3_4",
    "overrides": {
      "aspect": "3:4",
      "aspectMode": "approximate",
      "aspectCandidates": ["1:1", "3:4", "4:3", "9:16", "16:9"],
      "framing": { "start": "above_waist", "end": "knee" },
      "protection": { "start": "hip", "end": "above_knee", "hands": "none" }
    },
    "targets": [
      { "rowId": "row_1", "fieldId": "field_images", "index": 0 }
    ]
  }
}
```

- `fixed`：严格保持 `aspect`，适合规格必须统一的头像、商品图和输出模板；
- `approximate`：逐张尝试候选比例，先比较必保区域是否完整、是否越界，再比较目标轮廓形状与首选比例的接近程度；同一批图片可以得到不同的最终比例；
- 紧凑头像仍只允许 `fixed`，避免自动换比例破坏换脸素材的一致性；
- preview 的 `ready[].effectiveAspect` 与 apply 的 `appliedItems[].effectiveAspect` 会返回每张图实际采用的比例。

## 维护入口

日常新增或调整快捷裁切只维护：

```text
public/smart_crop/presets.json
```

预设 `id` 一经用于自动化任务后应保持稳定；可修改标签和说明，但不要静默改变同一 ID 的身体范围含义。

紧凑头像使用 `strategy: "tight_headshot"`，常用参数都在同一预设的 `headshot` 中：

- `topMargin`：头顶留白相对头部高度，越小越紧；
- `minTopMargin`：原图画幅不足时仍必须保留的顶部安全线，相对最终裁切高度计算；
- `sideMargin`：左右留白相对头部宽度，越小越紧；
- `shoulderDepth`：肩线以下保留深度，越小保留的胸肩越少。

头像策略把完整头发、面部和 `minTopMargin` 作为硬约束；`topMargin` 是理想构图目标，肩部是可以缩减的软语境。画幅受限时，求解器先在理想顶部留白与最低安全线之间回收少量空间给肩部，不会拿头发像素换身体。普通服装与下装预设继续使用 `framing`、`protection`、`spacing` 三组人体规则，并可配置 `aspectMode` 与 `aspectCandidates`。

普通服装裁切采用“骨骼定纵向、语义轮廓定横向”的组合：腰、胯、膝等关键点确定需要保留的身体高度区间；该区间内的 `clothes` 语义行区间直接决定服装最左和最右边界，不再被肩宽、胯宽等骨骼走廊横向截断。因此宽摆短裙、蓬松上衣等超出骨架宽度的布料会进入硬保护区。轮廓缺失时才退回原人物轮廓与骨骼规则。

头像分级保底顺序：

1. `PoseLandmarker` 负责鼻、眼、耳、颈部、肩、胯、膝和脚踝等人体关键点，不再启用其内置分割回调；
2. 独立 `ImageSegmenter` 通过 `outputCategoryMask: true` 生成头发、脸、皮肤、服装和背景分类；合并阶段同时保留完整人物 `person_row_spans`、头脸 `person_head_row_spans` 和按 `hair / face / body_skin / clothes / accessories` 分类的 `person_part_row_spans`；
3. 头像策略以头发分类的最高、最左、最右像素为硬边界，以面部、颈部和肩点决定构图锚点与软语境，衣服和手臂不再扩大头部包围盒；
4. 理想框超出原图时保持 1:1 或 3:4 比例，先缩减身体语境，再在 `topMargin` 与 `minTopMargin` 之间自适应；若分割失败则自动退回关键点方案，不阻塞整批裁切。

姿态和轮廓在两个独立 Worker 中运行，避免 PoseLandmarker 的分割蒙版回调与姿态推理互相阻塞。轮廓模型默认使用 multiclass 256×256；binary 模型仅作为兼容回退与独立冒烟测试选项。

核心代码：

```text
src/lib/smartCrop.ts                         预设加载、识别、求解、cropData 适配
src/components/Grid.tsx                     选择区、右键菜单、Grid Runtime
src/App.tsx                                 Agent Runtime 提交、Revision 与 Undo
agent_api/action_definitions.js             Action Schema 单一事实源
public/smart_crop/engine/                    裁切工作台确定性求解器
public/smart_crop/recognition-worker.js      PoseLandmarker 姿态 Worker
public/smart_crop/segmentation-worker.js     ImageSegmenter 轮廓 Worker
public/smart_crop/segmentation-model-cache.js 轮廓模型云端清单与 HTTP Cache 加载
public/smart_crop/vendor/                    轻量 Vision Bundle 与兼容加载器
tests/smart_crop_segmentation_smoke.cjs      Electron 双模型真人图冒烟测试
```

## 模型与离线策略

双模型均从云端加载，并交给 Electron/Chromium 普通 HTTP Cache：

`MediaPipe Pose Landmarker Full`：

- 大小：9,398,198 字节
- SHA-256：`4EAA5EB7A98365221087693FCC286334CF0858E2EB6E15B506AA4A7ECDCEC4AD`
- 下载顺序：国内 HF-Mirror → Google 官方 → Hugging Face
- 所有下载结果必须通过大小与 SHA-256 校验后才会使用。

`MediaPipe Selfie Multiclass 256×256`：

- 作为生产轮廓模型，输出 category mask；
- 背景为 `0`，人物、头发、脸、服装等为非 `0` 类别；
- 仅做合理文件大小校验，默认从 Google MediaPipe 模型仓库下载；
- `MediaPipe Selfie Segmenter Float16` 是 binary 回退模型，不参与默认生产路径。

姿态模型、轮廓模型与 MediaPipe WASM 均为纯云端加载；不再读取 Cache Storage 或工程内置模型。支持 SIMD 的设备只下载高速 WASM，不支持时下载 No-SIMD 版。首次使用必须联网，清除应用 HTTP 缓存后会重新下载。

WASM 云端路径：

```text
https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm
```

云端加载验证通过后，工程内以下两个大文件不再参与运行，可以从工程和安装包中删除：

```text
public/smart_crop/vendor/wasm/vision_wasm_internal.wasm
public/smart_crop/vendor/wasm/vision_wasm_nosimd_internal.wasm
```

工程内以下姿态模型也不再参与运行，可以删除：

```text
public/smart_crop/vendor/pose_landmarker_full.task
```

两个约 0.2MB 的同名 `.js` 加载器目前也不再参与默认运行，但体积很小，暂时保留便于诊断和回退。

## 数据与兼容性

求解器输出原图像素坐标，适配层写入既有 `cropData`，并附加：

```json
{
  "sourceBox": { "left": 0, "top": 0, "right": 100, "bottom": 100, "unit": "px" },
  "smartCrop": {
    "presetId": "shorts_skirt_3_4",
    "engineVersion": "manual-crop/v1+mediapipe-dual",
    "aspectMode": "approximate",
    "effectiveAspect": "1:1",
    "warnings": []
  }
}
```

旧表格无需迁移。原 `media.set_crop` 的 0–1 比例矩形仍能在裁切预览和生成引用中使用；新智能裁切写入完整的现有裁切结构。

当前首版不自动扩图，所有预设 `allow_virtual=false`。理想画幅越界时会保持目标比例收回原图范围；不会生成透明边缘或把空白区域带入后续生成链路。

## 验证命令

```text
npm run lint
npm run test:ui-workflows
npm run test:action-api
npm run build
npx electron tests/smart_crop_segmentation_smoke.cjs "<真人图片路径>"
npx electron tests/smart_crop_headshot_smoke.cjs "<真人图片路径>"
```

双模型冒烟测试成功标志为 `SMART_CROP_DUAL_SMOKE_OK`，头像求解冒烟测试成功标志为 `SMART_CROP_HEADSHOT_OK`。前者应同时检查 `poseMs`、`segMs`，以及 `histogram` 是否同时包含背景 `0` 和人物类别非 `0`；后者会输出实际 `crop`、语义头部边界和预览 PNG 路径。如 multiclass 分割在当前 Electron 环境超时，可用第三个参数 `binary` 单独验证 binary 回退路径。
