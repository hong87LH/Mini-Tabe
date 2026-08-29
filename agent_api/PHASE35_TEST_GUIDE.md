# Phase 3.5 本地功能测试指南

适用：`v2.6.3-agent-api-exp3.5` 探索分支。

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

预期 `phase = phase3.5`。

自动测试：

```bat
npm run test:action-api
```

预期：`31 / 31 pass`。

## 2. Selection / Current Context

在前台手工选择一个矩形区域，然后：

```bat
node scripts/table_action_client.mjs context.get_current --token=test-123456
```

检查：

- `activeCell` 与前台一致；
- `selection.rowIds / fieldIds / cells` 与选择区一致；
- 折叠/筛选后 `visibleRowIds` 只包含当前真正可见的记录。

## 3. table.activate

先通过 `table.list` 取得另一个 `tableId`：

```bat
node scripts/table_action_client.mjs table.activate --token=test-123456 --params="{\"tableId\":\"table_xxx\"}"
```

预期：

- 前台切换到目标表；
- API 返回后立刻调用 `context.get_current`，activeTable 已经是目标表；
- 随后可直接调用 `generation.preview`，不需要人工等待 Grid 挂载。

## 4. Current View

设置一个前台筛选、排序和分组，然后：

```bat
node scripts/table_action_client.mjs view.get --token=test-123456 --params="{\"tableId\":\"table_xxx\"}"
```

再查询当前可见记录：

```bat
node scripts/table_action_client.mjs row.query --token=test-123456 --params="{\"tableId\":\"table_xxx\",\"scope\":\"current_view\",\"limit\":100}"
```

检查：

- 过滤结果一致；
- 排序一致；
- 分组折叠后被折叠的记录不应出现在 current_view 结果中。

API 设置视图示例：

```json
{
  "version": "0.1",
  "action": "view.update",
  "params": {
    "tableId": "table_xxx",
    "patch": {
      "filter": {
        "logic": "and",
        "conditions": [
          { "fieldId": "fld_status", "operator": "equals", "value": "通过" }
        ]
      },
      "sort": { "fieldId": "fld_name", "direction": "asc" }
    }
  }
}
```

## 5. row.query 增强

OR：

```json
{
  "action": "row.query",
  "params": {
    "tableId": "table_xxx",
    "filter": {
      "logic": "or",
      "conditions": [
        { "fieldId": "fld_status", "operator": "equals", "value": "通过" },
        { "fieldId": "fld_status", "operator": "equals", "value": "返工" }
      ]
    }
  }
}
```

公式值：

```json
{
  "action": "row.query",
  "params": {
    "tableId": "table_xxx",
    "includeComputed": true,
    "fields": ["fld_formula"]
  }
}
```

检查 `computedValues` 与前台公式显示一致。

## 6. field.duplicate

```json
{
  "version": "0.1",
  "action": "field.duplicate",
  "confirmed": true,
  "params": {
    "tableId": "table_xxx",
    "fieldId": "fld_ai_video",
    "name": "AI视频 H3 Quality",
    "copyValues": false
  }
}
```

重点检查 AI Prompt、AI Config、引用配置是否完整复制；`copyValues=false` 时新列不复制原结果。

## 7. Select Options

新增：

```json
{
  "action": "field.options.upsert",
  "confirmed": true,
  "params": {
    "tableId": "table_xxx",
    "fieldId": "fld_status",
    "options": [{ "name": "待复审" }]
  }
}
```

删除一个正在被使用的 Option 时，不带 `clearValues=true` 应返回 `WRITE_CONFLICT`，不得静默清空记录。

## 8. field.configure_ai

AI Video 示例：

```json
{
  "action": "field.configure_ai",
  "confirmed": true,
  "params": {
    "tableId": "table_xxx",
    "fieldId": "fld_ai_video",
    "config": {
      "model": "minimax-h3-local",
      "duration": "{时长}",
      "ratio": "16:9",
      "resolution": "720P",
      "sourceImage": "{产品图}",
      "sourceVideo": "{动作参考}",
      "sound": false
    }
  }
}
```

检查前台字段面板同步显示。再用 `field.update` 直接 patch `aiVideoConfig`，预期应拒绝并提示改用 `field.configure_ai`。

## 9. Cell Link

先读取：

```json
{
  "action": "cell.get_meta",
  "params": { "tableId": "table_xxx", "rowId": "rec_1", "fieldId": "fld_prompt" }
}
```

建立联动：

```json
{
  "action": "cell.link",
  "confirmed": true,
  "params": {
    "tableId": "table_xxx",
    "cells": [
      { "rowId": "rec_1", "fieldId": "fld_prompt" },
      { "rowId": "rec_2", "fieldId": "fld_prompt" }
    ]
  }
}
```

第二格应同步第一格值。`cell.unlink` 后再写第二格，应不再联动。

## 10. generation.get_capabilities

```bat
node scripts/table_action_client.mjs generation.get_capabilities --token=test-123456
```

检查：

- Provider / Model 与设置面板一致；
- disabled Provider 会标识 `enabled=false`；
- `credentialReady` 正确；
- 响应中不能出现 API Key。

## 11. generation.preview 增强

选择一个 AI Video 字段执行 Preview，重点核对：

- `resolvedPrompt`；
- `resolvedConfig.model / provider`；
- `duration / resolution / ratio / sound`；
- `media[]` 的 Picture / Video / Audio、Crop / Trim；
- `output.folderPath / filename`；
- Provider 未启用、模型不可用、凭据缺失、参考媒体为空时 `ready=false`；
- `blockingReasons` 与真实 Run 失败原因一致。

## 12. 并发回归

Phase 3.5 使用小数子阶段，因此并发脚本已支持 `phase3.5`：

```bat
node scripts/table_action_rapid_write_test.mjs --table=table_xxx --token=test-123456 --count=12 --prefix=P35Rapid
```

预期仍输出：

```text
PASS: rapid concurrent writes were serialized and ACKed after commit.
```

## 通过标准

- Selection 能准确读取；
- table.activate 返回后目标 Runtime 已 Ready；
- current_view 与用户眼前可见记录一致；
- AI 字段复制与安全配置正确；
- Select Option 和 Cell Link 可安全管理；
- generation.preview 能在 Run 前识别不可用模型/Provider/媒体缺失；
- 12 路并发写入无回归；
- 原 Phase 1–3 Media / Generation / Job API 无回归。
