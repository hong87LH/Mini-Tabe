# AI Table Studio Agent API 标准接管与启动清单

适用范围：AI Table Studio `v2.6.5`，当前 Table Action API 协议版本 `v0.1`、能力阶段 `phase4.7`。

本文解决两件事：用户如何手工启动“UI + localhost API”协作模式，以及新的 Agent 如何在不了解工程内部实现的情况下安全接管。

## 1. 先理解运行方式

普通开发启动：

```bat
cd /d F:\01_AIGC\12_AI_studio\bitable-clone
npm run dev
```

只启动 Electron 与 Vite。因为 Action API 默认关闭，外部 Agent 无法通过 `127.0.0.1:17321` 控制表格。

最简协作模式只需要原来这一行，其他环境变量都不是必需项：

```bat
cd /d F:\01_AIGC\12_AI_studio\bitable-clone
set "HONGS_TABLE_ACTION_API=1" && set "HONGS_TABLE_ACTION_TOKEN=test-123456" && npm run dev
```

`test-123456` 适合本机临时测试。需要长时间开启或交给多个 Agent 使用时，再采用下面的推荐安全配置：

```bat
cd /d F:\01_AIGC\12_AI_studio\bitable-clone
set HONGS_TABLE_ACTION_API=1
set HONGS_TABLE_ACTION_TOKEN=请替换为本次会话专用Token
set HONGS_TABLE_ACTION_TOKEN_TTL_SECONDS=28800
set HONGS_TABLE_ACTION_ACTOR_ID=codex-local
set HONGS_TABLE_ACTION_ACTOR_NAME=Codex
npm run dev
```

它仍然启动同一个 AI Table Studio UI，但同时增加只监听本机回环地址的 HTTP Bridge：

```text
POST http://127.0.0.1:17321/v0.1/actions
GET  http://127.0.0.1:17321/v0.1/events
GET  http://127.0.0.1:17321/health
```

这些 `set` 变量只在当前 CMD 窗口及其启动的进程中有效。关闭 Electron 或该 CMD 后，API 随应用停止。

## 2. 权限配置

如果没有设置 `HONGS_TABLE_ACTION_PERMISSIONS`，当前实现会授予全部 API 权限。建议手工明确授权。

只读检查：

```bat
set HONGS_TABLE_ACTION_PERMISSIONS=read
```

日常人机协作：

```bat
set HONGS_TABLE_ACTION_PERMISSIONS=read,write:data,write:schema,write:media,execute:generation
```

完整维护模式：

```bat
set HONGS_TABLE_ACTION_PERMISSIONS=read,write:data,write:schema,write:media,execute:generation,filesystem:export,workspace:save,destructive
```

`destructive` 包括删除表、字段、行、媒体和 Job 历史等操作；`filesystem:export` 允许向明确指定的文件夹导出；`workspace:save` 只允许保存已经绑定的工程文件。

不要把真实 Token 写入 README、聊天记录、脚本仓库或截图。每次会话建议更换 Token，并设置 TTL。

## 3. 用户启动后的最短验收

启动日志应出现：

```text
[Table Action API] listening on http://127.0.0.1:17321/v0.1/actions
```

在另一个 CMD 中执行：

```bat
curl http://127.0.0.1:17321/health
```

当前预期：

```json
{"ok":true,"service":"ai-table-action-api","version":"0.1","phase":"phase4.7"}
```

再执行两次只读探测：

```bat
cd /d F:\01_AIGC\12_AI_studio\bitable-clone
node scripts/table_action_client.mjs system.get_capabilities --token=%HONGS_TABLE_ACTION_TOKEN%
node scripts/table_action_client.mjs context.get_current --token=%HONGS_TABLE_ACTION_TOKEN%
```

如果第二个 CMD 没有设置同一个 Token 环境变量，就把 `%HONGS_TABLE_ACTION_TOKEN%` 换成用户提供的会话 Token。

## 4. 新 Agent 接管前必须阅读

按以下优先级读取，不要从旧阶段测试指南反推当前协议：

