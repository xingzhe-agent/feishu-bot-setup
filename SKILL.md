---
name: feishu-bot-setup
description: 把飞书接到 WorkBuddy 或本地 agent。默认走 WorkBuddy 官方「飞书助理」（零代码、可远程派任务并执行），仅在需要独立常驻服务时自建长连接机器人桥。触发词：飞书机器人、飞书助理、注册机器人、lark bot、飞书接入、机器人没回复、飞书开放平台、scope-apply、长连接桥、权限 99991672。含新旧两套官方流程、批量导入权限、7 步建桥清单、实测坑位表、可复用模板。
---

# 飞书助理 / 机器人接入

**先选路线，再动手。** 两条路线最终都要在飞书开放平台建一个应用，但常驻运行时和「大脑」完全不同。

> 本 skill 不含任何凭证、app_id 或个人路径。所有密钥只应存在于使用者的配置界面 / 600 权限本地文件中。

## 决策表

| 你的需求 | 选哪条 | 成本 |
|---|---|---|
| 在飞书里远程指挥 WorkBuddy 干活、拿文件、跑技能 | **路线 A：官方飞书助理（默认）** | 几分钟，零代码 |
| 需要脱离 WorkBuddy 客户端的 7×24 服务、完全自定义回复逻辑 / 模型后端 | 路线 B：自建长连接桥 | 脚本 + 常驻进程 + 模型后端 |
| 只是想在对话里用飞书读写消息 | 不用本 skill，直接用飞书连接器（`lark-im` 等） | 零配置 |

**路线 A 与 B 绝不能共用一个 app_id**：同一应用的多个长连接消费者会互相抢消息，表现为「时回时不回」。二选一，或各建各的应用。

## 核心认知（动手前必读）

1. **先查宿主有没有原生能力，再考虑自建。** 本 skill 早期版本直接教人自建桥，结果绕了一整圈：WorkBuddy 自带「助理（远程任务）」，客户端本身就是常驻运行时，大脑是完整 agent（能调技能、连接器、本地文件、专家）。自建桥是重复造轮子，只回文字，还要自己解决常驻和模型后端。
2. **连接器 ≠ 大脑。** 飞书连接器（`lark-cli` + 一堆 `lark-*` skill）只负责**读写飞书**（发消息、读事件流），不负责生成回复，且只在 agent 会话内可调用。一个独立后台进程既调不到连接器的工具，也调不到当前会话里的模型。
3. **一个 app_id 一个消费者**。多桥 / 桥与官方助理并存 = 消息分流。
4. **权限凑不齐是常态**：控制台不会列全前置 scope。通用姿势是「调 API → 报错 `99991672` → 复制错误 hint 里的 scope-apply URL → 浏览器打开 → 一键开通（免审）」。不要在权限选择器里翻虚拟列表，DOM 勾选不可靠。
5. **凭证不要出现在对话、日志、脚本或分享包里**。App Secret 与 Encrypt Key 等同密钥。
6. **轮询是噪声，长连接才是产品形态**：定时任务轮询会空转刷屏；长连接桥 / 官方助理沉默且实时。

---

# 路线 A：WorkBuddy 官方飞书助理（推荐）

**它能做什么**：手机飞书发一句话 → 电脑上的 WorkBuddy 自动执行任务（读写本地文件、跑脚本、用连接器、交付产物）→ 结果回到飞书会话。
**前提**：电脑开机、联网、WorkBuddy 正在运行且「助理」远程控制已开启；飞书账号有创建应用的权限。

官方入口：**左侧「助理」栏 → 齿轮 / 头像 → 设置 → 助理设置 → 飞书集成 → 配置**。
界面与字段会随版本变化，**以设置页当前提示为准**；下文两套流程按可用性择一。

## A1 新版流程（2026-06 起，约 2 分钟，优先试这个）

