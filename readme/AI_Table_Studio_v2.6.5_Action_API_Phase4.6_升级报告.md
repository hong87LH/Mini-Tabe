# AI Table Studio v2.6.5 · Action API Phase 4.6 升级报告

发布日期：2026-08-29  
产品版本：`2.6.5`  
Table Action API 协议：`v0.1`  
能力阶段：`phase4.6`

## 1. 升级目标

Phase 4.6 不继续扩张表格业务 Action，而是补齐后续 MCP Server 最依赖的两项基础能力：

1. 每个 Action 都有可查询、可校验、可复用的精确 Definition。
2. Windows CLI 不再要求 Agent 把复杂 JSON、中文路径和反斜杠塞进行内参数。

本轮同时归档此前真实 API 测试中完成的 ComfyUI 空引用优化：AI 字段已经配置媒体引用，但当前行引用 Cell 为空时，可以跳过空实例；是否允许 0 参考最终由用户所选 Workflow 的 Capability 决定，系统不擅自切换 Workflow。

## 2. 架构变化

### 2.1 单一 Action Definition

新增：

```text
agent_api/action_definitions.js
```

它成为静态协议规则的唯一来源：

```text
Action Definition
  ├─ Action 名称与说明
  ├─ Permission / Write / Runtime
  ├─ Confirmation 策略
  ├─ 精确 params JSON Schema
  ├─ 示例请求与边界说明
  ├─ HTTP AJV 校验
  ├─ CLI --help / --validate-only
  ├─ system.describe_action
  └─ 未来 MCP Tool Schema
```

原来的 `agent_api/table_action_api_v0.1.schema.json` 继续作为外部 Agent 和第三方工具可读取的标准 JSON Schema，但它现在由下列命令生成：

```bat
npm run generate:action-schema
```

因此禁止分别维护 HTTP Schema、CLI 参数说明和 MCP Tool Schema，避免同一个 Action 出现多套冲突规则。

### 2.2 静态校验与业务校验边界

Action Definition 负责静态格式：

- 必填参数；
- 类型、枚举、数组上限；
- 是否允许额外字段；
- Crop、Trim、Rating 等结构约束；
- 权限、确认和 Runtime 属性。

业务层继续负责依赖当前 Workspace 的动态判断：

- `tableId / rowId / fieldId` 是否真实存在；
- Cell 是否已有值或 Cell Link；
- `expectedRevision` 是否过期；
- Workflow 是否支持解析后的实际媒体数量；
- Provider 凭据、Job、保存权限和文件状态。

两者不是重复实现：静态 Schema 在请求进入 Renderer 前阻止格式错误，动态校验根据实时 UI 状态作出业务判断。

## 3. 新增 system.describe_action

调用：

```json
{
  "version": "0.1",
  "action": "system.describe_action",
  "params": {
    "action": "field.configure_ai"
  }
}
```

响应包含：

- Action 名称、说明；
- 权限和是否写入；
- 是否依赖 Runtime；
- 确认策略；
- Dry Run、Revision、幂等支持；
- 精确 `paramsSchema`；
- 边界 Notes；
- 完整示例请求。

例如 `media.move` 会明确说明：它只把媒体实例从一个 Cell 移到另一个 Cell，不移动硬盘文件。

`system.get_capabilities` 也新增：

```text
actionDefinitionVersion
implementedActions[].summary
implementedActions[].schemaAvailable
features.actionDefinitions
features.describeAction
features.mcpReadyActionSchemas
```

## 4. CLI 易用性升级

CLI 仍然只是 localhost API 的参考客户端，不是第二个服务。AI Table Studio 的协作启动命令没有增加：

```bat
set "HONGS_TABLE_ACTION_API=1" && set "HONGS_TABLE_ACTION_TOKEN=test-123456" && npm run dev
```

### 4.1 单 Action Help

无需启动 Electron、无需 Token：

```bat
node scripts/table_action_client.mjs field.configure_ai --help
node scripts/table_action_client.mjs media.move --help
```

输出权限、确认策略、精确参数 Schema、Notes 与示例。

### 4.2 参数文件

推荐 Windows 日常使用：

```bat
node scripts/table_action_client.mjs cell.batch_set ^
  --token=test-123456 ^
  --confirmed ^
  --params-file=cell-batch-set.json
```

`cell-batch-set.json` 只包含 `params`：

```json
{
  "tableId": "table_xxx",
  "writeMode": "replace",
  "updates": [
    {
      "rowId": "row_xxx",
      "fieldId": "field_xxx",
      "value": [
        "F:\\01_AIGC\\素材\\测试视频.mp4"
      ]
    }
  ]
}
```

这样 JSON 只转义一次，不再经过 CMD、PowerShell 和 Node 三层引号解释。

### 4.3 完整请求文件

```bat
node scripts/table_action_client.mjs --token=test-123456 --request-file=request.json
```

`request.json` 可包含 `version / action / actor / confirmed / expectedRevision / idempotencyKey / params`。

### 4.4 stdin

PowerShell：

```powershell
Get-Content .\params.json -Raw |
  node scripts/table_action_client.mjs cell.batch_set --stdin --token=test-123456 --confirmed
```

### 4.5 本地校验和请求预览

```bat
node scripts/table_action_client.mjs cell.batch_set --validate-only --params-file=cell-batch-set.json
node scripts/table_action_client.mjs generation.run --print-request --token=test-123456 --params-file=generation.json
```