1. `agent_api/README.md`：当前能力、边界和启动方式。
2. `agent_api/action_definitions.js`：所有 Action 的静态定义单一事实源。
3. `agent_api/table_action_api_v0.1.schema.json`：由 Action Definition 生成的 HTTP 请求 Schema；不要手工修改。
4. `scripts/table_action_client.mjs`：标准 HTTP Client，支持单 Action 帮助、文件输入和本地校验。
5. `readme/AI_Table_Studio_v2.6.5_Action_API_Phase4.7_升级报告.md`：Phase 4.7 实施与验收。
6. `agent_api/PHASE45_TEST_GUIDE.md`：Phase 4.5 协作安全、事务、Undo、事件、批次和导出的历史测试基线。
7. `agent_api/PHASE2/3/3.5_*`：仅在排查对应阶段历史行为时阅读。

源代码职责：

```text
agent_api/action_definitions.js     Action Schema、权限、确认要求、示例的单一事实源
agent_api/table_action_api.js       Action 语义、动态状态校验、纯数据变换
agent_api/table_action_server.js    localhost、鉴权、Schema、队列、Audit、SSE
src/App.tsx                         Renderer 串行执行、Revision、Commit ACK、Undo
src/components/Grid.tsx             当前选择区、View、真实生成 Runtime
main.js / preload.js                Electron Main ↔ Renderer Bridge
network_polling.js                  Job 状态事件
```

## 5. Agent 标准接管顺序

### A. 会话发现

1. 调用 `/health`，必须是 `phase4.7`。
2. 调用 `system.get_capabilities`，默认使用紧凑 `summary`；以返回的 Action 列表为准。需要完整元数据时再传 `detail=full`。
3. 对准备使用的 Action 调用 `system.describe_action`，或执行 `node scripts/table_action_client.mjs <action> --help`，取得精确参数、权限和示例。
4. 调用 `context.get_current`，记录活动工程、表格、Cell、Selection 和 `workspaceRevision`。
5. 调用 `table.list`；不要猜 `tableId`。

### B. 只读建模

1. 对目标表调用 `table.get_schema`。
2. 必要时先 `table.activate`，等待 Grid Runtime Ready。
3. 使用 `row.query` 读取目标记录；需要与 UI 当前可见内容一致时使用 `scope=current_view`。
4. 操作媒体前调用 `media.get`、`media.list_by_row` 或 `media.get_effective_context`。
5. 操作 AI 字段前调用 `generation.get_capabilities` 和 `generation.preview`。

### C. 写入计划

1. 明确目标 `tableId / fieldId / rowId`，禁止凭字段名猜 ID。
2. 保存最新 `workspaceRevision`。
3. 多步修改优先用 `transaction.preview` 查看 Effects。
4. 每个新的 Mutation 使用新的 `idempotencyKey`。
5. 同一请求因网络问题重试时复用原 Key；内容变化后必须换新 Key。
6. 写请求携带 `expectedRevision`，防止覆盖用户刚在 UI 中完成的编辑。
7. 破坏性、覆盖式、付费生成和导出操作必须显式 `confirmed=true`。

### D. 执行与核验

1. 单步写入使用 `--expected-revision` 和 `--idempotency-key`。
2. 多步纯数据修改使用 `transaction.execute`，失败时不得拆开盲目重放。
3. 收到 `STALE_WORKSPACE` 后重新读取上下文和数据，由新快照重新规划；不要自动覆盖。
4. 收到成功响应后立即读回 schema/row/media/job，并与 UI 对照。
5. 保存返回的 `undoToken`；需要撤销时使用 `undo.apply`，不要模拟键盘操作。

示例：

```bat
node scripts/table_action_client.mjs cell.set --token=%HONGS_TABLE_ACTION_TOKEN% --expected-revision=12 --idempotency-key=edit-20260824-001 --params="{\"tableId\":\"table_x\",\"rowId\":\"row_x\",\"fieldId\":\"field_x\",\"value\":\"新内容\"}"
```

Phase 4.7 已兼容常见 Windows 旧式 `--params="{...}"` 引号损坏；短参数可继续内联。参数复杂、包含长提示词、中文路径或深层数组时，仍优先把 `params` 保存为 UTF-8 JSON，再使用文件输入：

```bat
node scripts/table_action_client.mjs cell.set --token=%HONGS_TABLE_ACTION_TOKEN% --params-file=requests\cell-set.params.json --validate-only
node scripts/table_action_client.mjs cell.set --token=%HONGS_TABLE_ACTION_TOKEN% --params-file=requests\cell-set.params.json --confirmed
```

也可以把完整请求保存为 JSON 后使用 `--request-file`，或由其他程序通过管道传给 `--stdin`。`--validate-only` 只做本地 Schema 校验，不连接 Electron，也不会修改表格。

