# AI Table Studio Agent API Phase 4–4.5 本地测试指南

## 1. 启动

```bat
set HONGS_TABLE_ACTION_API=1
set HONGS_TABLE_ACTION_TOKEN=test-123456
npm run dev
```

`GET http://127.0.0.1:17321/health` 应返回 `phase4.5`。

## 2. 自动测试

```bat
npm run test:action-api
```

预期：`42 tests / 42 pass / 0 fail`。

## 3. Revision 与过期写

先调用 `table.list` 记录 `workspaceRevision`，再用：

```bat
node scripts/table_action_client.mjs cell.set --token=test-123456 --expected-revision=REV --idempotency-key=phase4-cell-001 --params="{\"tableId\":\"table_x\",\"rowId\":\"row_x\",\"fieldId\":\"field_x\",\"value\":\"Phase 4\"}"
```

UI 手动改一次后复用旧 REV，预期 `STALE_WORKSPACE`。

## 4. 事务

先调用 `transaction.preview`；确认 Effects 和 Workspace 未变化。再以相同 `actions[]` 调用 `transaction.execute`，必须加 `--confirmed`。故意把最后一步 Row ID 改错，预期 `TRANSACTION_FAILED` 且前面步骤都不落盘。

## 5. Undo / Redo

记录写操作返回的 `undoToken`：

```bat
node scripts/table_action_client.mjs undo.apply --token=test-123456 --confirmed --params="{\"undoToken\":\"undo_x\"}"
node scripts/table_action_client.mjs redo.apply --token=test-123456 --confirmed --params="{\"undoToken\":\"undo_x\"}"
```

两次都应等待 UI commit 后 ACK。Undo 后手工编辑 UI，再 Redo 应拒绝覆盖新编辑。

## 6. SSE

```bat
node scripts/table_action_events.mjs --token=test-123456
```

另一窗口执行写操作和 Generation，检查 `workspace.changed / job.updated / generation.completed`。

## 7. Batch / Export / Save

- `batch.list` 后用真实 `batchId` 测 `get / list_results`。
- 仅对专用失败任务测 `retry_failed`，无 `taskId/resultUrl` 的 Job 必须返回 rejected。
- `export.preview` 不写文件；`export.csv/json/attachments` 必须 `confirmed=true` 且提供 `folderPath`。
- `workspace.get_dirty_state` 应区分 Revision 与 Last Saved Revision。
- 工程先在 UI 手动保存一次，再测 `workspace.save`；未绑定文件必须返回 `WORKSPACE_SAVE_UNAVAILABLE`。

## 8. 兼容回归

重新验证 Phase 1–3.5 的 Table/Field/Row/Cell、Media Copy、Generation Preview/Run、Job Retry/Cancel、Selection/Current View。
