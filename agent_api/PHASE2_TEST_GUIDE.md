# Table Action API v0.1 · Phase 2 测试指南

> 基于已通过的 Phase 1 localhost API 测试继续验证媒体实例。

## 1. 启动

```bat
set HONGS_TABLE_ACTION_API=1
set HONGS_TABLE_ACTION_TOKEN=test-123456
npm run dev
```

健康检查应显示：

```json
{
  "ok": true,
  "service": "ai-table-action-api",
  "version": "0.1",
  "phase": "phase2"
}
```

## 2. 准备测试数据

建议在测试表中准备：

- 一张已经做过 Crop 的图片；
- 一个已经设置 A-B 的视频；
- 一个已经设置 A-B 的音频；
- 一行空的附件 Cell 作为复制目标；
- 一个已正确配置媒体引用的 AI Video / AI Image / AI Text 字段。

先通过 `table.get_schema` 和 `row.query` 找到真实 `tableId / rowId / fieldId`。

## 3. media.get

```bat
node scripts/table_action_client.mjs media.get --token=test-123456 --params="{\"tableId\":\"table_xxx\",\"rowId\":\"row_xxx\",\"fieldId\":\"field_media\"}"
```

检查：

```text
图片 → cropData 存在
视频 / 音频 → trimData 存在
mappedUrl / refUrls / refCells → 不应出现在持久 item 中
```

## 4. media.copy_instance

把带 Crop / Trim 的第 0 个媒体实例复制到另一行：

```json
{
  "version": "0.1",
  "action": "media.copy_instance",
  "params": {
    "tableId": "table_xxx",
    "source": {
      "rowId": "row_source",
      "fieldId": "field_media",
      "index": 0
    },
    "target": {
      "rowId": "row_target",
      "fieldId": "field_media"
    },
    "mode": "append"
  }
}
```

检查 AI Table UI：

```text
图片复制后打开大屏 → 原 Crop 保留
视频 / 音频复制后打开大屏 → 原 A-B 保留
Ctrl+Z → 可以撤销 API 复制
```

## 5. media.attach

```json
{
  "version": "0.1",
  "action": "media.attach",
  "params": {
    "tableId": "table_xxx",
    "rowId": "row_target",
    "fieldId": "field_media",
    "items": [
      {
        "type": "image",
        "path": "D:/素材/test.jpg"
      }
    ],
    "mode": "append"
  }
}
```

检查：新媒体正常显示在 Cell 中。

Phase 2 不允许这样做：

```json
{
  "path": "D:/素材/test.mp4",
  "trimData": { "startMs": 0, "endMs": 5000 }
}
```

应返回 `INVALID_REQUEST`。已编辑实例请使用 `media.copy_instance`。

## 6. media.list_by_row

```bat
node scripts/table_action_client.mjs media.list_by_row --token=test-123456 --params="{\"tableId\":\"table_xxx\",\"rowId\":\"row_xxx\"}"
```

检查：同一行图片、视频、音频按字段分组返回。

## 7. media.get_effective_context

对 AI Video：

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

应按实际引用顺序返回：

```text
<Picture 1>
<Picture 2>
<Video 1>
<Audio 1>
```

并保留对应 `cropData / trimData`。

普通文本临时参考测试：额外传入：

```json
{
  "temporaryReferenceFieldId": "field_ai_video"
}
```

只读取上下文，不会修改普通文本 Field Config。

## Phase 2 验收

```text
[ ] cropData 可读
[ ] trimData 可读
[ ] 图片实例跨 Cell 复制后 Crop 保留
[ ] 视频 / 音频跨 Cell 复制后 A-B 保留
[ ] media.attach 能添加本地媒体
[ ] Agent 不能直接注入 Crop / Trim
[ ] list_by_row 能正确识别图片 / 视频 / 音频
[ ] effective_context 与当前智能字段真实引用顺序一致
[ ] Ctrl+Z 可以撤销媒体写操作
[ ] 原 UI Crop / Trim / Clipboard 不受影响
```


## 附：field.reorder 实测

先通过 `table.get_schema` 找到字段 ID。将 `field_prompt` 移到 `field_ai_image` 前：

```bat
node scripts/table_action_client.mjs field.reorder --token=test-123456 --confirmed --params="{\"tableId\":\"table_xxx\",\"fieldId\":\"field_prompt\",\"beforeFieldId\":\"field_ai_image\"}"
```

也可以使用：

```json
{ "afterFieldId": "field_xxx" }
```

或：

```json
{ "toIndex": 0 }
```

验收：UI 列顺序立即同步，Cell 数据与字段引用不发生变化，`Ctrl+Z` 可以撤销本次移动。

---

## exp2 rev4：连续快速写入回归测试

本轮根据真实 Agent 测试修复了一个高优先级竞态：多个 `field.create / row.create / cell.set` 在 React 状态尚未真正提交时连续到达，可能让后一个请求基于旧快照计算并覆盖前一个成功写入。

修复后采用两层保护：

```text
HTTP localhost 请求
→ Main 进程串行 dispatch queue
→ Renderer 串行 action queue
→ setTables
→ 等待 React commit
→ 再返回 HTTP 成功 ACK
```

因此 `200 / ok:true` 现在表示该写入已经进入 React 已提交状态，而不是“仅完成计算”。

请在专用测试表执行：

```bat
node scripts/table_action_rapid_write_test.mjs --table=table_xxx --token=test-123456 --count=6
```

脚本会故意并发发送多个 `field.create`，随后立即读取 schema，并用全部新 `fieldId` 创建一行。

预期：

```text
/health.phase = phase2
所有 field.create 返回成功
schema 中一个字段都不少
row.create 不出现 FIELD_NOT_FOUND
最终显示 PASS
```

> 该脚本会真实创建字段和 1 行数据，请只在专用 API 测试表执行。