### E. 生成任务

1. 先 `generation.preview`，确认 `ready`、Prompt、Provider、Model、媒体引用、输出目录与 `mayCostMoney`。
2. 用户授权后再 `generation.run --confirmed`。
3. 付费生成必须使用稳定的 `idempotencyKey`；网络状态不明时先查 `job.list`，不要直接重新提交。
4. 通过 `job.get / batch.get` 查询结果，或订阅 SSE：

```bat
node scripts/table_action_events.mjs --token=%HONGS_TABLE_ACTION_TOKEN%
```

5. `job.retry` 只恢复已有 `taskId` 或 `resultUrl`；`JOB_NOT_RETRYABLE` 不能被解释为“允许重新付费”。
6. 清理疑似失联任务必须先调用 `job.cleanup_stale.preview`；只有预览确认且用户授权后才调用 `job.cleanup_stale --confirmed`。它只处理经 ComfyUI Queue/History 证明已失联的非终态 Job，不得替代普通历史删除。

### F. 结束会话

1. 需要时调用 `workspace.get_dirty_state`。
2. 只有工程已经绑定文件并且用户授权时才调用 `workspace.save`。
3. 停止事件订阅。
4. 关闭 Electron/CMD，确认 `http://127.0.0.1:17321/health` 已不可访问。
5. 下次会话使用新 Token。

## 6. 可直接发给 Agent 的短版交接词

日常使用时直接复制下面这段。它保留必要的安全规则，但不要求 Agent 先理解全部内部架构：

```text
AI Table Studio Action API 已在本机启动：
http://127.0.0.1:17321/v0.1/actions

工程：
F:\01_AIGC\12_AI_studio\bitable-clone

Token：
test-123456

开始操作前请依次：

1. 阅读 agent_api/README.md。
2. 检查 /health，并调用 system.get_capabilities（默认 summary）；以返回结果为当前能力的唯一准确信息。
3. 使用 system.describe_action 或 `<action> --help` 读取准备调用 Action 的精确 Schema；复杂参数优先使用 --params-file/--request-file。
4. 调用 context.get_current 和 table.list，不要猜测 ID。
5. 使用 table.activate 激活目标表。
6. 调用 table.get_schema 和 row.query，取得真实 fieldId、rowId 与最新 workspaceRevision。
7. 写入前检查 cell.get_meta，避免忽略 Cell Link。
8. AI 字段必须使用 field.configure_ai，不要直接 Patch aiTextConfig、aiImageConfig 或 aiVideoConfig。
9. AI 生成必须先 generation.preview，核对 blockingReasons、模型、Provider、媒体、参数、输出路径和费用可能性。
10. 可能覆盖数据时先 dryRun；多步修改先 transaction.preview。只有接口要求且我已授权时才传 confirmed=true。
11. 所有 Mutation 使用 idempotencyKey，并携带最新 expectedRevision；遇到 STALE_WORKSPACE 时重新读取，不要强行覆盖。
12. 生成状态不明时先用 job.list 的摘要/fields 投影和 job.get 查询；不要用新 Key 盲目重投可能付费的任务。
13. 清理失联任务必须先 job.cleanup_stale.preview，再经我确认调用 job.cleanup_stale；不要把真实运行、成功或远端状态未知的 Job 当作失联任务。
14. 操作成功后读回核验，并保留 undoToken。
15. 不要操作生产表、删除数据、保存工程或导出文件，除非我明确指定。

可直接使用：
node scripts/table_action_client.mjs

事件监听：
node scripts/table_action_events.mjs --token=test-123456

精确请求格式：
agent_api/table_action_api_v0.1.schema.json

单 Action 精确说明：
node scripts/table_action_client.mjs <action> --help
```

如果只是只读检查，可把第 9–13 条理解为写入前的停止线；不需要为了读取而传 `confirmed=true`。

## 7. 当前边界

- 这是 localhost HTTP Action API，不是 MCP Server。
- API 只监听 `127.0.0.1`，不会主动开放局域网入口。
- 不提供任意 JavaScript、Shell、Provider 密钥修改或 OSS 清理。
- 当前 MCP 的正确方向是把 Action Definition 映射为 Tool，再通过 localhost Action API 执行；不应在 MCP 层重新实现表格、生成和 Job 业务逻辑。
