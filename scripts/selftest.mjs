// collab-guard 自测（npm test）：八场景
// 场景1 首跑建立基线 / 场景2 无变更安静输出 / 场景3 静默改口径告警 / 场景4 正规升版本+内容变更
// 场景5 敏感键误写→P0 且原值全串不出现在任何产物 / 场景6 去重+升级置顶+--ack / 场景7 词库自指变更→P0 且不回显词库内容
// 场景8（v4.1，按 001-55 红项修法 + 001-57 判据-断言不等价三条 + 001-58 #7 断言）：
//   8a 词库对齐断言（AGENTS.md 扫描词库 ⊆ guard 模式清单，集合差非空即红）
//   8b/8c 短命中值（12 字符）只报键名+类型、占位替换、全串不进任何产物
//   8d/8e/8f 新模式全词项（LTAI/AKID/AIza/PEM/ssh-rsa）命中 P0；原值全串（含 stderr 与
//            JSON 规范化形态）不进 jsonl/stdout/stderr/latest.json/board-pending.md（#7 断言）
// 场景9（v4.2，③ 备份/quarantine 首发：001-23 候选第 3 件 / 001-33 排期③）：
//   9a P0 创建自动固化证据（原字节副本+meta+台账 evidence 条目，台账无原值）
//   9b/9c --quarantine 搬移与 --unquarantine 回迁（只移动：原路径消失/恢复且字节一致）
//   9d/9e 重复回迁被拒、原路径复现拒绝覆盖（绝不覆盖已存在目标）
//   9f 限时保留只标记不删（超期条目标「待人工清理」，工具永不删文件）
// 用法：node scripts/selftest.mjs（在仓库根目录运行；或 npm test）
// 纪律：只在临时目录造夹具，不碰真实 registry 与被巡检文件。
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { SENSITIVE_PATTERNS, AGENTS_SCAN_VOCAB } from './patterns.mjs';
import { loadLedger, appendLedger, RETAIN_DAYS } from './quarantine.mjs';

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const GUARD = join(REPO, 'guard.mjs');

