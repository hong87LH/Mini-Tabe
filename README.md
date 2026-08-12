<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/91089e78-1698-4f15-91ca-4a320ffec6ee

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`


# Version Timeline

**v2.5.x**

v2.5.0  ComfyUI 通用协议
v2.5.1  H3 清晰度映射
v2.5.2  音频附件
v2.5.3  H3 双路由 / 多参考
v2.5.4  多参真实组合验证
v2.5.5  Fast 多参 / 长队列 / 自动启动

**v2.4.x → v2.5.x**

v2.4.9   同模型 Provider 协议切换
v2.4.10  Job 路径 / 修图尺寸修复
v2.4.11  OSS 月流量查询
v2.4.12  .part 完整性 / NAS 文件锁
v2.5.0   ComfyUI Local 架构
v2.5.5   本地 H3 多参生产链路收口