# AI Table Studio v2.8.3 · Table Action API v0.1 · Phase 4.7

这是从 v2.6.3 分出的 Agent API 探索分支。v2.6.5 / Phase 4.7 在既有协作、完整编辑和长任务能力之上，继续降低 Agent 的调用成本，并补齐“远端已经失联、UI 仍显示处理中”的 Job 专项清理能力。

当前主工程产品版本为 **v2.8.3**，Action Definition 为 **1.9.1**，协议 v0.1 / phase4.7 保持不变。Action 数量与参数以本地 action_definitions.js 和运行时 `system.get_capabilities` 为准。保存工程并重启 Electron 后加载新主进程和 preload。最新版本说明见 [v2.8.3 升级报告](../readme/90_版本记录/v2.8.3_智能裁切约束与安全写回.md)。

TT Image 2.6 可通过 `field.configure_ai` 配置 `complexity`、`outputFormat`、`frameCount`、`frameDurationMs`，四项均支持固定值或 `{字段名}`。生成前调用 `generation.preview`；`generation.get_capabilities` 的 `lingwuImageProfiles` 是模型别名、可用格式及参数能力的当前准确信息。`tt-image-2.6-guan` 不支持 SVG，预检会明确拒绝该组合。

当前 `lingwuImageProfiles` 也登记 `doubao-seedream-5-5-261028`（最多10图、1K/1.5K/2K）与 `minimax-h3-image`（最多16图、standard/highspeed、1K/2K/4K）；两者固定输出 PNG，忽略普通位图格式字段。Qwen 默认工作流登记 `xiaoxue-a`、`mumu-v02`、`youzi-v01`、`mika-v01` 人物 LoRA Profile；通过 `loraProfiles` 固定配置或字段引用，预览会校验 Profile ID 并回显实际选择。

## v2.6.7 列显示与冻结

三个 Action 均为 `write:data`，支持 dryRun、expectedRevision、idempotencyKey 和已有 Undo 链路，不要求 confirmed。设置的是明确状态，重复调用不会反向切换。使用真实 tableId / fieldId。

| Action | params 示例 | 作用 |
| --- | --- | --- |
| field.set_hidden | `{"tableId":"table_x","fieldIds":["field_x"],"hidden":true}` | 批量隐藏；false 恢复显示 |
| field.freeze_to | `{"tableId":"table_x","fieldId":"field_x"}` | 冻结至此列；fieldId=null 取消连续冻结 |
| field.set_individual_frozen | `{"tableId":"table_x","fieldIds":["field_x"],"frozen":true}` | 单独冻结；false 取消指定列单独冻结 |

连续冻结与单独冻结互不清空。布局沿用 UI 的表级存储：fields[].hidden、data.frozenColId、data.individualFrozenColIds。隐藏冻结端点的行为与 UI 一致：端点不在可见列中时连续冻结暂不生效，重新显示端点后恢复。不修改字段顺序、Cell 数据或智能引用。

读回：`table.get_schema` 返回字段的 hidden 与新增 `columnLayout: { frozenColId, individualFrozenColIds }`。参数精确格式可用 `node scripts/table_action_client.mjs field.freeze_to --help` 查看，复杂参数推荐 `--params-file` 或 `--stdin`。

## 已实现

