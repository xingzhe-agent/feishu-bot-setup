# feishu-bot-setup

给本地 agent（ZCode / WorkBuddy / 任意 CLI agent）接入飞书机器人的 skill：从注册应用到实时回复的完整路线，含实测踩坑表和可复用模板。

## 它解决什么问题

把"飞书接机器人"这件事从 1 小时的试错变成几分钟的流程：

- **路线决策**：宿主自带助理（如 WorkBuddy）优先，只有需要独立常驻服务才自建桥
- **权限速查**：4 组 scope + scope-apply 直达 URL 模板（别翻控制台虚拟列表）
- **实测坑位表**：launchd 无 nvm PATH、`event consume` 的 stdin EOF 语义、`lark-cli api` 的 `--params` 语法、IAB 剪贴板被拒、open_id 跨应用、受限 agent shell 里 launchd 必挂……每条都是真实踩过
- **可复用模板**：`bridge.template.mjs`（零依赖 Node ≥18，env 配置，可插拔大脑：OpenAI 兼容 HTTP 秒级 / 任意 agent CLI）+ `agent.plist.template`（LaunchAgent 常驻）

## 安装（ZCode / Claude Code 类 agent）

```bash
git clone https://github.com/xingzhe-agent/feishu-bot-setup \
  ~/.zcode/skills/feishu-bot-setup
# Claude Code 用户改成 ~/.claude/skills/feishu-bot-setup
```

装好后对 agent 说"注册飞书机器人 / 飞书接入 / 机器人没回复"等触发词即可命中。

## 使用

见 [SKILL.md](SKILL.md)——决策表 → 路线 A（官方助理，推荐）/ 路线 B（自建长连接桥，7 步清单）→ 坑位表 → 验收序列。

## 安全

本包不含任何凭证；运行时密钥只应存在于你本机 600 权限的 `llm.json` 或 agent 自己的加密配置中。`.gitignore` 已排除 `llm.json` 与日志，防止克隆后误提交。

## License

MIT