1. WorkBuddy 里点开「飞书集成 → 配置」，弹窗要求 App ID / App Secret。
2. 打开 `https://open.feishu.cn/`，用顶部「**创建飞书智能体应用**」入口 →「立即创建」。新版入口会自动完成机器人能力、权限、事件订阅等过去要手配的项，**不要再按旧教程从零建 Bot**。
3. 填应用名称（如「WorkBuddy 助理」）+ 头像 → 立即创建。
4. 复制页面展示的 App ID 和 App Secret（不要发群、不要截图公开）。
5. 回到「注册飞书通道」弹窗，选「**WebSocket 长连接**」（个人 / 办公室 / 无公网 IP 首选，不需要公网地址和回调 URL），填凭证 →「注册」，状态显示「已连接」。
6. 点「打开应用」，在飞书里发一句只读测试任务（如「和 WorkBuddy 连接成功了吗？」）。飞书里收到回复、WorkBuddy 里能看到对应会话，即通。

## A2 经典手动流程（新版入口不可用 / 企业策略限制时）

按顺序做，全部在飞书开放平台 `open.feishu.cn/app` + WorkBuddy 之间来回：

| 步 | 位置 | 动作 |
|---|---|---|
| 1 | 开发者后台 | 创建**企业自建应用**，填名称 / 描述 / 图标 → 创建 |
| 2 | 应用详情 | 「添加应用能力」→ 机器人 → 添加 |
| 3 | 权限管理 | 「批量导入 / 导出权限」→ 清空输入框 → 粘贴**官方当前整段权限 JSON** → 确定新增权限 |
| 4 | 凭证与基础信息 | 取 App ID、App Secret |
| 5 | 事件与回调 → 加密策略 | 生成 / 记录 Encrypt Key、Verification Token |
| 6 | WorkBuddy 助理设置 | 飞书集成 → 填 App ID / App Secret / Encrypt Key → 选 WebSocket 长连接 →「注册」→「已连接」 |
| 7 | 事件与回调 | 订阅方式 =「使用长连接接收事件」→ 点「验证」→「连接成功」；URL 回调模式改为填 WorkBuddy 生成的 Webhook（**https**） |
| 8 | 事件配置 | 添加事件 → 搜「接收消息」→ 添加 `im.message.receive_v1` |
| 9 | 回调配置 | 搜「**卡片回传交互**」→ 确认添加（漏了会导致卡片按钮无响应，是最常漏的一步） |
| 10 | 版本管理与发布 | 创建版本（1.0.0）→ 发布 → 管理员 / 免审规则下自动通过 → 状态「已启用」 |

> 第 3 步的权限清单会随版本变化，**从官方文档复制当前整段 JSON，不要手抄本文**：
> `https://www.codebuddy.cn/docs/workbuddy/Assistant-Guide`（飞书接入指南）
> 清单覆盖 tenant 侧（通讯录、消息、群组 @、卡片 cardkit、应用自管理）与 user 侧（文档 / 多维表格 / 日历 / 任务 / 云空间等）。只做消息收发的最小集也要有 `im:message`、`im:message.group_at_msg:readonly`、`im:message.p2p_msg:readonly`、`im:message:send_as_bot`、`im:message:readonly`、`im:chat:read`、`cardkit:card:read/write`。

## A3 验收与排障

1. 飞书搜索应用名 → 能搜到 = 已发布；搜不到 = 版本没发布或未通过审批。
2. 私聊发一条**只读**任务（先别派会改文件的活）→ 应收到 WorkBuddy 的执行结果，且桌面端「助理」标签出现对应会话。
3. 没响应按此顺序查：应用是否已发布 → WorkBuddy 是否在运行且助理服务开启 → 卡片回传交互回调是否添加 → 长连接「验证」是否显示连接成功 → App ID / Secret 有无多余空格 → URL 回调地址是否 https 且正确 → 企业审批是否通过 → 权限是否整段导入。
4. **远程任务 ≠ 普通任务**：固定使用「助理」专属文件夹、只有一个会话、上下文不可清空、保留完整执行记录。本地操作仍优先用主界面普通任务。
5. 电脑休眠 / 断网 / 退出 WorkBuddy 会中断远程访问；长期任务建议接电源、阻止休眠，必要时开启锁屏远程或用一台常开主机。

