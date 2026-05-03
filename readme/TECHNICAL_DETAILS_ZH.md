# Hong's AI Table Studio - 技术细节

## 1. 项目概述
Hong's AI Table Studio 是一个响应式、纯前端渲染、运行在浏览器中的数据库/电子表格混合应用程序（类似于 Airtable 或 Bitable）。它旨在提供高响应速度、浏览器本地化操作，并具备处理复杂公式计算、数据关联、持久化本地存储能力、以及针对图像的直观审阅和批注功能。

## 2. 技术栈
- **核心框架**: React 19 (Hooks, Context, Portals)
- **开发语言**: TypeScript (`^5.8.2`)
- **构建工具**: Vite (`^6.2.0`)
- **样式方案**: Tailwind CSS (`v4`), `clsx`, `tailwind-merge`
- **图标库**: `lucide-react`
- **数据解析/导出**: `papaparse` (用于 CSV 处理)
- **公式计算引擎**: 结合 `expr-eval` 解析传统数学字符串，以及使用原生 JS `Function` 沙箱执行类似 Excel 的高级命令。
- **持久化存储**: `idb-keyval` (IndexedDB) 以及原生 **File System Access API** (用于将数据自动保存至用户本地硬盘)。

## 3. 架构与目录结构
- `index.html`: HTML 入口文件，包含开屏动画效果和 React 的挂载根节点 (`div`)。
- `main.js` / `preload.js`: 基础结构文件，表明该项目同样可作为原生 Electron 桌面应用进行打包并运行。
- `src/`
  - `App.tsx`: 核心巨型组件，承载了路由、表格导航（左侧侧边栏）、设置、File System Access API 的权限管理以及全局应用状态。
  - `main.tsx`: React 渲染的入口文件。
  - `types.ts`: 共享的 TS 接口文件，定义了 `GridData`, `FieldType`, 及 `Attachment` 架构。
  - `initialData.ts`: 默认数据模板，用于在无任何历史状态时创建新表格时的内容填充。
  - `components/`: 包含所有 UI 组件。
    - `Grid.tsx`: 表格渲染逻辑的核心组件，管理行、列的渲染、各特定字段类型的输入，以及拖拽换位等交互。
  - `lib/`:
    - `utils.ts`: 常规工具库，如 Tailwind 的 `cn()` 样式合并函数。
    - `idb.ts`: `idb-keyval` 的抽象层，允许应用安全地将浏览器端句柄（例如自动保存目录句柄）持久保存于多个浏览器会话中。

## 4. 关键技术实现机制
### 4.1 本地持久化与自动保存
应用程序默认将所有表格缓存至浏览器的 `localStorage` (`bitable_project_cache`) 中。
然而，它同样实现并接入了 **File System Access API** 以构建真正的自动备份闭环。通过获取用户授权的本地目录句柄（`showDirectoryPicker`），应用可以在后台无缝将 `JSON` 结构体数据备份直接写入本地文件夹中。

### 4.2 公式计算引擎 (`src/App.tsx: computeFormulaValue`)
该引擎会在任意记录被更改时进行动态字段计算。
- 引擎通过大括号提取所依赖的值（如：`{Price}`）。
- 对于一般的旧版数学公式结构计算，回退使用 `expr-eval`。
- 对于类 Excel 计算（以 `=` 符号开头的公式），将映射当前行的数据变量，进行特殊字符的全局清理并在严格受限的 `new Function()` 沙箱环境中执行，最终反馈实时的运算数值。

### 4.3 桌面端与本地生态集成 (Electron)
若此应用寄宿在 Electron 壳环境内并作为单独的程序执行：
- **无感本地系统路径解析**: 渲染图像的逻辑可以直接将原始 C 盘 / Mac 本地文件绝对路径读取及转译为 `file://` 协议流。这避免了臃肿且容易导致内存泄漏的 Blob 直传，让程序表现出极端的流畅。
- **IPC 静默下载器**: 为了避开网页版每次在用户进行右下角手动下载保存动作时跳出的烦人 "浏览窗口" 提示，程序利用 `electronAPI.downloadFile` 进行后台无缝集成和写入动作。
- **重构版图像审阅机制 (Annotation)**: `ZoomableImage` 组件封装了一个独立于底层的涂鸦审阅矩阵。用户点击图像时的相对坐标系会被立刻侦测挂载为可视化的图钉标记。其背后衍生的审批状态以及反馈跟帖将直接合并封存回相关的表格记录参数中，实现所见即所得。

### 4.4 开屏动画机制
应用启动的开屏使用了 SVG 路径动画（结合 `stroke-dasharray/offset`）与 CSS 属性的 `fractalNoise` 位移滤镜融合，呈现出极其逼真的手绘纸张效果。在 React 完成渲染以及初始化 JS 引擎后，将会调度 `window.removeInitialSplash()` 以丝滑的显隐过渡剥离该片动画图层。

## 5. 部署细节
因为项目的主要逻辑处于客户端层面，代码将被编译构建为纯静态资源（存放于 `dist` 目录）。
- **构建代码**: 运行 `npm run build` 生成生产所需的 HTML/JS/CSS 等静态数据。
- **本地预览**: 运行 `npm run preview` 唤起本地 Express/Vite 服务查看静态构建版本。
- **项目托管**: `/dist` 中的构建资源可以被轻易且免费地部署至任意前端静态托管平台（Cloudflare Pages, Vercel, Firebase Hosting, GitHub Pages 等等），不需要传统 Node.js 后端服务器的存在。
- **Electron 打包**: 鉴于已包含 `main.js`，可以使用 Electron 框架在本地壳内启动 `index.html`，轻松打包成桌面级别的 `.exe` 或 `.dmg` 程序。
