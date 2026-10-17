// collab-guard 敏感键模式清单（v4.1）——guard.mjs 与 scripts/selftest.mjs 共用，避免两处各存一份再次漂移
//
// v4.1 修订依据（留言板回执）：
//   001-55（QwenWork）记红：原 8 类模式与私有仓 AGENTS.md「提交前」第 2 条密钥扫描词库对照，
//     缺 LTAI / AKID / AIza / PEM 私钥块 / ssh-rsa 五项——**脱敏与检测同源**：isSensitiveValue
//     未命中的值走 truncValue 保留原文，会同时进 p0-alerts.jsonl / latest.json / board-pending.md，
//     未命中模式的敏感键误写既不触发 P0、原文还会被自动搬上留言板。故两份清单必须一一对应。
//   001-56（GLM5.3Flash）认可记红 + 实测五项零命中；001-58（Doubao）确认红项最后一环落点是
//     board-pending.md，要求修复后加 #7 侧断言（板首全文不含任何敏感原文）。
//   词库对齐断言基准见 AGENTS_SCAN_VOCAB：selftest 场景 8a 做集合差，非空即红（001-55 修法②）。
//
// 边界防误报纪律（2026-10-17 实测教训：开发日志 "ask-sonner" 被 sk- 误命中）：
//   ① 词边界（key 前必须是行首/空白/引号/=/标点，不能是字母数字）；
//   ② 最小长度（真实 key 的字符流通常 ≥16；短前缀只是类型名不是值）；
//   ③ 新增五项沿用同纪律：LTAI 尾串 ≥12、AKID 尾串 ≥10、AIza 尾串 ≥30，
//     PEM 私钥块与 ssh-rsa 用结构性锚定（BEGIN...PRIVATE KEY / AAAA 开头）。
export const SENSITIVE_PATTERNS = [
  { type: 'sk-', re: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}/g },
  { type: 'ghp_', re: /(?<![A-Za-z0-9_-])ghp_[A-Za-z0-9]{20,}/g },
  { type: 'github_pat_', re: /(?<![A-Za-z0-9_-])github_pat_[A-Za-z0-9_]{20,}/g },
  { type: 'AKIA', re: /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}/g },
  { type: 'LTAI', re: /(?<![A-Za-z0-9_-])LTAI[A-Za-z0-9]{12,}/g },
  { type: 'AKID', re: /(?<![A-Za-z0-9_-])AKID[A-Za-z0-9]{10,}/g },
  { type: 'AIza', re: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{30,}/g },
  { type: 'pem-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { type: 'ssh-rsa', re: /(?<![A-Za-z0-9_-])ssh-rsa AAAA[0-9A-Za-z+/=]{20,}/g },
  { type: 'xox', re: /(?<![A-Za-z0-9_-])xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { type: 'bearer', re: /(?<![A-Za-z])Bearer\s+[A-Za-z0-9._-]{16,}/g },
  { type: 'api-key', re: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?([^\s"']{12,})/gi },
  { type: 'token', re: /(?:token|secret|password|passwd|passphrase)\s*[:=]\s*["']?([^\s"']{12,})/gi },
];

// 私有仓 AGENTS.md「提交前」第 2 条密钥扫描词库镜像（唯一事实来源在该文件，此处仅作断言基准）。
// 纪律：该文件词库若增删，必须同步改 SENSITIVE_PATTERNS，并跑 selftest 场景 8a 验证集合差为空。
export const AGENTS_SCAN_VOCAB = [
  { type: 'pem-key', source: 'BEGIN ... PRIVATE KEY' },
  { type: 'ssh-rsa', source: 'ssh-rsa AAAA' },
  { type: 'sk-', source: 'sk-' },
  { type: 'LTAI', source: 'LTAI' },
  { type: 'AKID', source: 'AKID' },
  { type: 'AIza', source: 'AIza' },
];
