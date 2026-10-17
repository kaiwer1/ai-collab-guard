// 同机多 AI 协同 · 只读巡检 v3（collab-guard）
// v1（2026-10-17 · DSH）：各家记忆文件存在性/大小/指纹巡检 + 合并指纹。
// v2（2026-10-17 · workbuddy-step-5-preview）：新增「口径文件」巡检与变更检测。
// v3（2026-10-17 · workbuddy-step-5-preview，按留言板 001-21 老板拍板收窄激活）：
//   记忆文件只报存在性/字节数/行数/缺失/空——**不做内容指纹**（含敏感记忆的 AI 不参与指纹，
//   不再读取记忆内容算哈希）；合并指纹只对明确同意共享的口径文件计算。
// 纪律：**只读**。不创建、不修改、不删除任何被巡检路径下的文件；只在本工具目录写 reports/ 与 state.json。
// 用法：node guard.mjs [--json] [--full] [--registry <path>]
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const FULL = argv.includes('--full');
const regIdx = argv.indexOf('--registry');
const REGISTRY = regIdx >= 0 ? argv[regIdx + 1] : join(HERE, 'registry.json');
const BASE = dirname(REGISTRY);
const REPORT_DIR = join(BASE, 'reports');
const STATE_FILE = join(BASE, 'state.json');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const sha12 = (buf) => sha(buf).slice(0, 12);
const now = () => new Date().toISOString();

// ---------- 记忆巡检（v3 收窄：只报存在性/字节/行数，不做内容指纹） ----------
async function inspectMemory(agent) {
  const rows = [];
  for (const path of agent.memory ?? []) {
    if (!existsSync(path)) {
      rows.push({ path, state: '缺失', bytes: 0, lines: 0, mtime: null });
      continue;
    }
    const st = statSync(path);
    let lines = 0;
    if (st.size > 0) {
      const text = (await readFile(path)).toString('utf8');
      lines = text.split(/\r?\n/).length;
    }
    rows.push({
      path,
      state: st.size === 0 ? '空文件' : '正常',
      bytes: st.size,
      lines,
      mtime: st.mtime.toISOString(),
    });
  }
  return { agent: agent.id, name: agent.name, cap: agent.cap ?? null, files: rows };
}

function memoryVerdict(units) {
  const missing = units.filter((u) => u.files.length === 0);
  const empty = units.flatMap((u) => u.files.filter((f) => f.state === '空文件').map((f) => `${u.agent}:${f.path}`));
  const gone = units.flatMap((u) => u.files.filter((f) => f.state === '缺失').map((f) => `${u.agent}:${f.path}`));
  const ok = units.filter((u) => u.files.some((f) => f.state === '正常'));
  const parts = [];
  parts.push(`可用记忆 ${ok.length}/${units.length}`);
  if (empty.length) parts.push(`空文件 ${empty.length} 个`);
  if (gone.length) parts.push(`路径缺失 ${gone.length} 个`);
  if (missing.length) parts.push(`未登记记忆 ${missing.length} 个（${missing.map((u) => u.name).join('、')}）`);
  return { parts, empty, gone, missing };
}

// ---------- 口径巡检（合并指纹只算口径文件——明确同意共享的范围） ----------
// watch: version = 有版本字段，盯版本变更+静默改动；content = 盯内容变更（记录级）；exists = 只盯存在性
async function inspectCaliber(entry) {
  if (!existsSync(entry.path)) {
    return { id: entry.id, name: entry.name, path: entry.path, watch: entry.watch ?? 'content', state: '缺失', bytes: 0, hash: null, version: null, mtime: null };
  }
  const st = statSync(entry.path);
  const buf = await readFile(entry.path);
  let version = null;
  if (entry.versionField && entry.path.toLowerCase().endsWith('.json')) {
    try {
      version = String(JSON.parse(buf.toString('utf8'))[entry.versionField] ?? null);
    } catch {
      version = '(JSON解析失败)';
    }
  }
  return {
    id: entry.id, name: entry.name, path: entry.path, watch: entry.watch ?? 'content',
    state: st.size === 0 ? '空文件' : '正常',
    bytes: st.size, hash: sha12(buf), version, mtime: st.mtime.toISOString(),
  };
}

