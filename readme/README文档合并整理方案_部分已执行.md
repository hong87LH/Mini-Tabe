# AI Table Studio README 文档合并整理方案（部分已执行）

状态：用户已确认并完成 ComfyUI 文档、产品升级日志与 ComfyUI 测试恢复；用户手册、模型 API 参数和技术文档仍保持原位，等待后续确认。

## 1. 审查结论

当前 `readme/` 同时混放了用户手册、开发说明、版本需求、版本日志、一次性升级报告、测试记录和中英文参数参考。新增两份 Agent API 文档后，顶层共有 31 个 Markdown 文件；此外 `agent_api/` 还有 9 份协议和阶段文档。

主要问题：

1. 没有统一索引，用户、维护者和 Agent 不知道哪份是当前权威入口。
2. 根 `README.md` 的 Latest Release 仍停在 v2.5.7，但前文已经加入 v2.6.3 与 Agent API Phase 4.5。
3. `v2.5.10升级说明.md` 与 `v2.5.10修改日志.md` 内容和 SHA256 完全相同。
4. `Hongs_AI_Table_Studio_v2.4.8_完整使用指南.md` 很完整，但版本过旧，不适合继续作为当前使用入口。
5. 多份“升级说明/测试报告”既承担历史记录，又被当成当前使用说明，导致新旧结论混在一起。
6. 中文/英文文档命名方式不统一，无法快速判断是否互为翻译。
7. 产品版本、API Phase、ComfyUI 工作流版本没有分层，容易把 `phase4.5` 误解为应用版本。

## 2. 建议的目标结构

```text
readme/
  00_文档索引.md

  01_开始使用/
    AI_Table_Studio_用户手册_ZH.md
    AI_Table_Studio_User_Manual_EN.md

  02_Agent_API/
    Agent_API_标准接管与启动清单.md
    v2.6.3后_Agent_API升级报告_Phase1-4.5.md

  03_ComfyUI/
    ComfyUI_快速开始与日常运行.md
    ComfyUI_架构与工作流接入.md
    ComfyUI_MiniMax_H3_参数与路由.md
    ComfyUI_测试与故障排查.md

  04_模型API参数/
    Image_API_Parameter_Reference_Guide_ZH.md
    Image_API_Parameter_Reference_Guide_EN.md
    Video_API_Parameter_Reference_Guide_ZH.md
    Video_API_Parameter_Reference_Guide_EN.md

  05_开发维护/
    TECHNICAL_DETAILS_ZH.md
    TECHNICAL_DETAILS_EN.md

  90_版本记录/
    CHANGELOG_v2.4.8-v2.6.3.md
    CHANGELOG_Agent_API_Phase1-4.5.md

  99_历史归档/
    版本需求/
    版本快照/
    ComfyUI阶段报告/
```

`agent_api/README.md`、JSON Schema 和 Phase 测试指南继续留在代码旁，不移动；`00_文档索引.md` 链接过去。这样人类入口清晰，同时不破坏 API 打包和代码邻近文档。

## 3. 合并规则

权威来源顺序建议固定为：

1. 当前代码、Manifest、JSON Schema 和可执行检查结果。
2. 当前模块 README，例如 `agent_api/README.md`。
3. 最新版本使用/维护手册。
4. 历史升级报告和测试记录，只作为变更证据，不覆盖当前事实。

每份当前文档顶部增加：适用版本、最后核对日期、事实来源、是否为当前入口。历史文档顶部统一增加“历史快照，不作为当前配置依据”的提示。

整理时先复制/移动到归档，不直接删除。唯一可直接去重的候选是内容完全相同的 v2.5.10 两份文件，但仍建议先保留一个归档副本。

## 4. ComfyUI 专项合并方案

### 4.1 当前代码事实

本次实查结果：

- `npm run check:comfyui` 成功连接 `http://127.0.0.1:8188`。
- ComfyUI 版本 `0.31.0`，当前节点检查无缺失。
- 当前注册两套工作流：
  - `minimax-h3-first-last-router`，前台主别名 `minimax-h3-local`；支持 0–2 张图片，即文生、首帧、首尾帧。
  - `minimax-h3-reference-router`，前台主别名 `minimax-h3-Ref-local`；支持图片、视频、独立音频混合参考。
