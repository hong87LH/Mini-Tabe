# AI Table Studio v2.6.5 · Action API Phase 4.7 升级报告

发布日期：2026-08-29  
产品版本：`2.6.5`  
Table Action API 协议：`v0.1`  
能力阶段：`phase4.7`  
Action Definition：`1.1`

## 1. 本轮目标

Phase 4.7 保持产品版本 `2.6.5` 和 HTTP 协议 `v0.1` 不变，集中解决两类真实使用问题：

1. Agent 高频发现与 Job 查询响应偏大，增加了不必要的 Token 消耗。
2. ComfyUI 已经失联或丢失任务时，Job Center 与生成 Cell 可能长期残留“处理中”，普通删除 Job 历史又无法安全区分失联任务与真实运行任务。

同时补强 Windows CLI：旧式 `--params="{...}"` 遇到 CMD / PowerShell 引号损坏时进行有限、安全的恢复，并增加响应路径裁剪。

## 2. 核心变化

### 2.1 紧凑能力发现

`system.get_capabilities` 新增：

```json
{"detail":"summary"}
```

默认 `summary` 只返回 Action 名称和分组数量，适合 Agent 建立当前能力索引。需要权限、确认、Runtime 等完整元数据时显式使用：

```json
{"detail":"full"}
```

单个 Action 的精确参数仍由 `system.describe_action` 或 CLI `<action> --help` 提供。这样避免每次接管都重复返回 82 个 Action 的完整定义。

以当前 82 个 Action 的本地响应测量：摘要约 `4,167 bytes`，完整元数据约 `14,878 bytes`，单次发现减少约 `10,711 bytes / 72%`。这是 JSON 字节量，不等同于模型 Token 的精确数值，但能直接反映传输和上下文体积的下降。

### 2.2 Job 列表投影

`job.list` 新增：

- `detail=summary|full`；
- `fields=[...]` 精确字段投影；
- 默认摘要不返回排障时才需要的大块上下文。

日常轮询示例：

```bat
node scripts/table_action_client.mjs job.list --token=test-123456 --select=data.jobs --params="{\"tableId\":\"table_xxx\",\"fields\":[\"localJobId\",\"phase\",\"updatedAt\"]}"
```

### 2.3 失联 Job 专项清理

新增：

```text
job.cleanup_stale.preview
job.cleanup_stale
```

它和 `job.delete_history` 的语义不同：

| Action | 用途 | 是否判断远端存活 | 是否同步 Cell 占位 |
|---|---|---:|---:|
| `job.delete_history` | 用户明确删除一条普通历史记录 | 否 | 否 |
| `job.cleanup_stale.preview` | 预览可证明已经失联的任务 | 是，只读 | 否 |
| `job.cleanup_stale` | 清理经重新核验确实失联的任务 | 是 | 是 |

只有同时满足下列条件才可进入清理候选：

1. Phase 为非终态的 `preparing / uploading / creating / queued / running / polling`（当前生成链主要使用 `polling`，同时兼容旧记录与未来状态）；
2. 超过 `staleAfterMinutes`，默认 30 分钟且最低 5 分钟；
3. 没有 `resultUrl / localPath / finalPath`；
4. Provider 为当前可以精确检查的 ComfyUI；
5. 具有持久化 `taskId`；
6. ComfyUI 可访问，并确认 `taskId` 同时不在 Queue 与 History。

下列对象始终保护，不做自动清理：

- `completed / failed / cancelled / submission_unknown`；
- 已有结果 URL 或本地结果文件；
- 尚未超过阈值；
- ComfyUI 仍报告排队、运行或终态；
- 远端不可达、状态未知或没有 `taskId`；
- 非 ComfyUI Provider。

执行时会对 Preview 候选再次查询远端。只有复核仍然失联，并且本地取消真正返回 `localCancelled=true` 的 Job，才会：

- 删除这条 Job 历史；
- 从指定表格中移除精确匹配 `jobId` 的 `networkJob` Cell 占位；
- 保留同一 Cell 中已经完成的图片/视频/音频和其他 Job；
- 不删除任何结果文件；
- 不声称远程取消成功。

标准调用：

```bat
node scripts/table_action_client.mjs job.cleanup_stale.preview --token=test-123456 --params="{\"tableId\":\"table_xxx\",\"staleAfterMinutes\":30}"
node scripts/table_action_client.mjs job.cleanup_stale --token=test-123456 --confirmed --params="{\"tableId\":\"table_xxx\",\"staleAfterMinutes\":30}"
```

