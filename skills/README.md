# Skills

将包含 `SKILL.md` 的 Skill 文件夹复制到本目录后，在应用的“API 和模型配置 → Skills”中点击“扫描目录”即可自动发现并注册。

Skill System v1.0 支持：

- `SKILL.md`
- `references/` 下的文本类参考资料（`.md` / `.txt` / `.json` / `.yaml` / `.yml`）
- `agents/openai.yaml` 中的 `display_name` / `short_description` / `default_prompt` 作为可选 UI 元数据
- GitHub 公开 Skill 目录安装

v1.0 不执行 `scripts/`、Shell、Python、MCP 或其他工具调用。存在这些目录时只做识别，不执行。