---

# 路线 B：自建长连接桥（高级，默认不推荐）

**先确认你真的需要它**：只有当你要把机器人部署成不依赖 WorkBuddy 客户端的独立服务、或要完全掌控回复逻辑 / 模型后端时才走这条。
**代价清单**（实测）：需要自己解决常驻（launchd）、自己准备并付费模型后端、只能回文字（没有技能 / 文件 / 工具能力）、CLI 大脑单次回复约 30 秒、从受限 agent shell 启动会继承沙箱导致一堆诡异错误。

依赖：Node >= 18、飞书连接器的 `lark-cli`（`config list` / `auth status` 可用）、一个已发布的飞书自建应用。

## B1~B7 清单

1. **创建应用**：`open.feishu.cn/app` → 创建企业自建应用。图标若无 aria 标签，`div.rounded-1.cursor-pointer` 按 DOM 序 = 视觉序，第 2 个通常是机器人；不确定就截图视觉确认。登录页扫码后会自动跳回。
2. **开机器人能力**：添加应用能力 → 机器人 → 添加。页面 alert 列出的权限**不全**，见核心认知 4。
3. **权限**：按报错逐步补齐。scope-apply 模板（**从错误 hint 抄，别手拼**）：
   `https://open.feishu.cn/page/scope-apply?clientID=<APP_ID>&scopes=<逗号分隔的scope列表>`
   | 家族 | scope 示例 | 何时发现缺 |
   |---|---|---|
   | 消息读写 | `im:message` / `im:message:readonly` | 建机器人时的推荐弹窗 |
   | 会话列表 | `im:chat` / `im:chat:readonly` / `im:chat:read` | `GET /im/v1/chats` 报错 |
   | 私聊 / 群 @ 事件 | `im:message.p2p_msg:readonly` / `im:message.group_at_msg:readonly` | event schema 或消费器 stderr |
   | 发消息 | `im:message:send` / `im:message:send_as_bot` | `POST /im/v1/messages` 报错 |
   一键开通页记得勾「一并开通消息与群组的免审权限」。
4. **事件订阅**：事件与回调 → 订阅方式 =「使用长连接接收事件」→ 添加事件 → 搜「接收消息」→ `im.message.receive_v1` → 确认（推荐权限一起开）。
5. **凭证 → lark-cli profile**：凭证页 App Secret 行有三个图标按钮，**逐个悬停看 tooltip 区分**：复制 / 显示 / 重置。**别点重置**（会使现有 Secret 立即失效；按钮位置随窗口宽度变化，不要按坐标找）。
   内置浏览器剪贴板写入常被拒，兜底：页内 `evaluate` 读 `.secret-code__code` → 写 600 权限临时文件 → stdin 喂完即删：
   ```bash
   umask 077
   lark-cli config init --app-id <APP_ID> --app-secret-stdin --name <APP_ID> < /tmp/.secret.tmp && rm -f /tmp/.secret.tmp
   lark-cli auth status --profile <APP_ID> --json   # 期望 bot identity: ready
   ```
   `config init` 是追加 profile，不会覆盖已有应用。
