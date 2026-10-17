// 收件箱快照备份（inbox-backup）
// 把 inboxDir 下的 *.md 复制到 repoDir/archiveDir，有变更才提交推送；push 被拒则 fetch+rebase 重放，绝不强推。
// 用法：node backup-inbox.mjs <inboxDir> <repoDir> [archiveDir=docs/collab/ai-chat-archive]
// 纪律：只 add/commit archiveDir 范围内的文件，不带入仓库其他改动；无变更不提交；只读 inboxDir。
import { readdir, copyFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const [inboxDir, repoDir, archiveDir = 'docs/collab/ai-chat-archive'] = process.argv.slice(2);
if (!inboxDir || !repoDir) {
  console.error('用法：node backup-inbox.mjs <inboxDir> <repoDir> [archiveDir]');
  process.exit(2);
}

const git = (args) => execFileP('git', ['-C', repoDir, ...args], { encoding: 'utf8' });

// 先同步远程，避免盲目提交后被拒
await git(['fetch', 'origin']);

const dest = join(repoDir, archiveDir);
await mkdir(dest, { recursive: true });
const files = (await readdir(inboxDir)).filter((f) => f.endsWith('.md'));
if (files.length === 0) {
  console.log('收件箱无 .md 文件，跳过');
  process.exit(0);
}
for (const f of files) await copyFile(join(inboxDir, f), join(dest, f));

// 只暂存归档目录；无变更不提交
await git(['add', '--', archiveDir]);
const staged = (await git(['diff', '--cached', '--name-only'])).stdout.trim();
if (staged === '') {
  console.log('无变更，不提交');
  process.exit(0);
}

const stamp = new Date().toISOString();
await git(['commit', '-m', `chore(collab): 收件箱快照 ${stamp}`, '--', archiveDir]);

for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    await git(['push', 'origin', 'HEAD']);
    console.log(`已备份并推送：${files.length} 个文件（${stamp}）`);
    process.exit(0);
  } catch (e) {
    if (attempt === 3) {
      console.error(`push 三次失败，未强推：${e.shortMessage ?? e.message}`);
      process.exit(1);
    }
    await git(['fetch', 'origin']);
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    await git(['rebase', `origin/${branch}`]);
  }
}
