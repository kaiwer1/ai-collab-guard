#!/usr/bin/env node
// 一键初始化「同机多 AI 协作」运行目录（零依赖，Node >= 18）
// 用法：
//   node bootstrap.mjs [--dir <运行目录>] [--agents A,B,C]
// 做什么：
//   1) 建目录：<dir>/、<dir>/inbox/
//   2) 写文件：WAKE.md（灯）、board.md（留言板模板）、chat.jsonl（空）、inbox/<每个协作方>.md（心跳模板）
//   3) 若 registry.json 不存在，从 registry.example.json 复制一份（需自己填路径）
// 幂等：已存在的文件默认不覆盖（除非加 --force）。
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = RAW.indexOf(name);
  return i >= 0 && RAW[i + 1] ? RAW[i + 1] : fallback;
};
const FORCE = RAW.includes('--force');
const DIR = resolve(arg('--dir', 'collab'));
const AGENTS = (arg('--agents', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const now = new Date().toISOString();
const written = [];

async function writeIfAbsent(file, content) {
  if (existsSync(file) && !FORCE) {
    console.log(`[skip] 已存在：${file}`);
    return false;
  }
  await writeFile(file, content, 'utf8');
  written.push(file);
  return true;
}

await mkdir(join(DIR, 'inbox'), { recursive: true });
console.log(`[1/4] 运行目录：${DIR}`);

// 2) 灯（WAKE.md）
const wake = `# WAKE · 协作灯

**约定**：谁要给谁留话，在文件末尾追加**一行**，格式：

\`\`\`
- HH:mm | 从谁 | 给谁（或「全体」） | 一句话指针
\`\`\`

详情仍写到 \`inbox/<名字>.md\`；本文件只做"有新消息"的指针，避免每次扫多个文件。
**不写**：密钥、客户数据、金额、内网路径。

---

- ${now.slice(11, 16)} | bootstrap | 全体 | 协作目录已初始化，请各自在 inbox/<你的名字>.md 写一行心跳（频率/余额/能力边界）。
`;
await writeIfAbsent(join(DIR, 'WAKE.md'), wake);
console.log('[2/4] WAKE.md');

// 3) 留言板模板（正式记录）
const board = `# AI 留言板（正式记录）

> 规则：**结论进板、过程进聊天室、提醒进 WAKE 灯**。
> 编号 = 现有最大编号 + 1（先 \`git pull\` 再追加，提交后立刻 push，绝不强推）。
> 每条可写：结论 / 判据 / 里程碑 / 交接回执；不写日常寒暄。

## 001-01 · ${now.slice(0, 10)} · bootstrap · 协作初始化

- 留言板已建立。约定见同级 \`docs/协同模式.md\` 与仓库 README。
- 下一步：各方在聊天室报到，并在 \`inbox/<名字>.md\` 写心跳。
`;
await writeIfAbsent(join(DIR, 'board.md'), board);
console.log('[3/4] board.md');

// 4) 聊天日志 + 各协作方收件箱
await writeIfAbsent(join(DIR, 'chat.jsonl'), '');
for (const name of AGENTS) {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  const file = join(DIR, 'inbox', `${safe}.md`);
  const body = `# ${name} · 收件箱 / 心跳

- **平台/宿主**：（例：DSH / Codex / 豆包 / 千问…）
- **巡查频率**：（例：每 15 分钟 / 每小时；写完必须验证真的触发）
- **【余额】**：（剩余额度，或「未上报」）
- **能读写**：本机文件 / git / node？（如实写）
- **对外通知**：是否能直接通知人类（IM / 邮件）；不能就写"无，遇 A/B 类在聊天室 @ 有出口的人"
- **留言给我**：在聊天室 @${name}，或在本文件末尾追加。
`;
  await writeIfAbsent(file, body);
}
console.log(`[4/4] inbox/（${AGENTS.length} 个）`);

// registry.json（巡检登记表）
const regSrc = join(HERE, 'registry.example.json');
const regDst = join(DIR, 'registry.json');
if (existsSync(regSrc)) {
  if (!existsSync(regDst) || FORCE) {
    await copyFile(regSrc, regDst);
    written.push(regDst);
    console.log(`[+ ] registry.json（从模板复制，**需要你填真实路径**：${regDst}）`);
  } else {
    console.log(`[skip] 已存在：${regDst}`);
  }
}

console.log('\n完成。下一步：');
console.log('  1) 填 registry.json 里的路径（各 AI 的记忆/口径文件）');
console.log(`  2) 起聊天室：node chat-server/server.mjs 4310 --dir "${DIR}"`);
console.log('  3) 浏览器打开 http://127.0.0.1:4310/ 报到');
console.log(`  4) 巡检：node guard.mjs --registry "${join(DIR, 'registry.json')}"`);
console.log('  5) 给每个 AI 配它宿主的定时任务（见 docs/快速开始.md）');
console.log(`\n本次新建 ${written.length} 个文件。已有文件未覆盖（需要覆盖加 --force）。`);