```text
Phase 1
system.get_capabilities
context.get_current
table.list
table.get_schema
table.create
field.create
field.update
field.reorder
row.query
row.get
row.create
cell.set
cell.batch_set

Phase 2
media.get
media.attach
media.copy_instance
media.list_by_row
media.get_effective_context

Phase 3
generation.preview
generation.run
job.list
job.get
job.retry
job.cancel

Phase 3.5
table.activate
view.get
view.update
field.duplicate
field.options.get / upsert / update / remove / reorder
field.configure_ai
cell.get_meta / link / unlink
generation.get_capabilities
context.get_current + activeCell / selection
row.query + current_view / OR / sort / rowIds / includeComputed
generation.preview resolved validation

Phase 4
workspaceRevision / expectedRevision
transaction.preview / transaction.execute
undo.get_status / undo.apply / redo.apply
workspace.get_dirty_state / workspace.save
all-mutation idempotencyKey
AJV HTTP schema validation / permission / token expiry / actor / audit

Phase 4.1
table.update / duplicate / delete / reorder
field.delete / field.convert.preview / field.convert.run
row.insert / duplicate / delete / reorder
cell.clear / copy_range / fill
media.remove / move / reorder / set_crop / clear_crop / set_trim / clear_trim / set_rating
job.get_result / bind_result / delete_history

Phase 4.5
SSE: workspace.changed / job.updated / generation.completed / batch.completed
batch.list / get / cancel / retry_failed / list_results
export.preview / attachments / csv / json

Phase 4.6
system.describe_action
统一 Action Definition → HTTP Schema / CLI Help / 本地校验 / 未来 MCP Tool Schema
CLI: --help / --params-file / --request-file / --stdin / --validate-only / --print-request
ComfyUI：已配置引用但当前 Cell 为空时跳过空引用；不擅自切换用户选择的 Workflow

Phase 4.7
system.get_capabilities: detail=summary|full
job.list: detail=summary|full / fields 精确投影
job.cleanup_stale.preview / job.cleanup_stale
CLI: Windows 旧式 --params 容错 / --select 响应裁剪
```

## Phase 4.7 高频调用与失联 Job 清理

- `system.get_capabilities` 默认返回紧凑 Action 名称列表；需要完整元数据时显式传 `{"detail":"full"}`。
- `job.list` 默认返回日常状态所需的摘要字段，也可用 `fields` 精确投影，只有排障时才使用 `detail=full`。
- `job.cleanup_stale.preview` 只做核验，不写 Workspace；`job.cleanup_stale` 必须 `confirmed=true`，并在执行瞬间重新核验。
- 自动清理只适用于超过阈值、具有 `taskId`、且该 `taskId` 同时不在 ComfyUI Queue 与 History 中的非终态 Job。
- 成功、失败、取消、已有结果、本地时间太新、真正排队/运行、远端不可达或状态无法证明的 Job 一律保留。
- 清理只删除对应 Job 历史和精确匹配 `jobId` 的 Cell `networkJob` 占位，不删除任何结果文件，也不等同于普通 `job.delete_history`。

推荐顺序：

```bat
node scripts/table_action_client.mjs job.cleanup_stale.preview --token=test-123456 --params="{\"tableId\":\"table_xxx\",\"staleAfterMinutes\":30}"
node scripts/table_action_client.mjs job.cleanup_stale --token=test-123456 --confirmed --params="{\"tableId\":\"table_xxx\",\"staleAfterMinutes\":30}"
```

## Phase 4.6–4.7 Action Definition 与 CLI

- `agent_api/action_definitions.js` 是静态 Action 规则的唯一来源：Action 名称、权限、确认策略、Runtime 属性、参数 Schema、说明和示例都从这里生成。
- `agent_api/table_action_api_v0.1.schema.json` 是通过 `npm run generate:action-schema` 生成的对外兼容产物；不要直接手改。
- HTTP Server、CLI 本地校验、`system.describe_action` 和未来 MCP Server 共用同一 Definition，避免规则漂移。
- `node scripts/table_action_client.mjs <action> --help` 不需要 Token，也不需要启动 Electron。
- `--params-file` 读取纯 `params` JSON，`--request-file` 读取完整请求，`--stdin` 从标准输入读取 `params`。
- `--validate-only` 只做本地 Schema 校验；`--print-request` 会隐藏 Token、Secret、Credential 与 API Key 字段。

Windows 复杂调用统一使用 --params-file 或 --stdin，避免 CMD / PowerShell / JSON 多层转义。参数文件使用 UTF-8 编码；包含中文、空格、Emoji、路径、长提示词或嵌套数组时，不使用旧式内联 --params：

```bat
node scripts/table_action_client.mjs cell.batch_set --token=test-123456 --confirmed --params-file=cell-batch-set.json
```

通过 PowerShell 的标准输入传参（显式指定 UTF-8，兼容 Windows PowerShell 的管道编码）：

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content -LiteralPath .\cell-batch-set.json -Raw -Encoding UTF8 |
  node scripts/table_action_client.mjs cell.batch_set --stdin --confirmed --token=test-123456
