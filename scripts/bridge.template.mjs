#!/usr/bin/env node
// 飞书长连接 → 可插拔大脑 → 回复（通用模板，路线 B 使用）
//
// 零依赖（Node >= 18）。用法：
//   1) 复制本文件到 ~/.local/share/lark-<name>-bot/bridge.mjs
//   2) 用环境变量或改下方 CONFIG 指定 app_id；http 后端在同目录放 llm.json（chmod 600）
//   3) 配 agent.plist.template 常驻，必须在【用户自己的终端】里 bootstrap
//
// 必需环境变量（也可直接改 CONFIG）：
//   FEISHU_APP_ID   飞书 app_id，同时作为 lark-cli profile 名
// 可选：
//   FEISHU_BOT_DIR  桥目录（默认 ~/.local/share/lark-bot）
//   LARK_CLI        lark-cli 绝对路径（不填则自动探测）
//   FEISHU_BACKEND  http（默认）| cli
//   FEISHU_AGENT_CMD / FEISHU_AGENT_ARGS  cli 后端的可执行与参数，{{PROMPT}} 为占位
//
// 设计要点（勿删，都是踩过的坑）：
//   1. lark-cli 与 node 自动定位 + 子进程显式 PATH（launchd 没有 nvm 环境）
//   2. event consume 的 stdin 必须保持打开（EOF = 退出信号）
//   3. lark-cli api 的 query 走 --params，不能拼在 URL 路径里
//   4. 密钥放在 600 权限 llm.json 且每次请求热读取；日志绝不打印 key
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const BOT_DIR = process.env.FEISHU_BOT_DIR || path.join(HOME, '.local', 'share', 'lark-bot');
const CONFIG = {
  PROFILE: process.env.FEISHU_APP_ID || '<APP_ID>',
  BACKEND: (process.env.FEISHU_BACKEND || 'http').toLowerCase(),
  SYSTEM_PROMPT: '你是飞书机器人助手。直接回复下面这条消息，简体中文，简洁（默认 1-3 句）。只输出正文：\n用户消息：',
  AGENT_CMD: process.env.FEISHU_AGENT_CMD || '',
  AGENT_ARGS: process.env.FEISHU_AGENT_ARGS ? JSON.parse(process.env.FEISHU_AGENT_ARGS) : ['-p', '{{PROMPT}}'],
  AGENT_TIMEOUT_MS: 180_000,
  REPLY_TIMEOUT_MS: 30_000,
  FALLBACK: '（处理这条消息时出了问题，请稍后再试。）',
};

function resolveLarkCli() {
  if (process.env.LARK_CLI) return process.env.LARK_CLI;
  const candidates = [];
  const nvmRoot = path.join(HOME, '.nvm', 'versions', 'node');
  try {
    for (const v of fs.readdirSync(nvmRoot).sort().reverse()) candidates.push(path.join(nvmRoot, v, 'bin', 'lark-cli'));
  } catch {}
  candidates.push(path.join(HOME, '.local', 'bin', 'lark-cli'), '/usr/local/bin/lark-cli', '/opt/homebrew/bin/lark-cli');
  for (const dir of (process.env.PATH || '').split(':')) candidates.push(path.join(dir, 'lark-cli'));
  for (const c of candidates) { try { if (fs.statSync(c).isFile()) return c; } catch {} }
  throw new Error('找不到 lark-cli：请设置 LARK_CLI 为绝对路径，或先安装飞书连接器');
}
const LARK = resolveLarkCli();

const CHILD_ENV = {
  ...process.env,
  HOME,
  PATH: [...new Set([
    path.dirname(LARK), path.dirname(process.execPath),
    path.join(HOME, '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin',
    '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ])].join(':'),
};

const log = (...a) => console.log(new Date().toISOString(), ...a);
const err = (...a) => console.error(new Date().toISOString(), ...a);

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: CHILD_ENV });
    let out = '', errOut = '';
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { errOut += d; });
    p.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e) }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out, errOut, code }); });
  });
}

// —— 大脑 A：OpenAI 兼容 HTTP（默认，秒级）——
async function askHttp(text) {
  const cfg = JSON.parse(await fsp.readFile(path.join(BOT_DIR, 'llm.json'), 'utf8'));
  if (!cfg.apiKey) throw new Error('llm.json 缺 apiKey');
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  const model = cfg.model || 'deepseek-chat';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(cfg.timeoutMs) || 60_000);
  let resp;
  try {
    resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: CONFIG.SYSTEM_PROMPT.replace(/\n用户消息：$/, '') },
          { role: 'user', content: text },
        ],
        temperature: 0.7,
      }),
      signal: controller.signal,
    });
  } finally { clearTimeout(timer); }
  if (!resp.ok) throw new Error('llm HTTP ' + resp.status + ' ' + (await resp.text()).slice(0, 200));
  const data = await resp.json();
  const out = (data.choices?.[0]?.message?.content || '').trim();
  if (!out) throw new Error('llm 返回空内容');
  log(`[llm] model=${model} host=${new URL(base).host} chars=${out.length}`);
  return out;
}

