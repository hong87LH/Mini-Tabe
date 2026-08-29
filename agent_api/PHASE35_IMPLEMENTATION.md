# AI Table Studio v2.6.3 Agent API · Phase 3.5 实施说明

分支：`v2.6.3-agent-api-exp3.5`

Phase 3 已完成“查表 → 媒体上下文 → 生成 → Job Center”的核心闭环。Phase 3.5 不开放高风险删除，而是优先补齐 Agent 实际使用中最高频的 UI / View / Field Config 能力，为 Phase 4 的 Transaction / Revision / Undo 做准备。

## 本轮新增

```text
context.get_current      + activeCell / selection / visible rows

table.activate

view.get
view.update

field.duplicate
field.options.get
field.options.upsert
field.options.update
field.options.remove
field.options.reorder
field.configure_ai

row.query                + current_view / OR / sort / rowIds / includeComputed

cell.get_meta
cell.link
cell.unlink

generation.get_capabilities
generation.preview       resolved validation upgrade
```

当前 Action 总数：38。

## 关键设计

### Selection / Current View

Selection 来自当前 Grid Runtime，而不是从项目 JSON 推断。`current_view` 查询使用当前前台已经完成 Filter / Sort / Group 后的数据，并进一步排除 Folded Group 中被隐藏的记录。

### table.activate ACK

切换表格不再只是修改 `activeTableId` 后立即返回。Renderer 会等待目标 Grid Runtime 注册完成再 ACK，因此后续 Agent 可以直接继续调用当前表相关 Runtime Action。

### Safe AI Config

`field.update` 不再允许直接写 `aiTextConfig / aiImageConfig / aiVideoConfig`。AI 字段统一通过 `field.configure_ai` 的稳定语义参数设置，由 Adapter 转为内部结构。

### Select Option Safety

删除仍被记录使用的 Option 默认返回 `WRITE_CONFLICT`。只有显式 `clearValues=true` 才允许删除并同步清理对应 Cell 值。

### Cell Link Safety

API 现在可以在写入前通过 `cell.get_meta` 得知联动范围，并通过 `cell.link / unlink` 建立或解除联动，避免 Agent 在不知道 Link 存在的情况下误判影响范围。

### Generation Preview

Preview 新增：

- 最终解析 Prompt；
- 最终 Model / Provider；
- Provider Credential Ready 状态；
- 视频时长 / 分辨率 / 比例 / Sound / Mode；
- 图片输出参数；
- Picture / Video / Audio 实际引用列表；
- `cropData / trimData`；
- 最终输出目录 / 文件名；
- `mayCostMoney`；
- `blockingReasons`。

特别修复了“字段引用了一个未启用模型，但 Preview 仍显示 ready”的架构缺口：Preview 现在会按真实运行时的 Provider / Model 路由进行验证。

## 仍然刻意不开放

```text
table.delete
field.delete
row.delete
field.convert
media.remove
任意 cropData / trimData JSON 注入
```

这些能力等待 Phase 4 的 `workspaceRevision + transaction + API Undo` 后再开放。

## 自动验证

```text
Table Action API: 31 / 31 pass
JSON Schema: valid
Node syntax: table_action_api / table_action_server / preload / rapid-write script pass
TypeScript diagnostics: 与 exp3 基线数量一致；没有新增 TS 诊断类别
```

真实 UI Runtime 能力（Selection、table.activate Runtime Ready、current_view、Provider Preview）仍建议按随包 `agent_api/PHASE35_TEST_GUIDE.md` 做本地验收。
