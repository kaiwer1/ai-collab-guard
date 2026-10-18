// 同机多 AI 协同 · 只读巡检 + 告警送达 v4（collab-guard）
// v1（2026-10-17 · DSH）：各家记忆文件存在性/大小/指纹巡检 + 合并指纹。
// v2（2026-10-17 · workbuddy-step-5-preview）：新增「口径文件」巡检与变更检测。
// v3（2026-10-17 · workbuddy-step-5-preview，按留言板 001-21 老板拍板收窄激活）：
//   记忆文件只报存在性/字节数/行数/缺失/空——**不做内容指纹**（含敏感记忆的 AI 不参与指纹，
//   不再读取记忆内容算哈希）；合并指纹只对明确同意共享的口径文件计算。
// v4（2026-10-17 · workbuddy-step-5-preview，按留言板 001-33 定稿② + 001-34 六判据 + 003-42 脱敏三判据）：
//   分级：P0=静默改口径（哈希变、version 未升）/ 敏感键误写进口径文件 / 词库自指变更；
//         P1=口径正规升级（内容与 version 同变）/ 口径内容变更；P2=存量告警（记忆空文件/缺失/未登记，聚合一行）。
//   送达：P0 → reports/p0-alerts.jsonl（id 稳定 evt-YYYYMMDD-hhmmss-NNN；去重键=路径+内容哈希+version，
//         同一 key 只首次上板；status pending|acked|resolved；连续≥2轮未处理 escalated 置顶）
//         + reports/board-pending.md（板首「阻塞项/待老板」区自动文案，diff 摘要两路）；
//         P1 → reports/p1-events.jsonl；P2 每小时聚合一行。默认**不外发**（001-31），--deliver 保留为人工诊断。
//   脱敏（003-42 三判据）：敏感命中只报键名+命中类型、不报值；值只留前 2 后 1；len<12 不做无条件子串
//         匹配（改为断言占位替换）；词库文件（selfRef:true）diff 值整体脱敏（自指保护，改词库=可令告警失效）。
//   字段级 diff：JSON 递归键路径，格式「键路径 | 旧值 → 新值 | version 旧 → 新」；非 JSON 按行号。
//   状态机 CLI：--ack <id> --note "..." / --resolve <id> --note "..."（对应板上「已核对·结论」回执后人工执行）。
// v4.1（2026-10-17 · workbuddy-step-5-preview，按留言板 001-55/001-56/001-57/001-58 首轮验证回执修复）：
//   ① 红项（001-55 记红/001-56 认可）：敏感模式 8 类补至 13 类，与私有仓 AGENTS.md「提交前」
//      密钥扫描词库一一对应（新增 LTAI/AKID/AIza/PEM 私钥块/ssh-rsa）——脱敏与检测同源，
//      未命中模式的值会保留原文进产物；模式清单迁至 scripts/patterns.mjs（guard/selftest 共用）。
//   ② 黄二（001-57 记黄/001-58 附议）：**每轮巡检对所有 pending 事件 rounds+1**，不只当轮
//      candidate——一次性静默改动产生的 pending 没人回执也按 001-33 第 8 条置顶（原实现下永不置顶）。
//   ③ 消费提示（001-55 第四节）：selfRef 词库文件跳过敏感扫描（secrets 为空），但自指变更独立走
//      P0——消费侧按 kind 判定，不要按 secrets 非空筛选/路由。
// v4.3（2026-10-18 · workbuddy-step-5-preview，按 001-67/001-68/001-69 ③ 首轮验证回执）：
//   ① P3（001-67 读码+探针发现 / 001-68 源码复核确认 / 001-69 附议）：saveEvidence 无条件
//      writeFile 覆盖是全模块唯一「不拒绝覆盖」的写入点（同事件 id 二次固化静默替换首份副本、
//      台账 sha256 与磁盘脱节）——scripts/quarantine.mjs 改「只写不覆盖」wx 标志 + 转存
//      <name>.<seq>，台账 target 指向实际写入路径。
//   ② t-001 反向断言（001-55 修法③，P1，001-65 认领；前置口径 001-67 第三节三家附议）：
//      diff 非敏感值由 truncValue 保留原文改为整体 '(未回显)'——未命中任何敏感模式的值也不
//      允许原文进 board-pending.md 等「不得含原文」产物（兜词汇表漂移的残余路径）；原文仍
//      按 001-67 口径只进取证例外区（state.json / reports/evidence/** / reports/quarantine/**）。
// ③（2026-10-18 · workbuddy-step-5-preview，按 001-23 候选工作项第 3 件 / 001-33 排期③首发）：
//   备份/quarantine（scripts/quarantine.mjs，guard 与 CLI 共用单源）——只移动不删除 + 台账 jsonl + 限时保留。
//   P0 事件创建即把被巡检文件原字节固化到 reports/evidence/<事件id>/（只读被巡检路径，只写本工具目录，
//   不破坏只读纪律）；人工显式 --quarantine/--unquarantine 才搬移文件；台账到期只标「待人工清理」，永不删。
// v4.4（2026-10-18 · workbuddy-step-5-preview，按 001-71/001-72/001-73/001-74 v4.3 复跑回执，t-001 闭项批次）：
//   ① version 残余通道（001-73 二.3 探针发现 + 一手实测 / 001-74 独立复核确认，P2）：
//      version 曾是 formatDiffValue 之外唯一仍以原文回显的文件派生值——不命中模式的长串
//      原样进板首/stdout/latest.json/p0-alerts.jsonl 的 version.to 与 dedupKey（note 被脱敏、
//      version 全裸并存于同一行摘要）。改为**回显形态约束**（非值白名单）：形如常规版本号
//      （^[\w.+-]{1,24}$）且不命中敏感模式才原样回显，其余一律 '(未回显)'；dedupKeyOf 的
//      version 段改 sha12 哈希（去重语义不变、产物不含原文）。正常 0.49.11 → 0.49.12 不受影响。
//      落点：versionPart / caliberEvents 基线与版本变更行 / P1 记录 / report.caliber.units /
//      --full 版本列。state.json 保留 version 原文（取证例外区 + 下轮对比基准，见 001-67 口径）。
//   ② 行 diff '(空)' 哨兵回归（001-73 三，判黄应修 / 001-74.3 附议）：v4.2 truncValue 曾让
//      '(空)' 原样保留，v4.3 改整体不回显后哨兵被一起吞掉——markdown 口径「清空/新增/改写」
//      三类变更完全不可区分。改为行侧**变更类别枚举**：(无此行)=该侧无此行 / (空行)=空行 /
//      (非空 N字节)=非空行只报长度（敏感行仍前 2 后 1）——四态全覆盖、零原文、可直接断言。
//   ③ 纪律：**只读**。不创建、不修改、不删除任何被巡检路径下的文件；只在本工具目录写 reports/ 与 state.json；
//      p0-alerts.jsonl / board-pending.md 只由本工具生成，回执只能通过 --ack/--resolve 进行。
// 用法：node guard.mjs [--json] [--full] [--registry <path>]
//       node guard.mjs --ack <id> --note "..." | --resolve <id> --note "..."
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SENSITIVE_PATTERNS } from './scripts/patterns.mjs';
import { saveEvidence, loadLedger, isExpired, RETAIN_DAYS } from './scripts/quarantine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const FULL = argv.includes('--full');
const regIdx = argv.indexOf('--registry');
const REGISTRY = regIdx >= 0 ? argv[regIdx + 1] : join(HERE, 'registry.json');
const BASE = dirname(REGISTRY);
const REPORT_DIR = join(BASE, 'reports');
const STATE_FILE = join(BASE, 'state.json');
const ALERTS_FILE = join(REPORT_DIR, 'p0-alerts.jsonl');
const P1_FILE = join(REPORT_DIR, 'p1-events.jsonl');
const BOARD_FILE = join(REPORT_DIR, 'board-pending.md');
const ESCALATE_AFTER = 2; // 同一 P0 连续 ≥2 轮未处理 → 置顶（001-27/001-33 定稿）
const MAX_DIFF_ITEMS = 5; // 单事件最多列几条 diff
const MAX_TEXT_BYTES = 65536; // 超过该大小的口径文件不留 prevText（diff 退化为仅指纹对比）

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const sha12 = (buf) => sha(buf).slice(0, 12);
const now = () => new Date().toISOString();