// —— 大脑 B：任意无头 CLI（约 30s，注意不要在受限 agent shell 里启动）——
async function askCli(text) {
  if (!CONFIG.AGENT_CMD) throw new Error('cli 后端需要 FEISHU_AGENT_CMD');
  const prompt = CONFIG.SYSTEM_PROMPT + text;
  const args = CONFIG.AGENT_ARGS.map((a) => String(a).replaceAll('{{PROMPT}}', prompt));
  const z = await run(CONFIG.AGENT_CMD, args, CONFIG.AGENT_TIMEOUT_MS);
  if (!z.ok || !(z.out || '').trim()) throw new Error('agent failed code=' + z.code + ' stderr=' + (z.errOut || '').slice(0, 200));
  log(`[agent] chars=${z.out.trim().length}`);
  return z.out.trim();
}

const ask = CONFIG.BACKEND === 'cli' ? askCli : askHttp;

const seen = new Set();
let queue = Promise.resolve();

async function handleEvent(ev) {
  try {
    if (!ev || typeof ev !== 'object') return;
    log(`[event] chat_type=${ev.chat_type || '?'} sender=${ev.sender_type || '?'} mentions=${(ev.mentions?.length) || 0}`);
    if (ev.sender_type !== 'user') return;                          // 只回真人
    if (!ev.message_id || seen.has(ev.message_id)) return;          // message_id 幂等
    seen.add(ev.message_id);
    if (seen.size > 1000) seen.clear();
    if (ev.chat_type === 'group' && !(ev.mentions?.length)) return; // 群聊只回被 @
    const text = (ev.content || '').replace(/@_user_\d+/g, '').trim();
    if (!text) return;
    log(`[msg] chat=${ev.chat_id} text=${text.slice(0, 120)}`);

    let reply;
    try { reply = await ask(text); }
    catch (e) { err('[brain] ' + String(e && (e.stack || e)).slice(0, 300)); reply = CONFIG.FALLBACK; }

    const data = JSON.stringify({ receive_id: ev.chat_id, msg_type: 'text', content: JSON.stringify({ text: reply }) });
    const r = await run(LARK, [
      'api', 'POST', '/open-apis/im/v1/messages',
      '--params', '{"receive_id_type":"chat_id"}',
      '--data', data, '--as', 'bot', '--profile', CONFIG.PROFILE,
    ], CONFIG.REPLY_TIMEOUT_MS);
    log(`[reply] ok=${r.ok} bytes=${reply.length}` + (r.ok ? '' : ' err=' + ((r.errOut || r.out || '')).slice(0, 200)));
  } catch (e) {
    err('[handle] ' + ((e && e.stack) || e));
  }
}

if (CONFIG.PROFILE === '<APP_ID>') {
  err('[bridge] 请先设置 FEISHU_APP_ID（飞书 app_id = lark-cli profile 名）');
  process.exit(2);
}
if (CONFIG.BACKEND === 'http' && !fs.existsSync(path.join(BOT_DIR, 'llm.json'))) {
  err('[bridge] 缺 ' + path.join(BOT_DIR, 'llm.json') + '（baseUrl/apiKey/model，chmod 600）');
  process.exit(2);
}

const consume = spawn(LARK, [
  'event', 'consume', 'im.message.receive_v1', '--as', 'bot', '--profile', CONFIG.PROFILE,
], { stdio: ['pipe', 'pipe', 'pipe'], env: CHILD_ENV });
consume.stdin.on('error', () => {});
err(`[bridge] started pid=${process.pid} consume_pid=${consume.pid} backend=${CONFIG.BACKEND} lark=${LARK}`);

const rl = readline.createInterface({ input: consume.stdout });
rl.on('line', (line) => {
  const s = line.trim();
  if (!s || !s.startsWith('{')) return;
  let ev;
  try { ev = JSON.parse(s); } catch { return; }
  queue = queue.then(() => handleEvent(ev));
});
consume.stderr.on('data', (d) => err('[consume] ' + String(d).trim()));
consume.on('close', (code) => { err('[bridge] consume exited code=' + code + ' — exiting for launchd restart'); process.exit(1); });
process.on('SIGTERM', () => { try { consume.kill('SIGTERM'); } catch {} setTimeout(() => process.exit(0), 500); });
