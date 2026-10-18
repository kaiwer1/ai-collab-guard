#!/usr/bin/env node
// 通用本地聊天室（零依赖，Node >= 18）
// 用途：同机多 AI 协作的「主通道」——认领、提问、交接通知、回执都走这里；正式记录仍写留言板。
// 用法：
//   node chat-server/server.mjs [port] [--dir <运行目录>] [--host 127.0.0.1] [--agents A,B,C]
// 默认：端口 4310；运行目录 <仓库>/collab；只监听 127.0.0.1（不要随便开 0.0.0.0）。
import { createServer } from 'node:http';
import { appendFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = process.argv.slice(2);

function arg(name, fallback) {
  const i = RAW.indexOf(name);
  return i >= 0 && RAW[i + 1] ? RAW[i + 1] : fallback;
}

const PORT = Number(RAW.find((a) => /^\d+$/.test(a)) ?? process.env.CHAT_PORT ?? 4310);
const HOST = arg('--host', process.env.CHAT_HOST || '127.0.0.1');
const RUN_DIR = resolve(arg('--dir', process.env.CHAT_DIR || join(HERE, '..', 'collab')));
const CHAT_FILE = join(RUN_DIR, 'chat.jsonl');
const WAKE_FILE = join(RUN_DIR, 'WAKE.md');
const INBOX_DIR = join(RUN_DIR, 'inbox');
const PAGE_FILE = join(HERE, 'public.html');

const MAX_TEXT = 4000;
const READ_TAIL = 300;

await mkdir(INBOX_DIR, { recursive: true });
if (!existsSync(CHAT_FILE)) await appendFile(CHAT_FILE, '', 'utf8');

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readBody(req, max = 1 << 20) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readChat(limit = READ_TAIL) {
  const raw = await readFile(CHAT_FILE, 'utf8').catch(() => '');
  const lines = raw.split(/\r?\n/).filter(Boolean).slice(-limit);
  const out = [];
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item && typeof item.text === 'string') out.push(item);
    } catch {
      /* 跳过坏行，不因一行损坏拖垮整个聊天室 */
    }
  }
  return out;
}

async function readInboxNames() {
  const names = await readdir(INBOX_DIR).catch(() => []);
  return names.filter((n) => n.toLowerCase().endsWith('.md')).map((n) => n.replace(/\.md$/i, ''));
}

async function readWakeLines(limit = 12) {
  const raw = await readFile(WAKE_FILE, 'utf8').catch(() => '');
  return raw.split(/\r?\n/).filter((l) => l.trim()).slice(-limit);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/' && req.method === 'GET') {
      const html = await readFile(PAGE_FILE, 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      const chat = await readChat();
      json(res, 200, {
        ok: true,
        serverTime: new Date().toISOString(),
        runDir: RUN_DIR,
        chat,
        inbox: await readInboxNames(),
        wake: await readWakeLines(),
      });
      return;
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        json(res, 400, { ok: false, error: 'body 必须是 JSON' });
        return;
      }
      // 兼容三种署名字段：from / who / name（历史踩坑：只认 from 时其他写法会被兜底成默认名）
      const from = String(body.from ?? body.who ?? body.name ?? '').trim().slice(0, 60);
      const text = String(body.text ?? body.message ?? '').trim();
      if (!from) {
        json(res, 400, { ok: false, error: '缺少署名（from/who/name）' });
        return;
      }
      if (!text) {
        json(res, 400, { ok: false, error: '缺少内容（text）' });
        return;
      }
      if (text.length > MAX_TEXT) {
        json(res, 413, { ok: false, error: `单条最多 ${MAX_TEXT} 字，当前 ${text.length}` });
        return;
      }
      const item = { ts: new Date().toISOString(), from, text };
      await appendFile(CHAT_FILE, `${JSON.stringify(item)}\n`, 'utf8');
      json(res, 200, { ok: true, item });
      return;
    }

    if (url.pathname === '/api/health' && req.method === 'GET') {
      json(res, 200, { ok: true, chatFile: CHAT_FILE });
      return;
    }

    json(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    json(res, 500, { ok: false, error: String(err?.message ?? err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[chat-server] http://${HOST}:${PORT}/`);
  console.log(`[chat-server] 运行目录 ${RUN_DIR}`);
  console.log('[chat-server] 提示：默认只监听本机；要跨机使用请自行加反向代理与鉴权，不要直接 --host 0.0.0.0');
});
