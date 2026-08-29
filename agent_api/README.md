# AI Table Studio v2.6.5 · Table Action API v0.1 · Phase 4.7

这是从 v2.6.3 分出的 Agent API 探索分支。v2.6.5 / Phase 4.7 在既有协作、完整编辑和长任务能力之上，继续降低 Agent 的调用成本，并补齐“远端已经失联、UI 仍显示处理中”的 Job 专项清理能力。

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

Windows 复杂参数仍推荐使用参数文件，避免 CMD / PowerShell / JSON 多层转义：

```bat
node scripts/table_action_client.mjs cell.batch_set --token=test-123456 --confirmed --params-file=cell-batch-set.json
```

查询精确 Action 定义：

```bat
node scripts/table_action_client.mjs field.configure_ai --help
node scripts/table_action_client.mjs system.describe_action --token=test-123456 --params="{\"action\":\"field.configure_ai\"}"
```

旧式 `--params="{...}"` 继续支持。Phase 4.7 会安全尝试严格 JSON、JSON5 与常见 Windows `\"`/边界反斜杠损坏的恢复，但绝不执行输入中的 JavaScript。若内容包含长提示词、中文路径或多层数组，仍优先使用 `--params-file` 或 `--stdin`。

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
- `field.configure_ai` 成为 AI Text / AI Image / AI Video 的安全配置入口；`field.update` 不再允许直接 patch `aiTextConfig / aiImageConfig / aiVideoConfig`。
- `cell.get_meta / cell.link / cell.unlink` 让 Agent 能在写入前识别并管理 Cell Link。
- `generation.get_capabilities` 只返回已配置 Provider / Model 的非敏感信息，不返回 Key。
- `generation.preview` 返回最终模型、Provider、凭据可用性、Prompt、媒体 Crop/Trim、视频参数、输出文件名/目录、费用可能性与阻塞原因。

## Phase 2 设计边界

- `media.get` 返回真实媒体实例，并保留图片 `cropData` 与音视频 `trimData`。
- `media.attach` 只负责附加新的本地路径 / URL，不允许外部 Agent 直接注入 `cropData / trimData`。
- 已经编辑过的媒体通过 `media.copy_instance` 复制，完整保留当前实例元数据。
- `media.list_by_row` 用于让 Agent 理解某一行有哪些图片 / 视频 / 音频。
- `media.get_effective_context` 按现有智能字段模板解析当前行真正会使用的媒体，并返回 `<Picture n> / <Video n> / <Audio n>` 顺序。
- 普通文本可以通过 `temporaryReferenceFieldId` 查询某个智能节点的临时媒体上下文，但不会写入 Field Config。
- 预览态字段 `mappedUrl / refUrls / refCells` 不通过 API 持久化或复制。

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