```

可先添加 --validate-only 做本地参数校验，不提交操作。--stdin、--params-file、--params、--request-file 四种输入来源互斥。
查询精确 Action 定义：

```bat
node scripts/table_action_client.mjs field.configure_ai --help
node scripts/table_action_client.mjs system.describe_action --token=test-123456 --params="{\"action\":\"field.configure_ai\"}"
```

旧式 `--params="{...}"` 继续支持。Phase 4.7 会安全尝试严格 JSON、JSON5 与常见 Windows `\"`/边界反斜杠损坏的恢复，但绝不执行输入中的 JavaScript。这只是尽力兼容：包含中文、空格和 Emoji 等复杂内容时仍可能因 Windows Shell 转义失败；标准调用应使用 `--params-file` 或 `--stdin`。

只读取响应的一部分可使用：

```bat
node scripts/table_action_client.mjs job.list --token=test-123456 --select=data.jobs --params="{\"tableId\":\"table_xxx\",\"fields\":[\"localJobId\",\"phase\",\"updatedAt\"]}"
```

## 空媒体引用与 Workflow 边界

- AI 字段已经配置图片/视频/音频引用，但当前行对应 Cell 为空时，该空引用产生 `MEDIA_REFERENCE_EMPTY_SKIPPED` Warning，不会单独阻断生成。
- Preview 的实际媒体数量只统计非空实例；所选 Workflow 是否接受该数量，仍由 Workflow Manifest Capability 决定。
- API 不根据有效素材数量自动替换 Model 或跨 Workflow 路由。用户在 UI 中选择的 Workflow 始终是权威选择。
- 例如 `minimax-h3-local` 对应的 Workflow 支持 0 张图片时，可以在保留 `{AI首帧图}` 配置、当前行首帧为空的情况下继续文生视频。
- 如果用户选择的 Workflow 声明 `minTotalReferences: 1`，0 参考仍返回 `WORKFLOW_INPUT_UNSUPPORTED`，不会静默切到其他 Workflow。


### Phase 1 补充：field.reorder

真实 Agent 测试中发现“调整列位置”缺少独立 Action，因此在 exp2 中补充：

```json
{
  "version": "0.1",
  "action": "field.reorder",
  "confirmed": true,
  "params": {
    "tableId": "table_xxx",
    "fieldId": "field_prompt",
    "beforeFieldId": "field_ai_image"
  }
}
```

三种定位方式任选其一：

```text
beforeFieldId  移到指定字段前
afterFieldId   移到指定字段后
toIndex        移到指定 0-based 列序号
```

该 Action 只改变 `fields[]` 顺序，不改 Field ID、记录值、引用配置或媒体数据，并继续进入现有 Undo。

## Phase 3.5 高频交互能力

- `context.get_current` 在真实 Electron Runtime 中返回当前活动 Cell、矩形/追加选择区、选中行与字段。
- `table.activate` 会等待目标 Grid Runtime 真正挂载后再 ACK，随后可直接调用生成。
- `view.get / view.update` 使用统一语义 Filter / Sort / Group，不要求 Agent 写内部 `viewStates` JSON。
- `row.query` 新增 `scope=current_view`、`logic=or`、`sort`、`rowIds` 和 `includeComputed`；`current_view` 会遵循当前筛选、排序、分组与折叠可见状态。
- `field.duplicate` 可安全复制字段配置，并可选择复制 Cell 值与 Cell Link。
- `field.options.*` 管理单选/多选 Option；删除仍被引用的 Option 时默认阻止，需显式 `clearValues=true`。
- `field.configure_ai` 成为 AI Text / AI Image / AI Video 的安全配置入口；`field.update` 不再允许直接 patch `aiTextConfig / aiImageConfig / aiVideoConfig`。图片字段的 `loraProfiles` 支持已登记 Profile ID 或 `{字段名}`，引用值可用逗号、分号或换行提供多个 ID。
- `cell.get_meta / cell.link / cell.unlink` 让 Agent 能在写入前识别并管理 Cell Link。
- `generation.get_capabilities` 只返回已配置 Provider / Model 的非敏感信息，不返回 Key；ComfyUI workflow 还返回 `modelRequirements / loraProfiles / aliasLoraProfiles / promptDefaults / promptPolicy`。`promptDefaults` 从实际工作流模板绑定节点自动提取；每个 LoRA Profile 的 `promptPolicy` 标明无自动词、前置触发词/默认词或后置词。
- `generation.preview` 返回最终模型、Provider、凭据可用性、Prompt、媒体 Crop/Trim、视频参数、实际 LoRA Profile、输出文件名/目录、费用可能性与阻塞原因。Profile 未登记或与所选 workflow 不匹配时返回 `WORKFLOW_LORA_PROFILE_UNSUPPORTED`；分辨率不符合 Manifest 能力时返回 `WORKFLOW_RESOLUTION_UNSUPPORTED`。