- 两套工作流均支持 8 种比例、360P/480P/720P/1080P、0.1–16MP 原始数值、3/5/8/10/15 秒、Fast/Quality。
- Fast 为 6 步 Euler，Quality 为 20 步 `res_multistep`。
- 当前四个 API 模板的 `ResolutionSelector.multiple` 都是 `32`。
- 多参 Fast 依赖 `H3TurboMixedReferenceFix`，由 `Hongs-node` 提供。

### 4.2 已发现的旧文档冲突

`ComfyUI通用协议使用说明.md` 仍写：

- 只正式注册 `minimax-h3-i2v`；
- 至少需要一张图片；
- 主要参数是 0.7/0.9MP；
- 只列 16:9 与 3:4。

这些属于 v2.5.0 历史状态，不能继续作为当前快速入口。

`ComfyUI智能路由升级测试报告-v2.5.4.md` 记录“混合参考 Fast 可能失败，应选 Quality”的阶段性结论；后续 Hongs-node 已把修正节点接入正式 Fast 路由，因此这段必须标记为历史问题演进，不能保留为当前操作建议。

`ComfyUI通用协议升级与使用维护手册-v2.5.0.md` 中“仅注册图生视频”等结论也已过期，但其中 Provider 分层、Manifest 结构、工作流接入、排错和备份章节仍很有价值，应抽取后更新，不应整份丢弃。

### 4.3 建议形成四份当前文档

#### A. `ComfyUI_快速开始与日常运行.md`

合并来源：

- `ComfyUI通用协议使用说明.md`
- `ComfyUI默认工作流必备插件清单.md`
- `v2.5.5升级说明.md` 中的自动启动/长队列内容

只保留用户每天需要的内容：启动顺序、8188 健康检查、两个前台模型的选择规则、常用参数、插件检查和最短排错。

#### B. `ComfyUI_架构与工作流接入.md`

合并来源：

- `ComfyUI通用协议升级与使用维护手册-v2.5.0.md`
- `升级修改报告-ComfyUI通用协议-v2.5.0.md`
- 当前 `workflow_registry.js`、两个 Manifest 和 `plugin_catalog.json`

保留 Provider → Registry → Manifest → API JSON → Job/Download 的稳定架构；把旧目录、旧节点 ID 和旧“仅一套工作流”结论移入历史附录。

#### C. `ComfyUI_MiniMax_H3_参数与路由.md`

合并来源：

- `ComfyUI清晰度映射升级与测试说明-v2.5.1.md`
- `ComfyUI双路由升级测试报告-v2.5.3.md`
- `ComfyUI智能路由升级测试报告-v2.5.4.md`
- `Hongs-node集成与测试记录-20260812.md`
- 当前两个 Manifest 和四个 API 模板

统一说明：

```text
前台清晰度档位
→ 按画幅换算目标 MP
→ ResolutionSelector
→ multiple 对齐
→ 实际输出尺寸
```

明确区分当前实现值（本目录模板目前为 `multiple=32`）与历史实测值；路由表只保留当前有效的 0/1/2 图及多参素材规则。Hongs-node 的失败—实验—正式接入过程移到历史小节。

#### D. `ComfyUI_测试与故障排查.md`

合并来源：

- v2.5.0 维护手册的测试与排错章节
- v2.5.3/v2.5.4/Hongs-node 的真实测试矩阵
- `ComfyUI默认工作流必备插件清单.md` 的错误映射

测试结果分成三类，避免互相冒充：

1. 静态注册/模板检查。
2. 本机 ComfyUI Health 与节点检查。
3. 真实生成、耗时、显存与输出文件验证。

该工程一致性问题已处理：从同项目 `0812-ComfyUI稳定多参-v2.5.5` 快照恢复 `tests/comfyui_protocol.test.mjs`，并在当前代码上验证 11/11 通过。

### 4.4 ComfyUI 历史文件处理

以下文件完成内容抽取后移动到 `99_历史归档/ComfyUI阶段报告/`，不删除：