- `--validate-only` 不连接 API，也不需要 Token。
- `--print-request` 输出最终请求，但会隐藏 Token、Secret、Credential、API Key 与 Access Key 字段。
- `--compact` 提供机器友好的单行 JSON。
- `generation.run --idempotency-key=...` 会同时补入生成 Runtime 需要的 `params.idempotencyKey`，减少调用歧义。
- `--params / --params-file / --request-file / --stdin` 互斥，避免不明确的参数覆盖。

原有调用继续兼容：

```bat
node scripts/table_action_client.mjs table.list --token=test-123456
node scripts/table_action_client.mjs row.get --token=test-123456 --params="{\"tableId\":\"table_x\",\"rowId\":\"row_x\"}"
```

## 5. Workflow 空引用优化归档

### 5.1 原问题

UI 中智能图片、智能视频或智能文本字段可以预先配置媒体引用。实际逐行生成时，有些行的引用 Cell 可能为空。旧 API Preview 容易把“引用字段存在但该行为空”误判为所有引用都必须满足，从而阻止原本可以继续执行的生成。

### 5.2 当前行为

```text
字段配置仍保留 {AI首帧图}
  → 当前行 AI首帧图 Cell 为空
  → 空实例不进入 Effective Media Context
  → 返回 MEDIA_REFERENCE_EMPTY_SKIPPED Warning
  → 按非空实例统计 images / videos / audio
  → 使用用户当前选择的 Workflow Manifest 校验
  → Workflow 支持 0 参考则继续生成
```

重要边界：

- 不强制每个已配置引用都必须有值；
- 不删除字段的引用配置；
- 不根据有效素材数量自动替换模型；
- 不从一个 Workflow 静默切换到另一个 Workflow；
- Workflow 如果声明 `minTotalReferences: 1`，0 参考仍会返回 `WORKFLOW_INPUT_UNSUPPORTED`；
- ComfyUI Client 不设置第二层跨 Workflow 保险路由。

这使 API 行为与 UI 逐行生成体验一致，同时保留用户选择 Workflow 的主观控制权。

### 5.3 已验证场景

专用测试字段明确配置：

```text
sourceImageTemplate = {AI首帧图}
```

目标行的 `AI首帧图` Cell 为空，Preview 返回：

```text
ready = true
warning = MEDIA_REFERENCE_EMPTY_SKIPPED
mediaCount = 0
model = minimax-h3-local
workflowId = minimax-h3-first-last-router
```

随后真实 H3 任务成功提交、轮询、下载并写回 Cell，证明测试覆盖的是“已经配置引用但当前值为空”，而不是没有配置引用的纯文生字段。

## 6. MCP 前置意义

未来 MCP Server 不应重新实现表格、媒体或生成逻辑：

```text
Codex / MCP Client
  → MCP Tool（从 Action Definition 注册）
  → localhost Table Action API
  → Electron Main / Renderer 串行队列
  → 当前用户正在编辑的同一个 UI Workspace
```

Phase 4.6 使 MCP 可以直接复用：

- Tool 名称；
- Input Schema；
- 权限和确认提示；
- Tool 说明与边界；
- 示例和本地测试；
- HTTP 错误与 Revision/Idempotency 语义。

CLI 在 MCP 完成后仍作为开发、诊断和协议回归工具保留，但不要求普通 Agent 日常手写命令。

## 7. 修改文件

### 新增

- `agent_api/action_definitions.js`
- `scripts/generate_table_action_schema.mjs`
- `scripts/table_action_client.test.mjs`
- `readme/AI_Table_Studio_v2.6.5_Action_API_Phase4.6_升级报告.md`

### 修改

- `agent_api/table_action_api.js`
- `agent_api/table_action_server.js`
- `agent_api/table_action_api_v0.1.schema.json`
- `agent_api/table_action_api.test.mjs`
- `agent_api/table_action_server.test.mjs`
- `agent_api/README.md`
- `scripts/table_action_client.mjs`
- `package.json`
- `package-lock.json`
- `README.md`
- `readme/00_文档索引.md`
- `readme/Agent_API_标准接管与启动清单.md`
- `readme/v2.6.3后_Agent_API升级报告_Phase1-4.5.md`
- `readme/90_版本记录/README.md`
- `readme/90_版本记录/CHANGELOG_v2.4.8-v2.6.3.md`

### 一并纳入 v2.6.5 的此前零参考优化文件

- `src/lib/generationPreviewPolicy.ts`
- `src/components/Grid.tsx`
- `tests/generation_preview_policy.test.ts`
- `comfyui/comfyui_client.js`
- `comfyui/workflows/minimax-h3-i2v/manifest.json`
- `comfyui/workflows/minimax-h3-reference-router/manifest.json`
- `tests/comfyui_protocol.test.mjs`

## 8. 自动测试结果

2026-08-29：

```text
npm run test:action-api

Action API / HTTP / CLI: 48 tests
48 pass
0 fail

Generation Preview / Empty Reference: 7 tests
7 pass
0 fail
```

其余回归：

```text
npm run test:comfyui  12 / 12 通过
npm run build          通过（Vite 1704 modules transformed）
npm run lint           未通过：仅保留既有 Grid.tsx:7901 TS2347
```

`Grid.tsx:7901` 是未类型化 DOM 节点调用 `querySelector<HTMLElement>` 的既有 TypeScript 诊断，不属于 Action Definition、CLI 或零参考策略链路；本轮没有扩大修改范围去顺带重构 Grid。

## 9. 兼容性

- localhost 地址不变：`http://127.0.0.1:17321/v0.1/actions`。
- Bearer Token 方式不变。
- Table Action API 协议版本仍为 `0.1`。
- 启动命令不变。
- 现有 `--params=` CLI 调用继续可用。
- 产品版本升级为 `2.6.5`，能力阶段升级为 `phase4.6`。