Qwen v2.7.7 示例：默认图片工作流启用保真层时，使用 `field.configure_ai` 写入 `model=qwen-image-2.1-local` 与 `loraProfiles=["consistency"]`；双图换脸使用 `model=qwen-image-2.1-face-local`，且必须提供恰好两张有效图片。两者共用 `0.5K / 1K / 1.5K / 2K` 分辨率范围。不要把本地 LoRA 文件名直接作为 Profile 传入。

## Phase 2 设计边界

- `media.get` 返回真实媒体实例，并保留图片 `cropData` 与音视频 `trimData`。
- `media.attach` 只负责附加新的本地路径 / URL，不允许外部 Agent 直接注入 `cropData / trimData`。
- 已经编辑过的媒体通过 `media.copy_instance` 复制，完整保留当前实例元数据。
- `media.list_by_row` 用于让 Agent 理解某一行有哪些图片 / 视频 / 音频。
- `media.get_effective_context` 按现有智能字段模板解析当前行真正会使用的媒体，并返回 `<Picture n> / <Video n> / <Audio n>` 顺序。
- 普通文本可以通过 `temporaryReferenceFieldId` 查询某个智能节点的临时媒体上下文，但不会写入 Field Config。
- 预览态字段 `mappedUrl / refUrls / refCells` 不通过 API 持久化或复制。

## 智能裁切 Runtime

- `media.list_crop_presets`：读取 UI 与 Agent 共用的裁切预设。
- `media.smart_crop_preview`：本地识别人像并返回 `ready / skipped / failed` 明细，不修改表格；`ready[]` 返回实际比例、像素/归一化裁切框、原图尺寸与 `wouldOverwrite`。可用 `framing/protection.startOffset/endOffset` 按肩胯长度临时微调锚点。
- `framing` 是期望景别（软约束），`protection` 是最低必保范围（硬约束）。只改 `framing` 不会清除预设原有的 `protection`；Preview / Apply 的 `constraintContract` 会回显合并后的范围与潜在冲突。
- 腰上到脚踝的普通下装构图使用 `framing: above_waist→ankle`、`protection: hip→ankle`；若腰上也必须始终保留，则把 `protection.start` 同步设为 `above_waist`。
- 坐姿、蜷腿或横卧图片若使终点沿肩胯身体轴投影到起点之前，会进入 `failed[]`，错误码为 `ANCHOR_ORDER_CONFLICT`。该项保持原裁切，不允许 Agent 通过互换 start/end 绕过人体语义。
- `media.smart_crop_apply`：按基础预设与本次 `overrides` 批量写入现有 `cropData`，需要 `confirmed=true`，整批返回一个 Undo token；成功项会更新已有裁切，无法解析和求解失败项保留原值。
- 明确目标全部无效时返回 `NO_VALID_TARGETS`；错误目标分别进入 `skipped[]`。未知预设、参数不适用和非法覆盖分别使用 `INVALID_PRESET / PARAM_NOT_APPLICABLE / INVALID_CROP_OVERRIDE`，不可重试。
- 智能裁切 Runtime 的 Bridge 等待上限为 60 秒；`RENDERER_TIMEOUT` 与 `RENDERER_UNAVAILABLE` 分开返回。写请求超时后如需重试，必须复用原 `idempotencyKey`。
- 参数可使用精确 `targets[{rowId,fieldId,index?}]`，或 `rowIds + fieldIds` 的笛卡尔范围。
- Agent 选择 `presetId`，必要时追加仅本次有效的 `overrides`；人物关键点、像素坐标和内部裁切结构仍由 Grid Runtime 计算。
- 图片不上传，模型优先从工程内置资源加载；缺失时自动下载并校验固定 SHA-256。