// ---------- 敏感键检测与脱敏（001-29 规格 + 003-42 三条可断言判据） ----------
// 模式清单与私有仓 AGENTS.md 提交前扫描词库的对应关系见 scripts/patterns.mjs（v4.1 红项修复）。
// 只报「命中类型」（键名/模式），从不输出原值；原值仅在本函数内部短暂存在。
// 返回去重后的命中类型列表（不返回原值——原值绝不出现在任何产物里）
function scanSensitiveTypes(text) {
  const types = new Set();
  for (const p of SENSITIVE_PATTERNS) {
    p.re.lastIndex = 0;
    if (p.re.test(text)) types.add(p.type);
  }
  return [...types];
}
function isSensitiveValue(v) {
  const s = String(v);
  for (const p of SENSITIVE_PATTERNS) {
    p.re.lastIndex = 0;
    if (p.re.test(s)) return true;
  }
  return false;
}
// 值脱敏：只留前 2 后 1；过短整体占位（003-42 判据2：短值不做无条件子串匹配，断言占位替换）
function maskValue(v) {
  const s = String(v);
  if (s.length <= 3) return '(脱敏)';
  return `${s.slice(0, 2)}…${s.slice(-1)}`;
}

// ---------- version 回显形态约束（v4.4，001-73 二.3 探针发现 / 001-74 独立复核确认，P2） ----------
// version 曾是 formatDiffValue 之外唯一仍以原文回显的文件派生值（inspectCaliber 直接从口径
// 文件内容取值）：不命中任何敏感模式的长串 version 会原样进板首/stdout/latest.json/p0-alerts
// 的 version.to 与 dedupKey——「note 被脱敏、version 全裸」并存于同一行摘要（一手实测）。
// 修法=**约束回显形态而非放行某类值**（比短值白名单更窄——001-70 二共识不开白名单）：
// v4.4：字符集+长度约束（^[\w.+-]{1,24}$）。
// v4.5（Codex 001-80 边界复核）：长度+字符集不足以表达「版本号」语义——20 字符的
//   MockOpaqueValue123456 同样满足该式。收窄为**结构语义**：必须含「数字.数字」版本核心
//   （\d+(\.\d+)+）。
// v4.6（001-85 P3 假承诺订正，001-86/001-87/001-88 附议）：**三闸独立、同时成立才回显**——
//   字符集/长度 ∧ 数字.数字核心 ∧ 非敏感（001-85 澄清长度闸曾被漏出与条件，001-88 据此
//   更正 001-84 留痕两闸独立这层）。承诺口径：0.49.11 / v1.0.0 / 1.0.0-beta.1 /
//   1.2.3+build.20261018.123 照旧回显（均 ≤24 字符且含版本核心，v 前缀与构建元数据不限）；
//   slug 型长 version 超 24 上限一律 '(未回显)'——真实实例 configs/文案合规-v1.0.json 的
//   copy-compliance-2026.10.15-v1 为 29 字符，在长度闸即判掩码，取值回仓库核对（不为回显
//   单个 slug 放宽长度闸）；裸数字（23）、无点结构的不透明串一律 '(未回显)'；换行/异常分隔
//   不在字符集内。
// state.json 保留原文（例外区+下轮对比基准），取证通道不削。
const VERSION_ECHO_RE = /^[\w.+-]{1,24}$/;
const VERSION_CORE_RE = /\d+(\.\d+)+/;
function safeVersion(v) {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return VERSION_ECHO_RE.test(s) && VERSION_CORE_RE.test(s) && !isSensitiveValue(s) ? s : '(未回显)';
}
// 展示用（--full 表格等）：null/undefined → '-'
const showVersion = (v) => (v === undefined || v === null ? '-' : safeVersion(v));

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
// selfRef: true = 词库/自指保护文件（001-29/001-30）：任何内容变更即 P0，且 diff 值整体脱敏不回显
async function inspectCaliber(entry) {
  const base = { id: entry.id, name: entry.name, path: entry.path, watch: entry.watch ?? 'content', selfRef: !!entry.selfRef, state: '缺失', bytes: 0, hash: null, version: null, mtime: null, secretTypes: [], text: null };
  if (!existsSync(entry.path)) return base;
  const st = statSync(entry.path);
  if (st.size === 0) return { ...base, state: '空文件' };
  const buf = await readFile(entry.path);
  const text = buf.toString('utf8');
  let version = null;
  if (entry.versionField && entry.path.toLowerCase().endsWith('.json')) {
    try {
      version = String(JSON.parse(text)[entry.versionField] ?? null);
    } catch {
      version = '(JSON解析失败)';
    }
  }
  // 敏感键扫描：词库文件自身内容天然含模式名，跳过（selfRef 即敏感扫描豁免）
  const secretTypes = entry.selfRef ? [] : scanSensitiveTypes(text);
  return {
    ...base,
    state: '正常',
    bytes: st.size,
    hash: sha12(buf),
    version,
    mtime: st.mtime.toISOString(),
    secretTypes,
    text: st.size <= MAX_TEXT_BYTES ? text : null,
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

// ---------- 字段级 diff（001-28 格式：键路径 | 旧值 → 新值 | version 旧 → 新） ----------
// 值策略（v4.3，t-001 反向断言落地；001-55 修法③ + 001-67 第三节两类产物口径）：
//   词库文件（selfRef）整体脱敏不回显；命中敏感模式 → 前 2 后 1（003-42 判据2）；
//   **其余值一律不回显原文（'(未回显)'）**——兜「AGENTS.md 日后新增第六类凭据而两份清单
//   同时未覆盖」的残余路径：未命中模式的值原先走 truncValue 保留原文进 diff→summary→
//   board-pending.md（003-42 红项根因链的最后一环）。阈值/字段改了由键路径 + version
//   迁移 + 哈希变化足以定位，具体取值回仓库核对（原文只进 state.json 与 evidence 取证区）。
function formatDiffValue(v, selfRef) {
  if (selfRef) return '(脱敏)'; // 自指保护优先：词库内容一律不回显
  if (v === undefined || v === null) return '(空)';
  if (typeof v === 'object') return Array.isArray(v) ? '[数组]' : '[对象]';
  const s = String(v);
  if (isSensitiveValue(s)) return maskValue(s);
  return '(未回显)';
}
function makeValueFormatter(selfRef) {
  return (v) => formatDiffValue(v, selfRef);
}

function diffJson(a, b, prefix, out, fmt) {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const path = `${prefix}[${i}]`;
      const ka = a[i];
      const kb = b[i];
      if (i >= a.length) out.push({ key: path, from: '(空)', to: fmt(kb) });
      else if (i >= b.length) out.push({ key: path, from: fmt(ka), to: '(空)' });
      else if (isPlainObject(ka) && isPlainObject(kb)) diffJson(ka, kb, path, out, fmt);
      else if (ka !== kb) out.push({ key: path, from: fmt(ka), to: fmt(kb) });
    }
    return;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) {
      const ka = a[k];
      const kb = b[k];
      const path = prefix ? `${prefix}.${k}` : k;
      if (!(k in a)) out.push({ key: path, from: '(空)', to: fmt(kb) });
      else if (!(k in b)) out.push({ key: path, from: fmt(ka), to: '(空)' });
      else if (isPlainObject(ka) && isPlainObject(kb)) diffJson(ka, kb, path, out, fmt);
      else if (ka !== kb) out.push({ key: path, from: fmt(ka), to: fmt(kb) });
    }
  } else if (a !== b) {
    out.push({ key: prefix || '(根)', from: fmt(a), to: fmt(b) });
  }
}

