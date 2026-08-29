# AI Table Studio v2.6.3 Agent API 探索分支 · exp2

## 本轮目标

Phase 1 已完成真实 localhost API → Electron → 表格 → Undo 验证。本轮进入 **Phase 2：Media Action API**，让后续 Codex 能理解并操作 AI Table 的媒体实例，而不是只看到路径字符串。

## Phase 1 实测补充

真实 Agent 测试暴露出列位置调整缺少 `field.reorder`。exp2 rev2 已补充该 Action，支持 `beforeFieldId / afterFieldId / toIndex` 三种定位方式，权限为 `write:schema`，保持确认门与 Undo。

## 新增 Action

```text
field.reorder
media.get
media.attach
media.copy_instance
media.list_by_row
media.get_effective_context
```

### media.get

读取指定 Cell 的真实媒体实例，返回：

```text
路径 / URL
媒体类型
cropData
trimData
原持久化 item
```

会剔除 `mappedUrl / refUrls / refCells` 等预览临时数据。

### media.attach

向附件 / AI Image / AI Video 等媒体字段添加新的本地路径或 URL。

为了避免 Agent 绕过现有 Crop / A-B 校验，Phase 2 **不允许通过 media.attach 直接注入 `cropData / trimData`**。

### media.copy_instance

专门用于复制已有媒体实例。复制时完整保留：

```text
图片 → cropData
视频 / 音频 → trimData
批注 / rating / status 等持久化实例属性
```

预览态数据不会一起复制。

### media.list_by_row

读取某一行所有媒体字段，让 Agent 能先理解“这一行有哪些图片 / 视频 / 音频”。

### media.get_effective_context

按照现有智能字段模板逻辑解析当前行真正会被 AI 节点使用的媒体上下文，返回独立编号：

```text
<Picture 1>
<Video 1>
<Audio 1>
```

支持：

```text
AI Text
AI Image
AI Video
普通 Text + temporaryReferenceFieldId
```

普通文本的临时参考只参与读取，不写入 Field Config。

## 安全策略

Phase 2 延续 Phase 1 原则：

- 不直接修改 React Grid State；
- 写入仍经过现有 workspace + setTables；
- 保持现有 Undo；
- 不允许任意注入 Crop / Trim JSON；
- 不开放删除、OSS 清理、密钥与 Shell；
- 后续生成仍留给 Phase 3 的 `generation.run / job.*`。

## 测试

```text
npm run test:action-api
```

当前：**17 / 17 通过**。

新增测试覆盖：

- field.reorder 前移 / 后移 / toIndex 与确认门；
- Phase 2 capabilities；
- 图片 cropData 读取；
- 视频 trimData 读取；
- 复制媒体实例保留 Crop / Trim；
- media.attach 禁止直接注入编辑参数；
- 行级媒体枚举；
- AI Video Effective Media Context；
- 普通文本临时参考上下文。

真实工程测试步骤见：

```text
agent_api/PHASE2_TEST_GUIDE.md
```

## 下一阶段

Phase 2 真实工程验收通过后进入：

```text
Phase 3
Generation / Job Center API

query rows
→ get effective media context
→ generation.run
→ Job Center
→ job.list / job.get / job.retry / job.cancel
```