6. **发布**：版本管理与发布 → 创建版本（表单已预填）→ 可用范围「部分成员（仅所有者）」= **免审** → 保存 → 确认发布 → 状态「已启用」。不发布则在飞书里搜不到。
7. **部署桥**：用本 skill 的 `scripts/bridge.template.mjs` + `scripts/agent.plist.template`。桥靠环境变量配置（`FEISHU_APP_ID` / `FEISHU_BACKEND` / `LARK_CLI`），**不用改代码**；plist 才需要替换占位符：
   ```bash
   NAME=mybot; BOT_DIR="$HOME/.local/share/lark-$NAME-bot"; LABEL="com.example.$NAME-feishu-bot"
   mkdir -p "$BOT_DIR"
   cp scripts/bridge.template.mjs "$BOT_DIR/bridge.mjs"
   # http 后端：llm.json 每次请求热读取，填完无需重启
   printf '{"baseUrl":"https://api.deepseek.com/v1","apiKey":"","model":"deepseek-chat"}\n' > "$BOT_DIR/llm.json"
   chmod 600 "$BOT_DIR/llm.json"
   sed -e "s|__HOME__|$HOME|g" -e "s|__NAME__|$NAME|g" -e "s|__LABEL__|$LABEL|g" \
       -e "s|__NODE__|$(command -v node)|g" -e "s|__APP_ID__|<APP_ID>|g" \
       scripts/agent.plist.template > "$HOME/Library/LaunchAgents/$LABEL.plist"
   plutil -lint "$HOME/Library/LaunchAgents/$LABEL.plist"
   ```
   先在有真实 TTY 的终端里前台跑一次 `FEISHU_APP_ID=<APP_ID> FEISHU_BOT_DIR="$BOT_DIR" node "$BOT_DIR/bridge.mjs"` 确认连上（`FEISHU_BOT_DIR` 必须带上，否则桥会去默认目录找 `llm.json`），再注册常驻：
   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<label>.plist
   launchctl print gui/$(id -u)/<label> | grep -E "state|pid|runs"   # running 且 runs 不涨
   ```
   **严禁 `launchctl submit`**（无 plist、KeepAlive 永久、remove 静默失败）。
   **必须在真实用户终端会话里执行**：从 agent / 受限 shell 里注册会失败，见坑位表。
   用 `cli` 后端时，把 plist 的 `FEISHU_BACKEND` 改成 `cli`，并追加 `FEISHU_AGENT_CMD` / `FEISHU_AGENT_ARGS`（JSON 数组，含 `{{PROMPT}}` 占位）。

## 大脑可插拔

模板支持两种后端，改 `BACKEND` 即可：

| 后端 | 配置 | 速度 | 备注 |
|---|---|---|---|
| `http`（默认） | 同目录 `llm.json`：`{"baseUrl":"...","apiKey":"","model":"..."}`，600 权限、**每次请求热读取** | 秒级 | OpenAI 兼容 `/chat/completions`，Node 内置 fetch，零依赖。国内端点优先（DeepSeek / Moonshot / 通义 / 智谱）；`api.openai.com` 在部分网络下超时，先 `fetch` 探活 |
| `cli` | `AGENT_CMD` + `AGENT_ARGS`，`{{PROMPT}}` 占位 | 约 30s | 任意无头 agent CLI（zcode / claude / codex 等）。**不要从受限 agent shell 启动**，会撞文件策略与文件锁 |

`llm.json` 示例（**apiKey 不要写进 skill 或提交到分享包**）：
```json
{ "baseUrl": "https://api.deepseek.com/v1", "apiKey": "", "model": "deepseek-chat" }
```

## 验收序列（路线 B）

1. **发送**：`lark-cli api POST /open-apis/im/v1/messages --params '{"receive_id_type":"chat_id"}' --data '{"receive_id":"oc_xxx","msg_type":"text","content":"{\"text\":\"test\"}"}' --as bot --profile <APP_ID>` → `ok:true` 且飞书可见。
2. **接收**：用户 @机器人 发消息 → `tail -f bridge.err.log` 出现 `[event]`（无 = scope / 订阅问题；有 `[event]` 无 `[reply]` = 大脑处理问题）。
3. **端到端**：秒级或约 30s 内收到回复；日志出现 `[llm]` 或 `[agent]` + `[reply] ok=true`。
4. 群聊只回被 @ 的消息、`message_id` 幂等去重、串行队列、断线自重启，模板已内置。

---

## 坑位表（每条都实测踩过）

| 坑 | 症状 | 解法 |
|---|---|---|
| **没先查原生能力** | 自建完才发现宿主自带助理 | 动手前先查宿主官方能力；本 skill 的路线 A 是默认 |
| **官方助理与自建桥共用 app_id** | 消息时回时不回 | 二选一或各建各的应用；切换时确保旧桥彻底不启动（plist + 手动进程都清掉） |
| **从受限 agent shell 起后台服务** | `launchctl bootstrap` 一律 `5: Input/output error`；`ps` 被拒；zcode 报 `Brokered two-path operation is not allowed by file policy` / `waiting for the ZCode file lock` | 不是配置问题（极简 plist 也失败，`plutil -lint` 通过）。改在**用户自己的终端**里注册 / 启动；或直接用路线 A 绕开整个 launchd |
| **错把桥的兜底文案当飞书故障** | 收到「处理这条消息时出了问题，请稍后再试」但 `[reply] ok=true` | 说明收发链路正常、`[agent] failed` 才是断点，查大脑后端 stderr |
| **`open_id` 按应用隔离** | 换应用后主动发消息报 `99992361` / invalid receive_id | 跨应用主动发消息用 `union_id`（`--params '{"receive_id_type":"union_id"}'`）；事件回调里的 `chat_id` 不受影响 |
| **漏配卡片回传交互** | 官方助理的消息 / 卡片按钮点了没反应 | 事件与回调 → 回调配置 → 加「卡片回传交互」 |
| **应用只创建没发布** | 飞书里搜不到机器人 | 创建版本并发布，确认「已启用」 |
| launchd 无 nvm PATH | `env: node: No such file or directory` exit 127 | 子进程显式 `env.PATH`，plist 用 node 绝对路径 |
| `event consume` 语义 | 起来几秒就 `stdin closed` 退出 | 子进程 stdio 用 `pipe` 且**永不关 stdin**（EOF = 退出信号） |
| `lark-cli api` 语法 | `path must not contain a query string` | query 走 `--params '{"k":"v"}'`，路径保持干净 |
| 内置浏览器剪贴板 | `navigator.clipboard` / 复制按钮无效 | 页内 evaluate 读 `.secret-code__code` → 600 权限临时文件 → stdin，用完即删 |
| 权限选择器虚拟列表 | 目标行 DOM 找不到 / 勾选不生效 | 放弃选择器，用 `99991672` 错误 hint 的 scope-apply URL 或批量导入 JSON |
| 创建应用弹窗按钮点不到 | 右下角「技术支持」浮层挡住「创建」 | 先收起浮层再点 |
| 大脑用 CLI 偏慢 | 单次回复约 30s | 无头冷启动特性；要快就换 `http` 后端或路线 A |
| 轮询代替长连接 | 定时任务空转刷屏 | 用长连接；官方助理不需要任何轮询 |

## 排查入口

- 桥日志：`~/.local/share/lark-<name>-bot/bridge.err.log`（`[event]` / `[msg]` / `[llm|agent]` / `[reply]` 分级）
- 官方助理：助理设置里看集成状态是否「已连接」；飞书开放平台看长连接「验证」是否「连接成功」
- API 错误码 `99991672` = 缺 scope，看 hint 里的 URL；`99992361` / 无效 receive_id = open_id 跨应用
- `lark-cli event schema im.message.receive_v1` 查事件字段（扁平：chat_id / content / message_id / sender_type / mentions）
- 官方参考：[助理接入指南](https://www.codebuddy.cn/docs/workbuddy/Assistant-Guide) · [飞书官网 2 分钟接入](https://www.feishu.cn/content/article/7651905073454304222)

## 分享前自检（本包必须满足）

- [ ] 全文无真实 `app_id`、App Secret、Encrypt Key、API key，也无真实 `ou_/on_/oc_` ID（`oc_xxx` 之类示例占位除外）
- [ ] 无 `/Users/<某人>` 之类的个人绝对路径、无用户名写死在 Label 里
- [ ] 模板用 `__HOME__` / `__NAME__` / 环境变量占位，运行时由 `os.homedir()` 推导
- [ ] `node --check bridge.template.mjs` 与 `plutil -lint agent.plist.template` 通过
- [ ] 交付只包含 `SKILL.md` + `scripts/`，不含 `llm.json`、日志、`.env` 或任何运行时产物
