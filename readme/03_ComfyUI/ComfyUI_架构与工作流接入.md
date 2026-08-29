# ComfyUI 架构与工作流接入

适用工程：AI Table Studio v2.6.3 后续分支  
最后核对：2026-08-24

## 1. 设计目标

ComfyUI 是与远程 Provider 并列的本地 Provider，不伪装成 Lingwu 或其他远程协议。新增普通工作流时优先增加 Manifest 与 API JSON，不为每个模型复制一套任务、轮询和下载代码。

```text
AI Table Studio 字段
  → Provider Registry
  → Media Job Runner
  → ComfyUI Client
  → Workflow Registry
  → Manifest + Fast/Quality API JSON
  → ComfyUI /prompt
  → /queue + /history + /view
  → Job Center / 下载 / Cell 写回
```

## 2. 关键文件

| 文件 | 职责 |
|---|---|
| `provider_registry.js` | 根据 Provider 创建远程或 ComfyUI Client |
| `media_job_runner.js` | 统一任务提交、素材准备与结果归档 |
| `network_polling.js` | 恢复、轮询和 Job/Generation 事件 |
| `comfyui/comfyui_client.js` | 参数规范化、素材上传、Prompt 提交、状态和结果解析 |
| `comfyui/workflow_registry.js` | 扫描 Manifest、匹配别名、加载模板、设置节点值 |
| `comfyui/plugin_catalog.json` | 节点类型到核心/插件的机器可读映射 |
| `comfyui/workflows/*/manifest.json` | 工作流能力、Alias、模板、Binding、插件要求 |
| `comfyui/workflows/*/*_api.json` | ComfyUI API Format 工作流模板 |
| `scripts/check_comfyui_protocol.mjs` | 当前工作流和 ComfyUI 环境检查 |
| `tests/comfyui_protocol.test.mjs` | 不付费的协议回归测试 |

## 3. 当前工作流目录

```text
comfyui/workflows/
  minimax-h3-i2v/
    manifest.json
    fast_api.json
    quality_api.json

  minimax-h3-reference-router/
    manifest.json
    fast_api.json
    quality_api.json
```

目录名只用于组织；模型匹配以 Manifest 的 `id` 和 `aliases` 为准。

## 4. Manifest 的稳定职责

一个 Manifest 至少声明：

- 唯一工作流 ID 和兼容 Alias；
- Provider 与输出媒体类型；
- Fast/Quality 模板文件；
- 默认模式、分辨率、比例、时长、声音；
- 图片/视频/音频输入上限；
- 支持的比例、清晰度、模式和时长；
- 前台语义参数到 API JSON 节点输入的 Binding；
- 输出节点；
- 必需节点和插件。

Manifest 是“前台语义合同”，API JSON 是“当前 ComfyUI 节点实现”。两者必须一起版本化和测试。

## 5. 新增工作流的标准流程

1. 在 ComfyUI 页面中独立完成真实生成。
2. 导出 **API Format** JSON，不使用只包含画布布局的普通工作流 JSON。
3. 在 `comfyui/workflows/<新工作流>/` 建立独立目录。
4. 放入一个或多个 API JSON 模板。
5. 编写 Manifest，先声明最小能力和明确 Alias。
6. 从导出的 JSON 核对每一个节点 ID、`class_type` 和输入字段名。
7. 把必需节点加入 `requiredNodeTypes`，把来源加入 `pluginRequirements` 和 `plugin_catalog.json`。
8. 为 Registry/Binding/输入路由/输出解析增加协议测试。
9. 运行 `npm run test:comfyui`。
10. 启动真实 ComfyUI，运行 `npm run check:comfyui`。
11. 用低成本参数完成至少一次真实生成，并记录实际输出尺寸、时长和文件。

## 6. 哪些扩展通常不需要修改 Client

- 新增普通文本到图像或图像到视频工作流；
- 更换模型文件或采样参数；
- 增加同结构的 Fast/Quality 模板；
- 增加新的比例、分辨率映射或模型 Alias；
- 改变保存节点，但仍能从 ComfyUI History 返回标准 `filename/subfolder/type`。

## 7. 哪些情况需要扩展 Client

- 新增此前未支持的素材类型；
- 一个前台参数需要动态创建/删除节点；
- 复杂的多参考编号与 Prompt Token；
- 特殊上传协议或非标准结果结构；
- 一个任务需要串联多套工作流；
- 输出无法通过标准 History/View 获取。

扩展时仍应保持 API 外部语义稳定，把节点细节限制在 ComfyUI 适配层。

## 8. 与 Agent API 的关系

Agent 不直接调用 `/prompt`，也不直接修改工作流 JSON。标准链路是：

```text
field.configure_ai
  → generation.get_capabilities
  → generation.preview
  → generation.run
  → Job Center
  → job.get / batch.get / SSE
```

`generation.preview` 应先展示最终模型、Provider、媒体引用、Crop/Trim、清晰度、比例、时长、输出路径与费用可能性。`generation.run` 继续复用 Grid 已验证的 ComfyUI Runtime。

## 9. 安全边界

- 不把未经审核的任意工作流 JSON 直接暴露为 Agent Action。
- Agent API 不返回 Provider Key、OSS Secret 或本地凭据。
- ComfyUI Local 通常不需要 API Key，但仍只由本机配置决定 Endpoint。
- 工作流输出必须进入现有 Job、下载和 Cell 写回通道。
- 更新 API JSON 前备份当前可运行模板，并重新核对 Manifest Binding。

## 10. 发布验收

- [ ] API Format JSON 在 ComfyUI 独立成功。
- [ ] ID/Alias 不与现有工作流冲突。
- [ ] Fast/Quality 模板与 Manifest 来自同一版本。
- [ ] Required Nodes 与 Plugin Catalog 完整。
- [ ] `npm run test:comfyui` 全部通过。
- [ ] `npm run check:comfyui` 无缺失节点。
- [ ] 低成本真实生成成功并检查实际文件。
- [ ] Job Center、下载、恢复和 Cell 写回正常。
- [ ] Agent `generation.preview/run` 与 UI 行为一致。
- [ ] 当前文档和版本记录已更新。