// v4.1（001-55 判据 1 不等价条①）：失败时把 stderr 一并拼进 raw——guard 的 console.error
// 只回显事件 id 与状态，但判据要求的搜索面含「guard 自身的错误/失败日志输出」。
const run = async (registry, extra = []) => {
  try {
    return await execFileP(process.execPath, [GUARD, '--registry', registry, ...extra], { encoding: 'utf8' });
  } catch (e) {
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

// 跑仓库内其他 CLI（场景 9 的 quarantine CLI）；非零退出同样取回 stdout/stderr 不断言
const runScript = async (script, args) => {
  try {
    return await execFileP(process.execPath, [script, ...args], { encoding: 'utf8' });
  } catch (e) {
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

// v4.1（001-55 判据 1 不等价条②）：比对前先 JSON.parse 规范化再全文扫——JSON 转义形态
// （\/、\uXXXX）与嵌套序列化后的形态与字面形态等价，一行代码覆盖该分支。
const scanForms = (s) => {
  const forms = [String(s)];
  try { forms.push(JSON.stringify(JSON.parse(s))); } catch { /* 非 JSON（stdout/md）保留字面形态 */ }
  return forms.join('\n');
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    实际输出：${String(detail).trim().slice(0, 600)}`}`);
};

const tmp = await mkdtemp(join(tmpdir(), 'collab-guard-selftest-'));
try {
  const fixtures = join(tmp, 'fixtures');
  await mkdir(fixtures, { recursive: true });
  const roiPath = join(fixtures, 'roi.json');
  const glossaryPath = join(fixtures, 'glossary.md');
  const wordlistPath = join(fixtures, 'wordlist.json');
  const registry = join(tmp, 'registry.json');

  await writeFile(roiPath, JSON.stringify({ version: '1.0', rules: { breakeven: 14.81 } }, null, 2));
  await writeFile(glossaryPath, '# 术语表\n\nv1\n');
  await writeFile(wordlistPath, JSON.stringify({ version: 'w1', markers: ['示例占位A', '示例占位B'] }, null, 2));
  await writeFile(registry, JSON.stringify({
    version: 4,
    root: tmp,
    agents: [],
    caliber: [
      { id: 'roi', name: '测试ROI规则', path: roiPath, watch: 'version', versionField: 'version' },
      { id: 'glossary', name: '测试术语表', path: glossaryPath, watch: 'content' },
      { id: 'wordlist', name: '测试词库', path: wordlistPath, watch: 'version', versionField: 'version', selfRef: true },
    ],
  }, null, 2));

  const readJsonl = async () => {
    try {
      const t = await readFile(join(tmp, 'reports', 'p0-alerts.jsonl'), 'utf8');
      return t.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    } catch { return []; }
  };

  // 场景 1：首跑建立基线
  const r1 = await run(registry);
  check('场景1 首跑建立基线', r1.stdout.includes('首次运行') && r1.stdout.includes('已建立口径基线'), r1.stdout);

  // 场景 2：无变更 → 干净一行
  const r2 = await run(registry);
  check('场景2 无变更安静输出', r2.stdout.includes('口径无变更'), r2.stdout);

  // 场景 3：静默改口径（版本不变、内容变）→ ⚠ 告警 + P0 事件
  await writeFile(roiPath, JSON.stringify({ version: '1.0', rules: { breakeven: 99.99 } }, null, 2));
  const r3 = await run(registry);
  check('场景3 静默改口径告警', r3.stdout.includes('静默改口径告警') && r3.stdout.includes('P0 告警 pending'), r3.stdout);

  // 场景 4：正规升版本 + 术语表内容变更 → 记录级事件（P1）
  await writeFile(roiPath, JSON.stringify({ version: '1.1', rules: { breakeven: 99.99 } }, null, 2));
  await writeFile(glossaryPath, '# 术语表\n\nv2 改了\n');
  const r4 = await run(registry);
  check(
    '场景4 口径版本变更+内容变更',
    r4.stdout.includes('口径版本变更：测试ROI规则 1.0 → 1.1') && r4.stdout.includes('口径内容变更：测试术语表'),
    r4.stdout,
  );

  // 场景 5：静默改口径 + 命中敏感键 → P0「敏感键误写」；原值全串不得出现在 jsonl / stdout / latest.json / board-pending.md
  const SECRET_FULL = 'sk-abcdef1234567890deadbeef';
  await writeFile(roiPath, JSON.stringify({ version: '1.0', rules: { breakeven: 14.81 }, note: `cfg ${SECRET_FULL}` }, null, 2));
  const r5 = await run(registry);
  const alerts5 = await readJsonl();
  const latest5 = await readFile(join(tmp, 'reports', 'latest.json'), 'utf8');
  const board5 = await readFile(join(tmp, 'reports', 'board-pending.md'), 'utf8');
  const raw5 = scanForms(JSON.stringify(alerts5)) + scanForms(r5.stdout) + scanForms(r5.stderr ?? '') + scanForms(latest5) + scanForms(board5);
  const ev5 = alerts5.find((e) => e.kind === '敏感键误写');
  check('场景5a P0 事件类型=敏感键误写', !!ev5 && ev5.secrets.includes('sk-') && ev5.status === 'pending' && /^evt-\d{8}-\d{6}-\d{3}$/.test(ev5.id), JSON.stringify(alerts5, null, 1));
  check('场景5b 原值全串不出现在任何产物', !raw5.includes(SECRET_FULL), raw5.slice(0, 300));
  check('场景5c diff 值为脱敏占位', !!ev5 && ev5.diff.length > 0 && ev5.diff.every((d) => !d.to.includes(SECRET_FULL)) && ev5.summary.includes('命中敏感键'), JSON.stringify(ev5?.diff));
  check('场景5d 板首文案含该事件', !!ev5 && board5.includes(ev5.id) && board5.includes('阻塞项'), board5);

  // 场景 6：同一 P0 第二轮 → 去重（事件数不变、rounds=2、escalated 置顶）；--ack 后板首清空、同 key 不复发
  const r6 = await run(registry);
  const alerts6 = await readJsonl();
  const ev6 = alerts6.find((e) => e.kind === '敏感键误写');
  check('场景6a 去重（同 key 不新增事件）', alerts6.length === alerts5.length && ev6 && ev6.rounds === 2 && ev6.escalated === true, JSON.stringify(alerts6.map((e) => [e.id, e.rounds, e.escalated])));
  const board6 = await readFile(join(tmp, 'reports', 'board-pending.md'), 'utf8');
  check('场景6b 连续2轮未处理升级置顶', board6.includes('置顶') && board6.includes(ev6.id), board6);
  const ack = await run(registry, ['--ack', ev6.id, '--note', '已核对·结论：误写已修正']);
  check('场景6c --ack 受理', ack.stdout.includes('已受理') && ack.stdout.includes(ev6.id), ack.stdout);
  await run(registry);
  const alerts7 = await readJsonl();
  const board7 = await readFile(join(tmp, 'reports', 'board-pending.md'), 'utf8');
  check('场景6d ack 后同 key 不复发且板首移除该事件', alerts7.length === alerts6.length && alerts7.find((e) => e.id === ev6.id).status === 'acked' && !board7.includes(ev6.id), board7);

  // 场景 7：词库自指变更（selfRef 文件内容变、版本不变）→ P0「词库自指变更」，且告警不回显词库内容
  const MARKER = 'WORDLISTMARKER9f3k7q2w1x8';
  await writeFile(wordlistPath, JSON.stringify({ version: 'w1', markers: ['示例占位A', MARKER] }, null, 2));
  const r8 = await run(registry);
  const alerts8 = await readJsonl();
  const ev8 = alerts8.find((e) => e.kind === '词库自指变更');
  const raw8 = scanForms(JSON.stringify(alerts8)) + scanForms(r8.stdout) + scanForms(r8.stderr ?? '') + scanForms(await readFile(join(tmp, 'reports', 'latest.json'), 'utf8')) + scanForms(await readFile(join(tmp, 'reports', 'board-pending.md'), 'utf8'));
  check('场景7a 词库变更即 P0', !!ev8 && ev8.level === 'P0' && ev8.status === 'pending', JSON.stringify(alerts8, null, 1));
  check('场景7b 告警不回显词库内容', !raw8.includes(MARKER), raw8.slice(0, 300));
  check('场景7c diff 值整体脱敏', !!ev8 && ev8.diff.every((d) => d.from === '(脱敏)' && d.to === '(脱敏)'), JSON.stringify(ev8?.diff));

  // 场景 8（v4.1）：词库对齐断言 + 短命中值占位替换 + 新模式全词项（含 #7 板首无原值断言）
  // 8a：AGENTS.md 提交前扫描词库 ⊆ guard 模式清单（001-55 修法②：集合差非空即红，防再次漂移）
  const vocabTypes = new Set(AGENTS_SCAN_VOCAB.map((v) => v.type));
  const patternTypes = new Set(SENSITIVE_PATTERNS.map((p) => p.type));
  const drift = [...vocabTypes].filter((t) => !patternTypes.has(t));
  check('场景8a 词库对齐断言（AGENTS.md 词库 ⊆ guard 模式清单）', drift.length === 0, `漂移项：${drift.join('、') || '（无）'}`);

  // 8b/8c：短命中值（12 字符，token 模式最小长度边界）——只报键名+命中类型；占位替换；全串不进任何产物
  // （放在 note 值里而非 JSON 键：token/api-key 模式面向 `password: value` 非引号上下文，与场景 5 同路径）
  const SHORT_HIT = 'abcdefghijkl';
  await writeFile(roiPath, JSON.stringify({ version: '1.0', rules: { breakeven: 14.81 }, note: `passphrase=${SHORT_HIT}` }, null, 2));
  const r8b = await run(registry);
  const alerts8b = await readJsonl();
  const latest8b = await readFile(join(tmp, 'reports', 'latest.json'), 'utf8');
  const board8b = await readFile(join(tmp, 'reports', 'board-pending.md'), 'utf8');
  const raw8b = scanForms(JSON.stringify(alerts8b)) + scanForms(r8b.stdout) + scanForms(r8b.stderr ?? '') + scanForms(latest8b) + scanForms(board8b);
  const ev8b = alerts8b.find((e) => e.kind === '敏感键误写' && e.secrets.includes('token'));
  check('场景8b 短命中值只报键名+命中类型', !!ev8b && ev8b.secrets.length === 1 && ev8b.secrets[0] === 'token' && ev8b.summary.includes('命中敏感键 token'), JSON.stringify(ev8b));
  check('场景8c 短值占位替换（全串不进任何产物）', !!ev8b && ev8b.diff.length > 0 && ev8b.diff.every((d) => !d.to.includes(SHORT_HIT)) && !raw8b.includes(SHORT_HIT), raw8b.slice(0, 300));

  // 8d/8e/8f：新模式全词项（LTAI/AKID/AIza/PEM 私钥块/ssh-rsa，001-55 红项）→ P0 五类命中；
  //          原值全串不进任何产物（含 #7：board-pending.md 全文无敏感原文——001-58 断言）
  const FAKE = {
    ltai: 'LTAIabcdefghijklmn',
    akid: 'AKIDabcdefghijkl',
    aiza: 'AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    pem: '-----BEGIN PRIVATE KEY-----',
    ssh: 'ssh-rsa AAAAabcdefghijklmnopqrst',
  };
  const NEW_TYPES = ['LTAI', 'AKID', 'AIza', 'pem-key', 'ssh-rsa'];
  const roi8dText = JSON.stringify({ version: '1.0', rules: { breakeven: 14.81 }, ...FAKE }, null, 2);
  await writeFile(roiPath, roi8dText);
  const r8d = await run(registry);
  const alerts8d = await readJsonl();
  const latest8d = await readFile(join(tmp, 'reports', 'latest.json'), 'utf8');
  const board8d = await readFile(join(tmp, 'reports', 'board-pending.md'), 'utf8');
  const raw8d = scanForms(JSON.stringify(alerts8d)) + scanForms(r8d.stdout) + scanForms(r8d.stderr ?? '') + scanForms(latest8d) + scanForms(board8d);
  const ev8d = alerts8d.find((e) => e.kind === '敏感键误写' && e.secrets.includes('LTAI'));
  check('场景8d 新模式五类全部命中 P0', !!ev8d && NEW_TYPES.every((t) => ev8d.secrets.includes(t)), JSON.stringify(ev8d?.secrets));
  check('场景8e 新模式原值全串不进任何产物', Object.values(FAKE).every((v) => !raw8d.includes(v)), raw8d.slice(0, 300));
  check('场景8f 板首文案含该事件且无原值（#7 断言）', !!ev8d && board8d.includes(ev8d.id) && Object.values(FAKE).every((v) => !board8d.includes(v)), board8d);

  // 场景 9（③ 备份/quarantine 首发：001-23 候选第 3 件 / 001-33 排期③）：
  // 9a P0 创建自动固化证据（原字节副本 + meta + 台账 evidence 条目；台账不含原值）
  // 9b --quarantine 搬移（原路径消失、目标在 quarantine 内、台账记原因与 sha256）
  // 9c --unquarantine 回迁（字节一致恢复、台账 move-back ref 对应）
  // 9d 重复回迁被拒；9e 原路径复现时拒绝覆盖（人工清理后才回迁）
  // 9f 限时保留只标记不删：超期条目 --list 标「待人工清理」，任何文件都未被工具删除
  const QUAR = join(REPO, 'scripts', 'quarantine.mjs');
  const reportsDir = join(tmp, 'reports');
  const evDir9 = join(reportsDir, 'evidence', ev8d.id);
  let ev9Detail = '';
  let ev9Ok = false;
  try {
    const evCopy = await readFile(join(evDir9, 'roi.json'), 'utf8');
    const evMeta = JSON.parse(await readFile(join(evDir9, 'meta.json'), 'utf8'));
    const lgEv = (await loadLedger(reportsDir)).find((e) => e.action === 'evidence' && e.eventId === ev8d.id);
    ev9Detail = `副本=${evCopy === roi8dText} meta=${evMeta.eventId === ev8d.id} 台账=${!!lgEv}`;
    ev9Ok = evCopy === roi8dText && evMeta.eventId === ev8d.id && !!lgEv
      && lgEv.target.includes(ev8d.id) && !Object.values(FAKE).some((v) => JSON.stringify(lgEv).includes(v));
  } catch (e) {
    ev9Detail = String(e.message ?? e);
  }
  check('场景9a P0 创建自动固化证据（原字节副本+meta+台账，台账无原值）', ev9Ok, ev9Detail);

  // 9b：把 roi.json 搬移进 quarantine（原路径不再有该文件——搬移不是复制）
  const q9 = await runScript(QUAR, ['--registry', registry, '--quarantine', roiPath, '--reason', '自测搬移']);
  const moveIn = (await loadLedger(reportsDir)).filter((e) => e.action === 'move-in').pop();
  const qSub = moveIn ? dirname(moveIn.target) : '';
  check('场景9b --quarantine 搬移（原路径消失、目标在 quarantine 内、台账记原因与 sha256）',
    q9.stdout.includes('已搬移') && !existsSync(roiPath) && !!moveIn && moveIn.reason === '自测搬移'
    && !!moveIn.sha256 && existsSync(join(qSub, 'roi.json')),
    q9.stdout + (q9.stderr ?? ''));

  // 9c：回迁——原路径恢复且字节与搬移前逐字节一致（只移动、不损坏）
  const u9 = await runScript(QUAR, ['--registry', registry, '--unquarantine', moveIn.id]);
  const moveBack = (await loadLedger(reportsDir)).find((e) => e.action === 'move-back' && e.ref === moveIn.id);
  check('场景9c --unquarantine 回迁（字节一致恢复、台账 move-back ref 对应）',
    u9.stdout.includes('已回迁') && existsSync(roiPath) && (await readFile(roiPath, 'utf8')) === roi8dText && !!moveBack,
    u9.stdout + (u9.stderr ?? ''));

  // 9d：同一搬移重复回迁被拒（不许两条 move-back 指向同一来源）
  const u9d = await runScript(QUAR, ['--registry', registry, '--unquarantine', moveIn.id]);
  check('场景9d 重复回迁被拒', (u9d.stderr ?? '').includes('不要重复回迁'), u9d.stderr ?? u9d.stdout);

  // 9e：原路径复现时回迁被拒（绝不覆盖）；人工清掉复现文件后才回迁成功
  await runScript(QUAR, ['--registry', registry, '--quarantine', roiPath, '--reason', '自测搬移2']);
  const moveIn2 = (await loadLedger(reportsDir)).filter((e) => e.action === 'move-in').pop();
  await writeFile(roiPath, 'REAPPEARED');
  const u9e1 = await runScript(QUAR, ['--registry', registry, '--unquarantine', moveIn2.id]);
  const refusedOverwrite = (u9e1.stderr ?? '').includes('拒绝覆盖');
  await rm(roiPath, { force: true });
  const u9e2 = await runScript(QUAR, ['--registry', registry, '--unquarantine', moveIn2.id]);
  check('场景9e 原路径复现拒绝覆盖回迁，人工清理后回迁成功',
    refusedOverwrite && u9e2.stdout.includes('已回迁') && (await readFile(roiPath, 'utf8')) === roi8dText,
    (u9e1.stderr ?? '') + (u9e2.stdout ?? ''));

  // 9f：限时保留——超期条目只在 --list 标记「待人工清理」，工具不删任何文件（只移动不删除）
  const retainPast = new Date(Date.now() - 86400000).toISOString();
  await appendLedger(reportsDir, {
    id: 'lg-expired-fixture', ts: retainPast, action: 'move-in', name: '历史夹具',
    path: 'x', target: 'y', bytes: 1, sha256: 'fixture', reason: '夹具', retainUntil: retainPast,
  });
  const list9 = await runScript(QUAR, ['--registry', registry, '--list']);
  check('场景9f 限时保留只标记不删（超期条目标「待人工清理」，文件均未被工具删除）',
    list9.stdout.includes('待人工清理') && list9.stdout.includes('lg-expired-fixture')
    && existsSync(roiPath) && existsSync(join(evDir9, 'roi.json')),
    list9.stdout);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(failed.length === 0 ? `自测通过：${results.length}/${results.length}` : `自测失败：${failed.length}/${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
