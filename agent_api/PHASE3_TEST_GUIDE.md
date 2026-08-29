# Phase 3 本地测试指南

## 1. 启动

```bat
set HONGS_TABLE_ACTION_API=1
set HONGS_TABLE_ACTION_TOKEN=test-123456
npm run dev
```

检查：

```text
http://127.0.0.1:17321/health
```

预期：

```json
{"ok":true,"service":"ai-table-action-api","version":"0.1","phase":"phase3"}
```

## 2. 自动测试

```bat
npm run test:action-api
```

预期：

```text
23 tests
23 pass
0 fail
```

## 3. generation.preview

先用 `table.list / table.get_schema / row.query` 获取真实 ID。

```bat
node scripts/table_action_client.mjs generation.preview --token=test-123456 --params="{\"tableId\":\"table_xxx\",\"fieldId\":\"field_ai_xxx\",\"rowIds\":[\"row_xxx\"],\"mode\":\"missing_only\"}"
```

检查：

```text
ready / skipped / reasons
resolvedPrompt
mediaCount
```

这一步不产生 AI 费用。

## 4. generation.run

建议第一轮使用低成本 AI Text 测试。

```bat
node scripts/table_action_client.mjs generation.run --token=test-123456 --confirmed --params="{\"tableId\":\"table_xxx\",\"fieldId\":\"field_ai_text\",\"rowIds\":[\"row_1\",\"row_2\"],\"mode\":\"missing_only\",\"idempotencyKey\":\"phase3-text-test-001\"}"
```

验证：

```text
目标 Cell 写回
completedRows 正确
重复相同 idempotencyKey 不再次生成
```

## 5. AI Image / AI Video

正式媒体测试只做 1–2 行。

生成后检查响应：

```text
batchId
jobs[].jobId
```

然后：

```bat
node scripts/table_action_client.mjs job.list --token=test-123456 --params="{\"tableId\":\"table_xxx\",\"limit\":50}"
```

确认 Job Center UI 与 API 返回一致。

AI Video 建议至少测试一次已有 `trimData` 的参考视频，确认仍走：

```text
trimData
→ FFmpeg Media Preprocessor
→ Job Center
```

## 6. 幂等测试

第一次：

```text
idempotencyKey = phase3-video-001
```

生成真实 Job。

立即再次发送完全相同请求。

预期：

```text
idempotentReplay = true
jobs 复用原 jobId
Job Center 不新增重复付费任务
```

## 7. job.get

```bat
node scripts/table_action_client.mjs job.get --token=test-123456 --params="{\"jobId\":\"job_xxx\"}"
```

确认不返回：

```text
apiKey
credentials
accessKeySecret
```

## 8. job.retry

优先测试一个已有 `taskId` 的失败 / 中断任务：

```bat
node scripts/table_action_client.mjs job.retry --token=test-123456 --confirmed --params="{\"jobId\":\"job_xxx\"}"
```

预期：

```text
已有 taskId → resume_polling
已有 resultUrl → resume_download
无 taskId/resultUrl → JOB_NOT_RETRYABLE
```

最后一种情况绝不能自动重新付费提交。

## 9. job.cancel

仅在专用测试任务执行：

```bat
node scripts/table_action_client.mjs job.cancel --token=test-123456 --confirmed --params="{\"jobId\":\"job_xxx\"}"
```

预期：

```text
localCancelled = true
remoteCancelled = false
phase = cancelled
```

## 10. Phase 3 验收

```text
[ ] /health = phase3
[ ] Action API = 23 / 23
[ ] generation.preview 不产生费用
[ ] AI Text 真实生成通过
[ ] AI Image 真实 Job 通过
[ ] AI Video / Trim Reference 真实 Job 通过
[ ] job.list 与 Job Center UI 一致
[ ] 同 idempotencyKey 不重复创建 Job
[ ] job.retry 有 taskId 时不重新付费提交
[ ] 无 taskId 时明确拒绝自动重投
[ ] job.cancel 不伪装成远程取消
[ ] 原 Phase 1 / Phase 2 功能无回归
```

## 8. 快速连续写入回归

Phase 3 仍应保留 exp2 的并发写入回归。脚本现在接受 `phase2` 及后续 Phase，不再写死单一版本：

```bat
node scripts/table_action_rapid_write_test.mjs --table=table_xxx --token=test-123456 --count=6
```

建议再跑一次 12 路：

```bat
node scripts/table_action_rapid_write_test.mjs --table=table_xxx --token=test-123456 --count=12 --prefix=P3Rapid
```

脚本会同时校验：

```text
/health.phase >= phase2
/health.phase = system.get_capabilities.phase
全部 field.create 返回成功后真实存在于 schema
立即 row.create 不出现 FIELD_NOT_FOUND
```

通过标志：

```text
PASS: rapid concurrent writes were serialized and ACKed after commit.
```

