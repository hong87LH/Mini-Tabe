# Table Action API v0.1 · Phase 3 实施说明

> 探索分支：`v2.6.3-agent-api-exp3`

## 目标

让外部 Agent 在不绕过现有业务链路的前提下完成：

```text
row.query
→ generation.preview
→ generation.run
→ Job Center
→ job.list / job.get
→ job.retry / job.cancel
```

## 新增 Action

```text
generation.preview
generation.run
job.list
job.get
job.retry
job.cancel
```

`system.get_capabilities` 与 `/health` 当前均返回：

```text
phase3
```

## generation.preview

只读，不产生费用。目标字段必须是：

```text
aiText / aiImage / aiVideo
```

返回每行：

```text
ready
skipped
reasons
existing
mediaCount
resolvedPrompt
```

主要用于 Agent 在真正生成前检查 Prompt、Provider 与目标 Cell 状态。

## generation.run

必须显式：

```json
{
  "confirmed": true
}
```

并必须提供：

```text
idempotencyKey
```

支持：

```text
missing_only   已有结果自动跳过
force          明确重新生成
```

Phase 3 不重新实现生成逻辑，而是调用 Grid 当前已经验证的 `executeAIGenerateCell()`：

```text
Agent API
→ Grid Generation Runtime
→ 原图片 / 视频 / 文本生成逻辑
→ Job Center / Provider / ComfyUI
```

图片 / 视频通过现有网络任务链路时，会在 Network Job 中增加：

```text
agentBatchId
agentIdempotencyKey
```

用于防止重复提交和后续批次查询。

### ACK 规则

生成提交完成后，API 会等待对应 Cell 的 React writeback 真正提交，再返回 `ok: true`。

HTTP Bridge 对 `generation.run` 使用更长的 120 秒提交超时；这只是等待“任务安全创建 / 写回”，不是等待 AI 最终生成完成。

## Idempotency

相同：

```text
tableId + fieldId + idempotencyKey
```

再次请求时：

1. 优先查询 Network Job 中已经存在的相同 `agentIdempotencyKey`；
2. AI Text / 非 Network Job 路径使用当前窗口 `sessionStorage` 记录；
3. 命中后返回原任务，不重复创建付费任务。

## Job API

### job.list

支持：

```text
tableId
batchId
status
limit
```

不会返回 API Key、OSS Secret 或加密凭据。

### job.get

返回单个安全任务视图，包括：

```text
jobId
batchId
rowId
fieldId
provider
model
phase
status
taskId
lastError
remoteSubmitted
retryable
```

### job.retry

只做安全恢复：

```text
已有 taskId
→ 恢复 polling

已有 resultUrl / downloading
→ 恢复 download

没有 taskId / resultUrl
→ JOB_NOT_RETRYABLE
→ 不自动重新提交付费任务
```

### job.cancel

当前是本地取消：

```text
phase = cancelled
```

会停止后续本地 Polling；如果 Provider 没有远程 Cancel API，则明确返回：

```text
localCancelled: true
remoteCancelled: false
```

不会伪装成远程任务已经取消。

## 当前限制

- Phase 3 生成运行时目前要求目标 Table 正在 Grid 中处于 active 状态；非活动表返回 `TABLE_NOT_ACTIVE`。
- AI Text 仍沿用原同步生成路径，并不强行改造成 Network Job。
- Gemini Custom / OpenAI 直连图片如果原 UI 不经过 Network Job，Agent API 也保持原链路，不强行包装任务。
- Phase 3 不开放“没有 taskId 的失败付费任务自动重投”。
- Transaction / 多步计划仍留到 Phase 4。

## 安全边界

继续保持：

```text
× Agent 直接调用 Provider API
× Agent 直接修改 Grid React State
× Agent 获取 API Key / OSS Secret
× 自动重新提交 submission_unknown / 无 taskId 的付费任务
× 任意 JS / Shell
```