function diffText(a, b) {
  const la = String(a).split(/\r?\n/);
  const lb = String(b).split(/\r?\n/);
  const out = [];
  const n = Math.max(la.length, lb.length);
  // v4.4（001-73 三）：越界行保持 undefined（该侧无此行），不再折成字符串 '(空)'——
  // 字符串 '(空)' 会继续走 formatDiffValue 变成 '(未回显)'，与空行、改写不可区分。
  for (let i = 0; i < n && out.length < MAX_DIFF_ITEMS; i++) {
    if (la[i] !== lb[i]) out.push({ key: `行${i + 1}`, from: la[i], to: lb[i] });
  }
  return out;
}

// 产出一条口径变更的字段级 diff；无 prevText 时返回空（仅指纹级）
function caliberDiff(prev, curr) {
  if (!prev?.text || !curr?.text) return [];
  const fmt = makeValueFormatter(curr.selfRef);
  const out = [];
  const isJson = (s) => { try { JSON.parse(s); return true; } catch { return false; } };
  if (isJson(prev.text) && isJson(curr.text)) {
    diffJson(JSON.parse(prev.text), JSON.parse(curr.text), '', out, fmt);
  } else {
    const raw = diffText(prev.text, curr.text);
    for (const d of raw) {
      // 非 JSON 按行 diff（v4.4，001-73 三判黄应修 / 001-74.3 附议）：行侧回显**变更类别枚举**——
      // v4.2 的 truncValue 曾让 '(空)' 哨兵原样保留，v4.3 改整体不回显后哨兵被一起吞掉，
      // markdown 口径「清空/新增/改写」三类变更完全不可区分（v4.3 引入的可用性回归）。
      // 四态全覆盖、不含原文，10b 反向断言可直接断：
      //   (无此行)          = 该侧不存在这行（→(无此行)=删除行；(无此行)→=新增行）
      //   (空行)            = 该侧是空行（…→(空行)=改为空行；(空行)→…=改为非空）
      //   (非空 N字节)      = 该侧是非空行，只报长度不报内容（(非空)→(非空)=改写）
      //   命中敏感模式的行走 maskValue 前 2 后 1（003-42 判据2，与 JSON 分支一致）；
      //   selfRef 词库文件的非空行维持 v4.1 ③ 契约整体 '(脱敏)'（词库内容一律不回显）
      const lineLabel = (v) => v === undefined
        ? '(无此行)'
        : v === ''
          ? '(空行)'
          : (curr.selfRef
            ? '(脱敏)'
            : (isSensitiveValue(v) ? maskValue(v) : `(非空 ${Buffer.byteLength(v, 'utf8')}字节)`));
      out.push({ key: d.key, from: lineLabel(d.from), to: lineLabel(d.to) });
    }
  }
  return out.slice(0, MAX_DIFF_ITEMS);
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------- v3 兼容输出：与上一轮 state 对比产出 info/warn（文本保持不变，场景1-4 自测依赖） ----------
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
      events.push({ level: 'info', text: `口径文件基线建立：${c.name}${c.version ? ` v${safeVersion(c.version)}` : ''}（${c.hash}）` });
      continue;
    }
    if (c.watch === 'version') {
      if (c.version && p.version && c.version !== p.version) {
        events.push({ level: 'info', text: `口径版本变更：${c.name} ${safeVersion(p.version)} → ${safeVersion(c.version)}` });
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

// ---------- 告警引擎（001-33 定稿②：分级 / 去重 / 状态机 / 升级） ----------

// 本轮巡检 → P0 候选事件列表（去重与持久化在 upsert 里做）
function buildP0Candidates(prevState, curr, firstRun) {
  const candidates = [];
  if (firstRun) return candidates; // 首跑只建基线，不下结论（含敏感键扫描）
  const prevMap = new Map((prevState?.caliber ?? []).map((c) => [c.id, c]));
  for (const c of curr) {
    if (c.state !== '正常' || !c.hash) continue;
    const p = prevMap.get(c.id);
    if (!p || p.state !== '正常' || !p.hash) continue;
    const diff = caliberDiff(p, c);
    // v4.4（001-73 二）：version 显示值走 safeVersion 形态约束，原文只留 state.json（例外区）
    const versionPart = { from: safeVersion(p.version), to: safeVersion(c.version) };
    if (c.selfRef) {
      // 词库自指保护：任何内容变更即 P0（001-30 #5：改词库=可令全部告警失效）
      if (c.hash !== p.hash) {
        candidates.push({
          kind: '词库自指变更',
          caliber: c.id, name: c.name, path: c.path,
          version: versionPart, hash: { from: p.hash, to: c.hash },
          diff, secrets: [], selfRef: true,
        });
      }
      continue;
    }
    // 敏感键误写即 P0（003-42/001-33），与 watch 类型无关；非敏感情况下：
    // watch=version 版本同变=正规升级（P1）；watch=content/exists 的变更归 P1/无事件，不算静默改口径
    const hitSecret = c.secretTypes.length > 0;
    if (!hitSecret) {
      if (c.watch !== 'version') continue;
      if (c.version && p.version && c.version !== p.version) continue; // 正规升级 → P1
      if (c.hash === p.hash) continue;
    }
    const changed = c.hash !== p.hash;
    if (!changed && !hitSecret) continue;
    candidates.push({
      kind: hitSecret ? '敏感键误写' : '静默改口径',
      caliber: c.id, name: c.name, path: c.path,
      version: versionPart, hash: { from: p.hash, to: c.hash },
      diff: changed ? diff : [],
      secrets: c.secretTypes, selfRef: false,
    });
  }
  return candidates;
}

// 人读一行摘要（Doubao 001-37 #7：一句话人话结论 + 关键 diff）
function eventSummary(e) {
  const diffPart = e.diff.length > 0
    ? `；diff：${e.diff.map((d) => `${d.key} | ${d.from} → ${d.to}`).join('；')}`
    : '';
  const verPart = e.version?.from || e.version?.to
    ? `；version ${e.version.from ?? '?'} → ${e.version.to ?? '?'}`
    : '';
  const secPart = e.secrets.length > 0 ? `；命中敏感键 ${e.secrets.join('、')}（值已脱敏，只报键名）` : '';
  const reason = e.kind === '词库自指变更'
    ? '词库/自指保护文件被改，可令全部告警失效'
    : e.kind === '敏感键误写'
      ? '疑似敏感键误写进口径文件'
      : '内容变了但版本未变，疑似静默改口径';
  return `「${e.name}」${reason}${verPart}${diffPart}${secPart}`;
}

// v4.4（001-73 二.4）：version 段改哈希拼接——version 显示值已受 safeVersion 形态约束，去重键不再内嵌 version 原文
// v4.5（Codex 001-80 去重旁注留痕，勿改）：version 段哈希对象是**掩码后的显示值**（如 '(未回显)'
// 恒等），非 version 原文——这是设计而非疏漏：① version 变更必伴随同文件内容 hash 变更，
// dedupKey 的 hash.to 段已可区分不同版本（GLM5.3Flash 001-77 二核实认可、QwenWork 001-78 五
// 一手探针佐证 sha12('') 塌缩无害）；② 若改哈希原文，反与 10d-2「12 位哈希不含原文」断言
// 自相矛盾。防后人当 bug 修回。
const dedupKeyOf = (e) => `${e.path}|${e.hash?.to ?? ''}|${sha12(Buffer.from(String(e.version?.to ?? '')))}`;

function nextEventId(existing, tsIso) {
  const d = tsIso.slice(0, 10).replace(/-/g, '');
  const hms = tsIso.slice(11, 19).replace(/:/g, '');
  const prefix = `evt-${d}-${hms}-`;
  let seq = 1;
  for (const e of existing) {
    if (typeof e.id === 'string' && e.id.startsWith(prefix)) seq += 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// 去重键=路径+内容哈希+version（001-29）：同 key pending 只续轮不新增；acked 不复发；resolved 后同 key 复发计新事件
// v4.1（001-57 黄二 / 001-58 附议）：续轮范围=**所有 pending 事件**，不只当轮 candidate——
// 原实现下一次性静默改动产生的 pending 没人回执就永不置顶（rounds 恒 1），与 001-33 第 8 条
// 「同一 P0 连续 ≥2 轮未处理 → 置顶」原意相反，板首「待处理 N 轮」也会恒显 1（扭曲 #7 可读性）。
function upsertAlerts(existing, candidates, tsIso) {
  const created = [];
  let touched = 0;
  const byKey = new Map(existing.map((e) => [e.dedupKey, e]));
  const candidateKeys = new Set();
  for (const cand of candidates) {
    const key = dedupKeyOf(cand);
    candidateKeys.add(key);
    const ex = byKey.get(key);
    if (ex && ex.status === 'pending') {
      ex.rounds += 1;
      ex.updatedAt = tsIso;
      ex.escalated = ex.rounds >= ESCALATE_AFTER;
      touched += 1;
      continue;
    }
    if (ex && ex.status === 'acked') continue; // 已回执受理；内容若再变会换哈希 → 新 key 新事件
    const ev = {
      id: nextEventId(existing, tsIso),
      kind: cand.kind,
      caliber: cand.caliber,
      name: cand.name,
      path: cand.path,
      level: 'P0',
      version: cand.version,
      hash: cand.hash,
      dedupKey: key,
      diff: cand.diff,
      secrets: cand.secrets,
      selfRef: cand.selfRef,
      summary: eventSummary(cand),
      status: 'pending',
      rounds: 1,
      escalated: false,
      firstSeen: tsIso,
      updatedAt: tsIso,
      ackedAt: null,
      resolvedAt: null,
      note: null,
    };
    existing.push(ev);
    byKey.set(key, ev);
    created.push(ev);
  }
  // 每轮巡检：对所有 pending 事件续轮（当轮 candidate 已在上面处理过，不重复计数）
  for (const e of existing) {
    if (e.status !== 'pending' || candidateKeys.has(e.dedupKey)) continue;
    e.rounds += 1;
    e.updatedAt = tsIso;
    e.escalated = e.rounds >= ESCALATE_AFTER;
    touched += 1;
  }
  return { created, touched };
}

async function loadAlerts() {
  try {
    const text = await readFile(ALERTS_FILE, 'utf8');
    return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

async function writeAlerts(alerts) {
  const sorted = [...alerts].sort((a, b) => (a.firstSeen < b.firstSeen ? -1 : a.firstSeen > b.firstSeen ? 1 : a.id < b.id ? -1 : 1));
  await writeFile(ALERTS_FILE, `${sorted.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
}

// 板首「阻塞项 / 待老板」区自动文案（001-33 定稿第 7 条：guard 侧生成，巡查实例按未 acked 事件刷新）
function renderBoard(pending, tsIso) {
  const escalated = pending.filter((e) => e.escalated);
  const normal = pending.filter((e) => !e.escalated);
  const lines = [
    '<!-- collab-guard 自动生成 · 请勿手改；板上回执「已核对·结论」后由值日实例执行 node guard.mjs --ack <id> -->',
    '## 阻塞项 / 待老板',
    '',
  ];
  if (pending.length === 0) {
    lines.push('当前无阻塞项（P0 pending 0 条）。', '');
    return lines.join('\n');
  }
  lines.push(`> 一句话结论：${pending.length} 条 P0 告警等待回执（其中 ${escalated.length} 条连续 ≥${ESCALATE_AFTER} 轮未处理，已升级置顶）。请相关方回执「已核对·结论：…」，由值日实例对事件 id 执行 --ack。生成时间 ${tsIso}`, '');
  const item = (e) => `- \`${e.id}\` **${e.kind}** · ${e.name} · 待处理 ${e.rounds} 轮 · ${e.summary}`;
  if (escalated.length > 0) {
    lines.push(`### 🔴 置顶（连续 ≥${ESCALATE_AFTER} 轮未处理）`, '', ...escalated.map(item), '');
  }
  if (normal.length > 0) {
    lines.push('### 待处理', '', ...normal.map(item), '');
  }
  return lines.join('\n');
}

async function appendP1(record) {
  await writeFile(P1_FILE, `${JSON.stringify(record)}\n`, { flag: 'a' }).catch(() => {});
}

// ---------- 状态机 CLI：--ack / --resolve（对应板上「已核对·结论」回执，人工执行） ----------
async function doTransition(kind) {
  const flag = kind === 'ack' ? '--ack' : '--resolve';
  const idx = argv.indexOf(flag);
  const id = argv[idx + 1];
  const nIdx = argv.indexOf('--note');
  const note = nIdx >= 0 ? argv.slice(nIdx + 1).join(' ') : '';
  if (!id || id.startsWith('--')) {
    console.error(`缺少事件 id：用法 node guard.mjs ${flag} <id> [--note "已核对·结论：..."]`);
    process.exit(2);
  }
  await mkdir(REPORT_DIR, { recursive: true });
  const alerts = await loadAlerts();
  const ev = alerts.find((e) => e.id === id);
  if (!ev) {
    console.error(`未找到事件 ${id}（现有 ${alerts.length} 条告警）`);
    process.exit(1);
  }
  if (ev.status !== 'pending') {
    console.error(`事件 ${id} 当前状态为 ${ev.status}，只有 pending 可${kind === 'ack' ? '受理' : '解除'}`);
    process.exit(1);
  }
  const ts = now();
  ev.status = kind === 'ack' ? 'acked' : 'resolved';
  ev[kind === 'ack' ? 'ackedAt' : 'resolvedAt'] = ts;
  ev.updatedAt = ts;
  ev.note = note || null;
  await writeAlerts(alerts);
  const pending = alerts.filter((e) => e.status === 'pending');
  await writeFile(BOARD_FILE, renderBoard(pending, ts), 'utf8');
  console.log(`${kind === 'ack' ? '已受理' : '已解除'} ${id}${note ? `：${note}` : ''} · 剩余 pending ${pending.length} 条`);
}

const ackIdx = argv.indexOf('--ack');
const resolveIdx = argv.indexOf('--resolve');
if (ackIdx >= 0 || resolveIdx >= 0) {
  await doTransition(ackIdx >= 0 ? 'ack' : 'resolve');
} else {
  // ---------- 主流程：巡检 ----------
  await mkdir(REPORT_DIR, { recursive: true });
  const registry = JSON.parse(await readFile(REGISTRY, 'utf8'));

  const memUnits = [];
  for (const agent of registry.agents ?? []) memUnits.push(await inspectMemory(agent));
  const memV = memoryVerdict(memUnits);

  const calEntries = registry.caliber ?? [];
  const calUnits = [];
  for (const entry of calEntries) calUnits.push(await inspectCaliber(entry));
  const calComp = caliberComposite(calUnits);

  const prevState = await loadState();
  const firstRun = !prevState;
  const ts = now();
  const events = firstRun ? [{ level: 'info', text: '首次运行：已建立口径基线，下一轮起开始检测变更' }] : caliberEvents(prevState, calUnits);

  // P0 候选 → 去重持久化（p0-alerts.jsonl，供 DSH p0-watch 消费与板首文案）
  const alerts = await loadAlerts();
  const candidates = buildP0Candidates(prevState, calUnits, firstRun);
  const { created, touched } = upsertAlerts(alerts, candidates, ts);
  if (created.length > 0 || touched > 0) await writeAlerts(alerts);
  const pending = alerts.filter((e) => e.status === 'pending');
  const escN = pending.filter((e) => e.escalated).length;
  await writeFile(BOARD_FILE, renderBoard(pending, ts), 'utf8');

  // ③ 备份：P0 事件创建即固化证据副本（只读被巡检路径，只写本工具目录；单条失败不阻断巡检）
  for (const ev of created) {
    const unit = calUnits.find((c) => c.id === ev.caliber);
    if (!unit || unit.state !== '正常' || !unit.path || !existsSync(unit.path)) continue;
    try {
      await saveEvidence(REPORT_DIR, ev, unit.path);
    } catch (e) {
      console.error(`证据固化失败（${ev.id}）：${String(e.message ?? e)}`);
    }
  }

  // ③ 台账（只移动不删除 + 限时保留）：超期条目只标记、工具永不删——在此提醒人工清理
  const ledger = await loadLedger(REPORT_DIR);
  const expiredLedger = ledger.filter((e) => isExpired(e, ts));

  // P1 记录级 → p1-events.jsonl（板内记录 + 收件箱心跳，不置顶不通知）
  const p1Count = [];
  if (!firstRun) {
    const prevMap = new Map((prevState?.caliber ?? []).map((c) => [c.id, c]));
    for (const c of calUnits) {
      if (c.state !== '正常' || c.selfRef) continue;
      const p = prevMap.get(c.id);
      if (!p || p.state !== '正常' || !p.hash || p.hash === c.hash) continue;
      if (c.watch === 'version' && c.version && p.version && c.version !== p.version) {
        await appendP1({ ts, level: 'P1', caliber: c.id, name: c.name, kind: '口径正规升级', version: { from: safeVersion(p.version), to: safeVersion(c.version) }, hash: { from: p.hash, to: c.hash }, diff: caliberDiff(p, c) });
        p1Count.push(c.id);
      } else if (c.watch === 'content') {
        await appendP1({ ts, level: 'P1', caliber: c.id, name: c.name, kind: '口径内容变更', version: { from: safeVersion(p.version), to: safeVersion(c.version) }, hash: { from: p.hash, to: c.hash }, diff: caliberDiff(p, c) });
        p1Count.push(c.id);
      }
    }
  }

  const anomalies = [
    ...memV.empty.map((e) => ({ level: 'warn', text: `记忆空文件：${e}` })),
    ...memV.gone.map((e) => ({ level: 'warn', text: `记忆路径缺失：${e}` })),
    ...memV.missing.map((u) => ({ level: 'warn', text: `未登记记忆：${u.name}` })),
  ];
  const warns = [...anomalies, ...events].filter((e) => e.level === 'warn');
  const infos = events.filter((e) => e.level === 'info');

  const report = {
    tool: 'collab-guard',
    version: '4.6',
    checkedAt: ts,
    root: registry.root,
    firstRun,
    memory: { verdict: memV, units: memUnits },
    // 注意：units 不含 text（口径原文只进 state.json 供下轮字段级 diff，绝不进任何报告类产物——003-42 搜索面判据）；
    // v4.4：units.version 走 safeVersion 形态约束（001-73 二）——latest.json 属「不得含原文」产物
    caliber: { units: calUnits.map(({ text, ...rest }) => ({ ...rest, version: safeVersion(rest.version) })), composite: calComp, events },
    alerts: { total: alerts.length, pending: pending.length, escalated: escN, events: pending },
    summary: { warns: warns.length, infos: infos.length, p0pending: pending.length, escalated: escN, p1: p1Count.length },
    quarantine: { entries: ledger.length, expired: expiredLedger.length, retainDays: RETAIN_DAYS },
  };

  // 落盘：完整报告 + 下一轮对比用的 state（只在本工具目录写；state 含口径原文供下轮字段级 diff）
  await writeFile(join(REPORT_DIR, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(STATE_FILE, JSON.stringify({
    checkedAt: ts,
    caliber: calUnits.map((c) => ({ id: c.id, hash: c.hash, version: c.version, state: c.state, selfRef: c.selfRef, text: c.text })),
  }, null, 2), 'utf8');

  // ---------- 输出 ----------
  const memLine = memV.parts.join(' ｜ ');
  const calLine = calUnits.length === 0
    ? '口径未登记'
    : `口径 ${calUnits.filter((c) => c.state === '正常').length}/${calUnits.length}`;
  const compLine = calComp ? `口径指纹 ${calComp}` : '口径指纹（无可比较文件）';
  const alertLine = pending.length > 0
    ? `⚠ P0 告警 pending ${pending.length} 条${escN > 0 ? `（置顶 ${escN}）` : ''} · 板首阻塞区 reports/board-pending.md`
    : '·';

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
      console.log(`| ${c.name} | ${c.state} | ${showVersion(c.version)} | ${c.bytes} | ${c.hash ?? '-'} | ${when} |`);
    }
    console.log('');
    console.log(`## P0 告警（pending ${pending.length} / 置顶 ${escN} · 默认不外发，见 reports/board-pending.md）`);
    if (pending.length === 0) {
      console.log('（无）');
    } else {
      console.log('| id | 类型 | 名称 | 轮次 | 摘要 |');
      console.log('|---|---|---|---|---|');
      for (const e of pending) {
        console.log(`| ${e.id} | ${e.kind} | ${e.name} | ${e.rounds}${e.escalated ? '（置顶）' : ''} | ${e.summary} |`);
      }
    }
    console.log('');
    if (ledger.length === 0) {
      console.log('## 备份/quarantine 台账（无记录）');
    } else {
      console.log(`## 备份/quarantine 台账（${ledger.length} 条 · 限时保留 ${RETAIN_DAYS} 天 · 到期只标记、工具永不删${expiredLedger.length > 0 ? ` · ⚠ ${expiredLedger.length} 条超期待人工清理` : ''}）`);
      console.log('| id | 动作 | 名称 | 字节 | 留截至期 | 状态 |');
      console.log('|---|---|---|---|---|---|');
      for (const e of ledger) {
        const when = e.retainUntil ? new Date(e.retainUntil).toLocaleString('sv-SE') : '-';
        console.log(`| ${e.id} | ${e.action}${e.ref ? `(${e.ref})` : ''} | ${e.name ?? '-'} | ${e.bytes ?? '-'} | ${when} | ${isExpired(e, ts) ? '待人工清理（已超期）' : '在留'} |`);
      }
    }
  } else {
    // 默认输出：干净时一行；有事件时逐条列出（告警明细只在 --full/--json/板首文件，默认不刷屏）
    const ledgerLine = expiredLedger.length > 0
      ? `⚠ 备份/quarantine 台账 ${expiredLedger.length} 条超期待人工清理（只移动不删除，工具永不删；node scripts/quarantine.mjs --list）`
      : '';
    if (warns.length === 0 && infos.length === 0) {
      console.log(`巡检正常 · ${memLine} · ${compLine} · ${calLine} · 口径无变更${pending.length > 0 ? ` · ${alertLine}` : ''}${ledgerLine ? `\n${ledgerLine}` : ''}`);
    } else {
      console.log(`巡检 · ${memLine} · ${compLine} · ${calLine}${pending.length > 0 ? `\n${alertLine}` : ''}`);
      for (const e of [...warns, ...infos]) console.log(`${e.level === 'warn' ? '⚠' : '·'} ${e.text}`);
      if (ledgerLine) console.log(ledgerLine);
    }
  }
}
