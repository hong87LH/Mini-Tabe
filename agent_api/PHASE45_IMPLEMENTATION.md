# AI Table Studio Agent API Phase 4–4.5 实施说明

版本：Table Action API v0.1，`phase4.5`

## 分层

```text
localhost HTTP + AJV + Token/Permission + Audit + SSE
  → Electron Main 串行队列
  → Renderer 串行队列
  → Revision / Transaction / Runtime Adapter
  → React commit 后 ACK
```

## 协作一致性

- 每个响应返回 `workspaceRevision`。
- Mutation 可在请求顶层提供 `expectedRevision`；不一致返回 `STALE_WORKSPACE`，不会提交旧快照。
- `transaction.preview` 计算每一步和汇总 Effects，但不提交。
- `transaction.execute` 在克隆 Workspace 上依次执行纯数据 Mutation，仅在全部成功时一次提交和生成一个 Undo Token。
- 事务中可为 `table.create / field.create / row.insert` 提供显式 ID，后续步骤即可安全引用前一步创建的对象。
- 所有 Mutation 的成功请求最多缓存 500 个 `idempotencyKey`；同 Key/同 Payload 重试返回 `idempotentReplay=true`，同 Key/不同 Payload 返回 `IDEMPOTENCY_CONFLICT`。
- API Undo 记录 before/after 快照和 Revision。若用户随后编辑 UI，旧 Undo 会因 Revision 不一致被拒绝。

## Runtime

- `workspace.save` 只写已绑定工程文件。
- Batch API 聚合现有 Network Job Store，不创建第二套任务数据库。
- Job Retry 只恢复已有 `taskId` 或 `resultUrl`，不自动重新付费提交。
- Export 使用既有 Electron 下载通道；执行时必须明确 `folderPath`。
- SSE 位于 `/v0.1/events`，实际 Job 状态变化由 Network Polling 推送。

## 安全

- Schema 校验失败：`SCHEMA_VALIDATION_FAILED`。
- 权限不足：`PERMISSION_DENIED`。
- Transaction 会校验每个子 Action 的权限，外层 `write:data` 不能绕过 `write:schema` 或 `destructive`。
- Token 过期：`TOKEN_EXPIRED`。
- Audit 文件：Electron `userData/table-action-api-audit.jsonl`。
- Session 文件记录权限、过期时间、Events URL 和 Audit 路径；不向 Action 响应泄露凭据。

## Effects

所有响应统一包含：

```json
{
  "tablesAffected": 0,
  "fieldsAffected": 0,
  "rowsAffected": 0,
  "cellsAffected": 0,
  "mediaAffected": 0,
  "jobsCreated": 0
}
```

旧的 `tablesCreated / fieldsCreated / fieldsReordered / rowsCreated` 为兼容字段，继续保留。