### 2.4 Windows 旧式 `--params` 容错

CLI 的处理顺序为：

1. 严格 JSON；
2. JSON5 的对象字面量兼容；
3. 去除意外包裹的外层引号；
4. 修复常见 `\"`；
5. 修复 CMD/PowerShell 造成的对象边界反斜杠引号损坏。

解析器只恢复可辨认的 JSON 边界，不使用 `eval`、`Function` 或脚本执行。无法可靠恢复时明确报错并建议 `--params-file` / `--stdin`。

旧命令继续有效：

```bat
node scripts/table_action_client.mjs system.describe_action --validate-only --params="{\"action\":\"row.create\"}"
```

复杂提示词、中文路径和深层数组仍建议使用 UTF-8 JSON 文件，因为 Shell 可能在 Node 收到参数之前就丢失不可恢复的信息。

### 2.5 CLI 响应裁剪

新增：

```text
--select=data.jobs
```

它在客户端收到响应后只打印指定分支，适合脚本和 Agent 减少无关输出。路径不存在时明确失败，不静默返回空值。

## 3. 安全架构

失联判断分成三层：

```text
Renderer 请求清理
  → Main 从 Job Store 读取含凭据的原始 Job
  → Provider Client 查询 ComfyUI Queue / History
  → Main 只返回非敏感分类结果
  → Renderer 复核后更新 Job Store 与 Cell
```

Provider 凭据不会进入 Renderer 或 HTTP 响应。远端查询失败时采取保守策略：保护 Job，不把“无法访问”误判成“已经失联”。

## 4. 修改文件

### 新增

- `network_job_cleanup.js`
- `tests/network_job_cleanup.test.mjs`
- `readme/AI_Table_Studio_v2.6.5_Action_API_Phase4.7_升级报告.md`

### 修改

- `main.js`
- `preload.js`
- `src/App.tsx`
- `agent_api/action_definitions.js`
- `agent_api/table_action_api.js`
- `agent_api/table_action_api_v0.1.schema.json`
- `agent_api/table_action_api.test.mjs`
- `agent_api/table_action_server.test.mjs`
- `agent_api/README.md`
- `scripts/table_action_client.mjs`
- `scripts/table_action_client.test.mjs`
- `package.json`
- `package-lock.json`
- `README.md`
- `readme/00_文档索引.md`
- `readme/Agent_API_标准接管与启动清单.md`
- `readme/v2.6.3后_Agent_API升级报告_Phase1-4.5.md`
- `readme/90_版本记录/README.md`
- `readme/90_版本记录/CHANGELOG_v2.4.8-v2.6.3.md`

## 5. 测试结果

本轮最终验证命令：

```bat
npm run generate:action-schema
npm run test:action-api
npm run test:comfyui
npm run build
npm run lint
```

结果：

- Action API / HTTP / CLI / stale cleanup：`55 / 55` 通过；
- Generation Preview / Empty Reference：`7 / 7` 通过；
- ComfyUI Protocol：`12 / 12` 通过；
- Vite Production Build：通过；
- Windows 旧式 `--params` 原样命令：通过；
- TypeScript：仍只有既有 `src/components/Grid.tsx:7901 TS2347`，本轮没有新增诊断。

运行中的旧 Electron 实例必须重启后才会加载新的 Main/Preload IPC 和 `phase4.7`。重启后 `/health` 预期：

```json
{"ok":true,"service":"ai-table-action-api","version":"0.1","phase":"phase4.7"}
```

## 6. 兼容性与后续 MCP

- 产品版本仍是 `2.6.5`；
- HTTP 地址、Bearer Token 和协议版本 `v0.1` 不变；
- 原启动命令不增加任何必需环境变量；
- 原 `--params`、文件、stdin 和完整请求输入继续兼容；
- Action 数量由 80 增至 82；
- MCP 层可直接复用 Action Definition `1.1`，无需重新实现 stale cleanup 或 CLI 解析逻辑。

Phase 4.7 的重点不是扩张 Provider 路由，而是让高频发现、状态查询和失联任务清理更准确、更省 Token，并保持用户选择的 Workflow 与真实运行任务不被自动干预。