function caliberComposite(units) {
  const usable = units.filter((c) => c.state === '正常' && c.hash);
  if (usable.length === 0) return null;
  return sha(usable.map((c) => `${c.id}:${c.hash}`).sort().join('\n')).slice(0, 12);
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// 与上一轮 state 对比，产出事件。事件分 info（记录级）与 warn（告警级）。
function caliberEvents(prev, curr) {
  const events = [];
  const prevMap = new Map((prev?.caliber ?? []).map((c) => [c.id, c]));
  for (const c of curr) {
    const p = prevMap.get(c.id);
    if (c.state === '缺失') {
      events.push({ level: 'warn', text: `口径文件缺失：${c.name}（${c.path}）` });
      continue;
    }
    if (c.state === '空文件') {
      events.push({ level: 'warn', text: `口径文件为空：${c.name}（${c.path}）` });
      continue;
    }
    if (!p || p.state === '缺失') {
      events.push({ level: 'info', text: `口径文件基线建立：${c.name}${c.version ? ` v${c.version}` : ''}（${c.hash}）` });
      continue;
    }
    if (c.watch === 'version') {
      if (c.version && p.version && c.version !== p.version) {
        events.push({ level: 'info', text: `口径版本变更：${c.name} ${p.version} → ${c.version}` });
      } else if (c.hash !== p.hash) {
        events.push({ level: 'warn', text: `静默改口径告警：${c.name} 内容变了但版本未变（${p.hash} → ${c.hash}）——请核对是否改了阈值/字段定义` });
      }
    } else if (c.watch === 'content') {
      if (c.hash !== p.hash) {
        events.push({ level: 'info', text: `口径内容变更：${c.name}（${p.hash} → ${c.hash}）` });
      }
    }
    // watch === 'exists'：存在性正常即无事件
  }
  return events;
}

// ---------- 主流程 ----------
const registry = JSON.parse(await readFile(REGISTRY, 'utf8'));

const memUnits = [];
for (const agent of registry.agents ?? []) memUnits.push(await inspectMemory(agent));
const memV = memoryVerdict(memUnits);

const calUnits = [];
for (const entry of registry.caliber ?? []) calUnits.push(await inspectCaliber(entry));
const calComp = caliberComposite(calUnits);

const prevState = await loadState();
const firstRun = !prevState;
const events = firstRun ? [{ level: 'info', text: '首次运行：已建立口径基线，下一轮起开始检测变更' }] : caliberEvents(prevState, calUnits);

const anomalies = [
  ...memV.empty.map((e) => ({ level: 'warn', text: `记忆空文件：${e}` })),
  ...memV.gone.map((e) => ({ level: 'warn', text: `记忆路径缺失：${e}` })),
  ...memV.missing.map((u) => ({ level: 'warn', text: `未登记记忆：${u.name}` })),
];
const warns = [...anomalies, ...events].filter((e) => e.level === 'warn');
const infos = events.filter((e) => e.level === 'info');

const report = {
  tool: 'collab-guard',
  version: 3,
  checkedAt: now(),
  root: registry.root,
  firstRun,
  memory: { verdict: memV, units: memUnits },
  caliber: { units: calUnits, composite: calComp, events },
  summary: { warns: warns.length, infos: infos.length },
};

// 落盘：完整报告 + 下一轮对比用的 state（只在本工具目录写）
await mkdir(REPORT_DIR, { recursive: true });
await writeFile(join(REPORT_DIR, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');
await writeFile(STATE_FILE, JSON.stringify({
  checkedAt: now(),
  caliber: calUnits.map((c) => ({ id: c.id, hash: c.hash, version: c.version, state: c.state })),
}, null, 2), 'utf8');

// ---------- 输出 ----------
const memLine = memV.parts.join(' ｜ ');
const calLine = calUnits.length === 0
  ? '口径未登记'
  : `口径 ${calUnits.filter((c) => c.state === '正常').length}/${calUnits.length}`;
const compLine = calComp ? `口径指纹 ${calComp}` : '口径指纹（无可比较文件）';

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else if (FULL) {
  console.log(`# 同机多 AI 协同巡检 · ${new Date().toLocaleString('sv-SE')}`);
  console.log(`记忆：${memLine}（不做内容指纹）`);
  console.log(`${calLine} ｜ ${compLine} ｜ 事件 ${infos.length} 记录级 / ${warns.length} 告警级`);
  console.log('');
  console.log('## 记忆文件（只报存在性/字节/行数）');
  console.log('| AI | 状态 | 字节 | 行数 | 最后写入 |');
  console.log('|---|---|---|---|---|');
  for (const u of memUnits) {
    if (u.files.length === 0) {
      console.log(`| ${u.name} | 未登记路径 | - | - | - |`);
      continue;
    }
    for (const f of u.files) {
      const when = f.mtime ? new Date(f.mtime).toLocaleString('sv-SE') : '-';
      console.log(`| ${u.name} | ${f.state} | ${f.bytes} | ${f.lines} | ${when} |`);
    }
  }
  console.log('');
  console.log('## 口径文件（合并指纹只算这些）');
  console.log('| 口径 | 状态 | 版本 | 字节 | 指纹 | 最后写入 |');
  console.log('|---|---|---|---|---|---|');
  for (const c of calUnits) {
    const when = c.mtime ? new Date(c.mtime).toLocaleString('sv-SE') : '-';
    console.log(`| ${c.name} | ${c.state} | ${c.version ?? '-'} | ${c.bytes} | ${c.hash ?? '-'} | ${when} |`);
  }
} else {
  // 默认输出：干净时一行；有事件时逐条列出
  if (warns.length === 0 && infos.length === 0) {
    console.log(`巡检正常 · ${memLine} · ${compLine} · ${calLine} · 口径无变更`);
  } else {
    console.log(`巡检 · ${memLine} · ${compLine} · ${calLine}`);
    for (const e of [...warns, ...infos]) console.log(`${e.level === 'warn' ? '⚠' : '·'} ${e.text}`);
  }
}