- `升级修改报告-ComfyUI通用协议-v2.5.0.md`
- `ComfyUI通用协议升级与使用维护手册-v2.5.0.md`
- `ComfyUI通用协议使用说明.md`
- `ComfyUI清晰度映射升级与测试说明-v2.5.1.md`
- `ComfyUI双路由升级测试报告-v2.5.3.md`
- `ComfyUI智能路由升级测试报告-v2.5.4.md`
- `Hongs-node集成与测试记录-20260812.md`

`ComfyUI默认工作流必备插件清单.md` 的当前内容先并入快速开始与排错文档；机器可读事实继续以 `comfyui/plugin_catalog.json` 为准。

## 5. 其他文档的具体去向

### 当前用户文档

- `USER_MANUAL_ZH.md` / `USER_MANUAL.md`：移动到 `01_开始使用/`，统一 ZH/EN 命名并核对版本。
- `Hongs_AI_Table_Studio_v2.4.8_完整使用指南.md`：抽取仍独有的长篇操作说明后归档，不能继续当当前总手册。

### Agent API

- 新增的两份文档移动到 `02_Agent_API/`。
- `agent_api/README.md` 保持当前 API 权威入口。
- Phase 2/3/3.5/4.5 实施与测试文件保留在 `agent_api/`，索引中标注“阶段历史/回归依据”。

### API 参数参考

- Image/Video 的中英文四份文件移动到 `04_模型API参数/`。
- 中英文版采用相同英文主名与 `_ZH/_EN` 后缀，避免 `USER_MANUAL.md` 这种语言不明命名。

### 开发文档

- `TECHNICAL_DETAILS_ZH.md` / `TECHNICAL_DETAILS.md` 移动到 `05_开发维护/`。
- 合并重复结构，但保留中英文两个发布文件。

### 版本与需求

- `v2.5.2`、`v2.5.5`、`v2.5.7`、`v2.5.8`、`v2.5.9`、`v2.5.10`、`v2.6.1`、`v2.6.2`、`v2.6.3` 升级说明合并成一个按版本检索的 Changelog；原文件进入版本快照归档。
- `Hongs_AI_Table_Studio_v2.5.5-v2.5.10_完整更新记录.md` 作为 Changelog 的主要素材，合并完成后归档。
- `v2.4.11到v2.5.5完整文件变更清单.md` 移入历史版本快照。
- `Hongs_AI_Table_Studio_v2.5.10_版本需求_重整版.md` 属于需求设计文档，移入 `99_历史归档/版本需求/`。
- `v2.5.10升级说明.md` 与 `v2.5.10修改日志.md` 完全相同，只保留一份内容进入 Changelog，另一份在备份后去重。

## 6. 建议执行顺序

原计划分四个小批次执行；当前状态如下：

1. 已创建局部目录和 `00_文档索引.md`。
2. 已完成四份 ComfyUI 当前文档，并对照 Manifest、插件目录和实际检查结果验收。
3. 已合并产品版本记录、移动历史快照，并处理完全重复的 v2.5.10 文件。
4. 已更新根 `README.md` 的 ComfyUI 入口、Latest Release 和 Version Timeline；全量文档重排仍未执行。

## 7. 验收标准

- 新用户从索引最多两次点击到达启动、ComfyUI、Agent API 或参数参考。
- 当前文档不再引用旧工程绝对路径作为操作入口。
- 当前 ComfyUI 文档只描述两套现有 Manifest 的能力。
- 旧测试结论保留但明确标注历史版本。
- 所有相对链接可解析。
- 根 README、`package.json`、API Phase 和 Changelog 的版本含义被明确区分。
- `npm run test:action-api` 保持通过。
- `npm run test:comfyui` 已恢复并通过 11/11。

## 8. 后续仍需用户确认的范围

如果继续整理剩余文档，建议再确认：

1. 是否把用户手册、模型 API 参数和技术文档也移动到上述数字目录。
2. 是否把 `Hongs_AI_Table_Studio_v2.4.8_完整使用指南.md` 抽取后归档。
3. 是否统一中英文文件名及修正 `package.json.version` 与 v2.6.3 文档基线的差异。
