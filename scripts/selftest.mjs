// collab-guard 四场景自测：基线 / 无变更 / 静默改口径告警 / 正规升版本+内容变更
// 用法：node scripts/selftest.mjs（在仓库根目录运行；或 npm test）
// 纪律：只在临时目录造夹具，不碰真实 registry 与被巡检文件。
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const GUARD = join(REPO, 'guard.mjs');

const run = (registry) => execFileP(process.execPath, [GUARD, '--registry', registry], { encoding: 'utf8' });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    实际输出：${detail.trim()}`}`);
};

const tmp = await mkdtemp(join(tmpdir(), 'collab-guard-selftest-'));
try {
  const fixtures = join(tmp, 'fixtures');
  await mkdir(fixtures, { recursive: true });
  const roiPath = join(fixtures, 'roi.json');
  const glossaryPath = join(fixtures, 'glossary.md');
  const registry = join(tmp, 'registry.json');

  await writeFile(roiPath, JSON.stringify({ version: '1.0', rules: { breakeven: 14.81 } }, null, 2));
  await writeFile(glossaryPath, '# 术语表\n\nv1\n');
  await writeFile(registry, JSON.stringify({
    version: 3,
    root: tmp,
    agents: [],
    caliber: [
      { id: 'roi', name: '测试ROI规则', path: roiPath, watch: 'version', versionField: 'version' },
      { id: 'glossary', name: '测试术语表', path: glossaryPath, watch: 'content' },
    ],
  }, null, 2));

  // 场景 1：首跑建立基线
  const r1 = await run(registry);
  check('场景1 首跑建立基线', r1.stdout.includes('首次运行') && r1.stdout.includes('已建立口径基线'), r1.stdout);

  // 场景 2：无变更 → 干净一行
  const r2 = await run(registry);
  check('场景2 无变更安静输出', r2.stdout.includes('口径无变更'), r2.stdout);

  // 场景 3：静默改口径（版本不变、内容变）→ ⚠ 告警
  await writeFile(roiPath, JSON.stringify({ version: '1.0', rules: { breakeven: 99.99 } }, null, 2));
  const r3 = await run(registry);
  check('场景3 静默改口径告警', r3.stdout.includes('静默改口径告警'), r3.stdout);

  // 场景 4：正规升版本 + 术语表内容变更 → 记录级事件
  await writeFile(roiPath, JSON.stringify({ version: '1.1', rules: { breakeven: 99.99 } }, null, 2));
  await writeFile(glossaryPath, '# 术语表\n\nv2 改了\n');
  const r4 = await run(registry);
  check(
    '场景4 口径版本变更+内容变更',
    r4.stdout.includes('口径版本变更：测试ROI规则 1.0 → 1.1') && r4.stdout.includes('口径内容变更：测试术语表'),
    r4.stdout,
  );
} finally {
  await rm(tmp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(failed.length === 0 ? `自测通过：${results.length}/${results.length}` : `自测失败：${failed.length}/${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