完整说明见 `readme/智能裁切与Agent批量裁切.md`。

## Phase 4 协作规则

- 所有读取响应携带 `workspaceRevision`；写请求可携带 `expectedRevision`，过期时返回 `STALE_WORKSPACE`。
- `transaction.execute` 只允许纯数据 Mutation，任一步失败则整个事务不提交。
- 所有 Mutation 可携带 `idempotencyKey`；同 Key 重试复用原响应。
- 删除、转换、范围覆盖、媒体编辑、Job 历史删除等破坏性操作必须 `confirmed=true`，成功后返回可执行 `undoToken`（Job 历史等外部资源除外）。
- Crop 只接受 0–1 比例矩形；Trim 只接受 `0 <= startMs < endMs <= durationMs`，不接受任意内部 JSON。
- `workspace.save` 只写当前已经绑定且已有权限的工程文件，不弹出路径选择器。
- HTTP 入口先经过 JSON Schema、权限和 Token 有效期校验，再进入 Renderer 串行队列。
- Audit Log 不记录 Token、API Key 或 Provider 凭据。
- 不开放 OSS 清理、API Key、Provider 密钥修改。
- 不开放任意 JS / Shell。

## Local HTTP Bridge

默认关闭。开启：

```bat
set "HONGS_TABLE_ACTION_API=1" && set "HONGS_TABLE_ACTION_TOKEN=my-local-token" && npm run dev
```

默认接口：

```text
POST http://127.0.0.1:17321/v0.1/actions
GET  http://127.0.0.1:17321/v0.1/events
GET  http://127.0.0.1:17321/health
```

可选安全配置：

```bat
set HONGS_TABLE_ACTION_PERMISSIONS=read,write:data,write:schema,write:media,execute:generation,filesystem:export,workspace:save,destructive
set HONGS_TABLE_ACTION_TOKEN_TTL_SECONDS=28800
set HONGS_TABLE_ACTION_ACTOR_ID=codex-local
set HONGS_TABLE_ACTION_ACTOR_NAME=Codex
```

订阅事件：

```bat
node scripts/table_action_events.mjs --token=my-local-token
```

## Phase 2 示例

读取视频实例：

```bat
node scripts/table_action_client.mjs media.get --token=my-local-token --params="{\"tableId\":\"table_xxx\",\"rowId\":\"row_xxx\",\"fieldId\":\"field_video_ref\"}"
```

复制一个已经设置 A/B 的视频实例：

```json
{
  "version": "0.1",
  "action": "media.copy_instance",
  "params": {
    "tableId": "table_xxx",
    "source": { "rowId": "row_1", "fieldId": "field_ref", "index": 0 },
    "target": { "rowId": "row_2", "fieldId": "field_ref" },
    "mode": "append"
  }
}
```

读取 AI Video 当前行实际参考上下文：

```json
{
  "version": "0.1",
  "action": "media.get_effective_context",
  "params": {
    "tableId": "table_xxx",
    "rowId": "row_xxx",
    "fieldId": "field_ai_video"
  }
}
```

## 后续

```text
Phase 1  Table / Field / Row / Cell        ✓
Phase 2  MediaInstance / cropData / trimData ✓
Phase 3  Generation / Job Center              ✓
Phase 3.5 Interactive Coverage                 ✓
Phase 4  Transaction / Revision / Undo / Save    ✓
Phase 4.1 Full Editing                            ✓
Phase 4.5 Events / Batch / Export                ✓
Phase 4.6 Action Definition / CLI / Empty Ref      ✓
Phase 4.7 Compact Discovery / Stale Job Cleanup      ✓
Phase 5  Local MCP Server → Codex
```
