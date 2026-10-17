// ③ 备份 / quarantine 机制（留言板 001-23 候选工作项第 3 件；001-33 定稿排期③首发，2026-10-18）
// v4.3（2026-10-18 · workbuddy-step-5-preview，001-67 P3 / 001-68 源码复核确认 / 001-69 附议）：
//   证据固化由无条件覆盖改为「只写不覆盖」——目标已存在则转存 <name>.<seq>，与搬移/回迁
//   的拒绝覆盖纪律对称（同事件 id 二次固化不改动既有副本；台账 sha256 与磁盘恒等）。
// 规则（001-23 原文）：**只移动不删除 + 台账 jsonl + 限时保留**——服务「发现异常后有据可查」。
//  - 备份：P0 告警事件创建时，guard 自动把被巡检口径文件的原字节固化为
//    reports/evidence/<事件id>/ 副本（只读被巡检路径，只写本工具目录——不破坏 guard 只读纪律）；
//  - quarantine：人工显式命令才搬移文件（本 CLI --quarantine <路径>），文件移入
//    reports/quarantine/<时间戳>-<文件名>/，--unquarantine <台账id> 原样回迁；
//  - 只移动不删除：本工具任何路径都不删除文件（含超期条目）——到期只在台账标「待人工清理」，
//    真正的删除必须由人显式执行，工具永不代劳；回迁/搬移也绝不覆盖已存在目标；
//  - 限时保留：台账每条带 retainUntil（默认 90 天），--list 与巡检输出提示超期未清理条目。
// 纪律：evidence/ 与 quarantine/ 含被巡检文件原字节（可能带敏感键原值，同 state.json）——
//       reports/ 整体 gitignore，严禁入库 / 同步 / 外发。
// 台账：reports/quarantine-ledger.jsonl（jsonl 追加式；action: evidence | move-in | move-back）。
import { readFile, writeFile, mkdir, rename, copyFile, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const RETAIN_DAYS = 90; // 限时保留默认天数（台账条目 retainUntil）

export const ledgerPath = (reportDir) => join(reportDir, 'quarantine-ledger.jsonl');
export const evidenceDirOf = (reportDir, eventId) => join(reportDir, 'evidence', eventId);
export const quarantineDir = (reportDir) => join(reportDir, 'quarantine');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const nowIso = () => new Date().toISOString();

export function retainUntilOf(tsIso, days = RETAIN_DAYS) {
  return new Date(new Date(tsIso).getTime() + days * 86400000).toISOString();
}

// 超期判定：retainUntil 早于当前时间。超期只在台账/输出标记「待人工清理」，工具永不删除文件。
export function isExpired(entry, nowIsoStr = nowIso()) {
  return !!entry?.retainUntil && new Date(entry.retainUntil).getTime() < new Date(nowIsoStr).getTime();
}

export async function appendLedger(reportDir, entry) {
  await mkdir(reportDir, { recursive: true });
  await writeFile(ledgerPath(reportDir), `${JSON.stringify(entry)}\n`, { flag: 'a' });
}

export async function loadLedger(reportDir) {
  try {
    const text = await readFile(ledgerPath(reportDir), 'utf8');
    return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

function nextLedgerId(entries, tsIso) {
  const d = tsIso.slice(0, 10).replace(/-/g, '');
  const hms = tsIso.slice(11, 19).replace(/:/g, '');
  const prefix = `lg-${d}-${hms}-`;
  let seq = 1;
  for (const e of entries) {
    if (typeof e.id === 'string' && e.id.startsWith(prefix)) seq += 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// 移动语义：优先 rename；跨卷（EXDEV）退化为复制到目标后移除源——字节不丢失、不覆盖目标。
async function moveFile(src, dst) {
  try {
    await rename(src, dst);
  } catch (e) {
    if (e && e.code === 'EXDEV') {
      await copyFile(src, dst);
      await unlink(src);
    } else {
      throw e;
    }
  }
}

// ③ v4.3（001-67 P3 / 001-68 源码复核确认）：saveEvidence 曾用无条件 writeFile 覆盖——
// 全模块唯一不做「拒绝覆盖」的写入点，与搬移 :129/回迁 :157 的 existsSync 纪律不对称。
// 同事件 id 二次固化会静默替换首份副本（旧字节不可恢复），且首条 evidence 台账 sha256
// 与磁盘脱节（台账自证失效）。改为只写不覆盖 + 已存在转存 <name>.<seq>。
// 只写不覆盖（与搬移/回迁「绝不覆盖已存在目标」纪律对称）：wx 标志保证存在即 EEXIST，
// 转存序列在此之上防竞态；永不覆盖、永不删除（只移动不删除纪律）。
// v4.4（001-72 三.2 P2 观察 / 001-74.5 附议同批修）：转存序号加上限兜底——目录被塞满
// <name>.N 时原实现理论上无限转存；超限抛错请人工清理，不再空转。
const SEQ_LIMIT = 1000;
async function writeNoOverwrite(target, data) {
  const dir = dirname(target);
  const name = basename(target);
  for (let seq = 1; seq <= SEQ_LIMIT; seq += 1) {
    const candidate = seq === 1 ? target : join(dir, `${name}.${seq}`);
    try {
      await writeFile(candidate, data, { flag: 'wx' });
      return candidate;
    } catch (e) {
      if (e && e.code === 'EEXIST') continue; // 转存下一序号，绝不覆盖既有副本
      throw e;
    }
  }
  throw new Error(`转存序号超过上限 ${SEQ_LIMIT}，拒绝继续转存（只写不覆盖，请人工清理目标目录）：${target}`);
}

// ---------- 备份：P0 事件创建即固化证据副本（guard 巡检内自动调用） ----------
export async function saveEvidence(reportDir, ev, absPath) {
  const buf = await readFile(absPath);
  const dir = evidenceDirOf(reportDir, ev.id);
  await mkdir(dir, { recursive: true });
  const target = await writeNoOverwrite(join(dir, basename(absPath)), buf);
  const ts = nowIso();
  const meta = {
    eventId: ev.id,
    kind: ev.kind,
    caliber: ev.caliber ?? null,
    name: ev.name ?? null,
    path: absPath,
    bytes: buf.length,
    sha256: sha256(buf),
    version: ev.version?.to ?? null,
    hash: ev.hash?.to ?? null,
    savedAt: ts,
    note: 'P0 告警创建时的原字节固化副本（③备份，001-23/001-33）；只读被巡检路径写入，未修改原文件',
  };
  await writeNoOverwrite(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  const entry = {
    id: nextLedgerId(await loadLedger(reportDir), ts),
    ts,
    action: 'evidence',
    eventId: ev.id,
    name: ev.name ?? null,
    path: absPath,
    target,
    bytes: buf.length,
    sha256: meta.sha256,
    reason: `P0 事件创建自动固化（${ev.kind}）`,
    retainUntil: retainUntilOf(ts),
  };
  await appendLedger(reportDir, entry);
  return entry;
}

// ---------- quarantine：人工显式搬移（只移动，绝不删除、绝不覆盖） ----------
export async function quarantineFile(reportDir, absPath, reason = '') {
  const src = resolve(absPath);
  if (!existsSync(src)) throw new Error(`路径不存在：${src}`);
  const qRoot = quarantineDir(reportDir);
  if (src === qRoot || src.startsWith(`${qRoot}${sep}`)) throw new Error(`该文件已在 quarantine 目录内：${src}`);
  const st = await stat(src);
  if (!st.isFile()) throw new Error(`只支持搬移文件（目录请人工处理）：${src}`);
  const ts = nowIso();
  const sub = `${ts.slice(0, 19).replace(/[-:T]/g, '')}-${basename(src)}`;
  const dir = join(qRoot, sub);
  const target = join(dir, basename(src));
  if (existsSync(target)) throw new Error(`目标已存在，拒绝覆盖（只移动不删除、不覆盖）：${target}`);
  await mkdir(dir, { recursive: true });
  const buf = await readFile(src);
  await moveFile(src, target);
  const entry = {
    id: nextLedgerId(await loadLedger(reportDir), ts),
    ts,
    action: 'move-in',
    name: basename(src),
    path: src,
    target,
    bytes: st.size,
    sha256: sha256(buf),
    reason: reason || null,
    retainUntil: retainUntilOf(ts),
  };
  await appendLedger(reportDir, entry);
  return entry;
}

// 回迁：把 move-in 条目对应的文件原样移回原路径（原路径已存在则拒绝，绝不覆盖）
export async function restoreFile(reportDir, id) {
  const entries = await loadLedger(reportDir);
  const moveIn = entries.find((e) => e.id === id);
  if (!moveIn || moveIn.action !== 'move-in') throw new Error(`未找到 move-in 台账条目 ${id}`);
  const restored = entries.find((e) => e.action === 'move-back' && e.ref === id);
  if (restored) throw new Error(`${id} 已于 ${restored.ts} 回迁至 ${restored.path}，不要重复回迁`);
  if (!existsSync(moveIn.target)) throw new Error(`quarantine 内文件不存在：${moveIn.target}（台账 ${id}）`);
  if (existsSync(moveIn.path)) throw new Error(`原路径已存在同名文件，拒绝覆盖（只移动不删除、不覆盖）：${moveIn.path}`);
  const ts = nowIso();
  await moveFile(moveIn.target, moveIn.path);
  const entry = {
    id: nextLedgerId(entries, ts),
    ts,
    action: 'move-back',
    ref: id,
    name: moveIn.name,
    path: moveIn.path,
    target: moveIn.target,
    bytes: moveIn.bytes,
    sha256: moveIn.sha256,
    reason: null,
    retainUntil: retainUntilOf(ts),
  };
  await appendLedger(reportDir, entry);
  return entry;
}

export function renderLedger(entries, nowIsoStr = nowIso()) {
  if (entries.length === 0) return '台账为空（暂无备份 / quarantine 记录）';
  const lines = [
    `备份/quarantine 台账（${entries.length} 条 · 限时保留 ${RETAIN_DAYS} 天 · 到期只标记「待人工清理」，工具永不删除）`,
    'id ｜ 动作 ｜ 名称 ｜ 原路径 → 目标 ｜ 字节 ｜ 留截至期 ｜ 状态',
  ];
  for (const e of entries) {
    const status = isExpired(e, nowIsoStr) ? '待人工清理（已超期）' : '在留';
    lines.push(`${e.id} ｜ ${e.action}${e.ref ? `(${e.ref})` : ''} ｜ ${e.name ?? '-'} ｜ ${e.path} → ${e.target} ｜ ${e.bytes ?? '-'} ｜ ${e.retainUntil ?? '-'} ｜ ${status}`);
  }
  return lines.join('\n');
}

// ---------- CLI（被 guard 导入时不算 main，不执行） ----------
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const flagValue = (name) => {
    const i = argv.indexOf(name);
    if (i < 0) return null;
    const v = argv[i + 1];
    return v && !v.startsWith('--') ? v : null;
  };
  const regArg = flagValue('--registry');
  const REGISTRY = resolve(regArg ?? join(HERE, '..', 'registry.json'));
  const REPORT_DIR = join(dirname(REGISTRY), 'reports');
  const qPath = flagValue('--quarantine');
  const uId = flagValue('--unquarantine');
  const reason = flagValue('--reason') ?? '';
  try {
    if (qPath) {
      const entry = await quarantineFile(REPORT_DIR, qPath, reason);
      console.log(`已搬移 → ${entry.target}（台账 ${entry.id} · 保留至 ${entry.retainUntil} · 原路径已不留副本，回迁用 --unquarantine ${entry.id}）`);
    } else if (uId) {
      const entry = await restoreFile(REPORT_DIR, uId);
      console.log(`已回迁 → ${entry.path}（台账 ${entry.id} · 对应搬移 ${entry.ref}）`);
    } else if (argv.includes('--list')) {
      console.log(renderLedger(await loadLedger(REPORT_DIR)));
    } else {
      console.log('用法：node scripts/quarantine.mjs --quarantine <路径> [--reason "..."]');
      console.log('      node scripts/quarantine.mjs --unquarantine <台账id>');
      console.log('      node scripts/quarantine.mjs --list [--registry <path>]');
      console.log('规则：只移动不删除；到期只标记「待人工清理」，工具永不删文件；回迁绝不覆盖已存在目标。');
    }
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(2);
  }
}
