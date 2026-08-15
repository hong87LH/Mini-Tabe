# ComfyUI 通用协议升级修改报告

> 本文件保留为本次代码修改记录。完整使用与长期维护说明请阅读 `readme\ComfyUI通用协议升级与使用维护手册-v2.5.0.md`。

## 版本信息

- 原版本：`0804-1-修复job下载resize逻辑-v2.4.12`
- 新版本：`0811-ComfyUI通用协议-v2.5.0`
- 原版本处理：保持不变
- 新版本目录：`E:\01_AIGC\00_AIstudio\bitable-clone-配置文件\0811-ComfyUI通用协议-v2.5.0`

## 实现结果

新增了与 Lingwu Provider 并列的 ComfyUI Provider。前台图片和视频任务可以通过统一任务层选择Provider；ComfyUI工作流通过manifest注册，不再把ComfyUI伪装成Lingwu接口。

当前正式注册的工作流：

- ID：`minimax-h3-i2v`
- 前台模型别名：`minimax-h3-local`
- 分辨率：`0.7MP`、`0.9MP`
- 比例：`16:9`、`3:4`
- 快速模式：Turbo LoRA、6步、Euler
- 质量模式：关闭Turbo、20步、res_multistep
- 输入：一张首帧图片，可选第二张尾帧图片
- 输出：MP4，可选是否连接模型音轨

## 新增文件

### `provider_registry.js`

统一Provider工厂，根据任务的 `provider` 字段实例化 LingwuClient 或 ComfyUIClient。

### `comfyui/comfyui_client.js`

实现：

- ComfyUI健康检查
- 本地、UNC、HTTP和data URL图片读取
- `/upload/image`素材上传
- `/prompt`工作流提交
- `/queue`与`/history`状态查询
- SaveImage/SaveVideo类输出解析
- `/view`结果地址生成
- 0.7/0.9MP、16:9/3:4、fast/quality、时长、种子、声音参数转换

### `comfyui/workflow_registry.js`

实现工作流manifest发现、模型别名匹配、fast/quality模板选择、带BOM JSON兼容和安全节点参数写入。

### `comfyui/workflows/minimax-h3-i2v/manifest.json`

声明MiniMax H3的能力、参数映射、节点绑定、模型别名和输出节点。

### 工作流模板

- `comfyui/workflows/minimax-h3-i2v/fast_api.json`
- `comfyui/workflows/minimax-h3-i2v/quality_api.json`

### 测试与说明

- `tests/comfyui_protocol.test.mjs`
- `scripts/check_comfyui_protocol.mjs`
- `readme/ComfyUI通用协议使用说明.md`

## 修改文件与位置

### `media_job_runner.js`

- 约第4行：引入Provider工厂。
- 约第95行：从前台任务读取并规范化Provider。
- 约第99行：任务记录保存真实Provider。
- 约第128行：ComfyUI本地素材绕过OSS。
- 约第159行：仅远程Provider执行OSS清理。
- 约第171行：Lingwu参数映射与ComfyUI manifest映射分离。
- 约第181行：通过Provider工厂创建客户端。

### `network_polling.js`

- 约第2行：引入Provider工厂。
- 约第55行：任务恢复和轮询时根据 `job.provider` 选择客户端。

### `src/components/Grid.tsx`

- 约第3307行：图片任务允许选择ComfyUI Provider。
- 约第3362行：图片任务提交Provider字段。
- 约第3522行：视频任务允许Lingwu或ComfyUI Provider。
- 约第3570行：视频任务提交Provider字段。
- 约第5771行：新增0.7MP和0.9MP选项。
- 约第5870行：新增3秒和8秒选项。

### `src/components/ApiSettings.tsx`

- 约第314行：Provider列表新增 `ComfyUI Local`。

### `src/App.tsx`

- 约第413行：新增旧配置迁移函数。
- 约第1022行：读取旧设置时自动追加本地ComfyUI配置。
- 默认配置：endpoint `http://127.0.0.1:8188`，model `minimax-h3-local`，无需API Key。

### `main.js` 与 `preload.js`

- 新增只读 `check-comfyui` 健康检查IPC，供前台或诊断工具使用。
- 保留现有Electron和Lingwu调用接口，避免破坏兼容性。

### `package.json` 与 `package-lock.json`

- 版本更新为 `2.5.0`。
- 打包文件列表增加 `provider_registry.js` 和 `comfyui/**/*`。
- 保留原产品名 `LingwuApp`，不改变现有Electron打包体系。

## 验证结果

- JavaScript语法检查：通过
- TypeScript `tsc --noEmit`：通过
- Vite正式构建：通过
- ComfyUI协议测试：5项全部通过
- 已模拟验证：本地图片上传、0.9MP、3:4、quality 20步、3秒、固定种子、关闭音轨、提交prompt、解析MP4结果地址
- MiniMax H3 真实调用：已完成；用户已确认从新版工具调用成功

## 兼容性与限制

- Lingwu原流程继续保留。
- 当前正式注册的是MiniMax H3视频工作流；图片Provider通路已经支持，但使用具体图片工作流前仍需添加对应manifest和API工作流。
- ComfyUI关闭会中断正在采样的任务。
- 不建议把任意未经审核的工作流JSON直接暴露给前台，应通过manifest白名单注册。
- 依赖审计显示原依赖树存在历史安全告警；本次未运行可能带来破坏性升级的 `npm audit fix --force`。

## 最终验收步骤（已完成）

1. 已启动ComfyUI并确认 `http://127.0.0.1:8188` 可访问。
2. 已重启并进入新版工程。
3. 已确认并使用本地ComfyUI配置。
4. 已使用 `minimax-h3-local` 成功提交真实任务。
5. 用户已确认调用成功，核心协议链路验收通过。
