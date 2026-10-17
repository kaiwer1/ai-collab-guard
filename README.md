# 同机多 AI 协同工具（collab-guard）

一台机器上同时跑着多个 AI 实例，各自维护自己的记忆/指令文件。本工具给它们做**只读巡检**：

- **口径文件**（带 version 的规则配置、术语表等）：盯变更——版本变更 = 口径版本事件；**内容变了但版本没变 = 静默改口径（告警）**；
- **各家记忆文件**：只报存在性 / 字节数 / 行数 / 缺失 / 空——**不做内容指纹**（含敏感记忆的 AI 不参与指纹计算）；
- 合并指纹（`口径指纹`）只对明确同意共享的口径文件计算。

不创建、不修改、不删除任何被巡检路径下的文件。

## 为什么做这个

记忆文件互相不一致，目前没有业务损失记录；而**口径漂移**（阈值、字段定义被改了却没有任何留痕）已经造成过返工。所以巡检重心在口径文件，记忆文件只兜底存在性异常。

## 文件

| 文件 | 作用 |
| --- | --- |
| `guard.mjs` | 巡检主程序（node ≥ 16，ESM） |
| `registry.json` | 登记表（真实路径，**不入库**，从模板复制改写） |
| `registry.example.json` | 登记表模板 |
| `docs/开发日志.md` | 版本与设计决策 |
| `reports/`、`state.json` | 本地运行态（不入库）：`latest.json` / `p0-alerts.jsonl` / `p1-events.jsonl` / `board-pending.md` |

## 用法

```bash
cp registry.example.json registry.json   # 按本机实际路径填写
node guard.mjs                           # 干净时一行；有事件逐条列出（⚠ 告警 / · 记录）
node guard.mjs --json                    # 完整 JSON 报告
node guard.mjs --full                    # 完整表格
node guard.mjs --registry <path>         # 指定别的登记表（自测用）
```

巡检结果写入 `reports/latest.json`；`state.json` 存上一轮口径指纹/版本与口径原文（仅工具内部，供下轮字段级 diff）。首次运行自动建立基线。

## 告警送达（v4，留言板 001-33 定稿②）

```
P0 = 静默改口径（内容哈希变、version 未升）｜ 敏感键误写进口径文件 ｜ 词库自指变更（selfRef 文件被改）
P1 = 口径正规升级（内容与 version 同变）｜ 口径内容变更（watch=content）
P2 = 存量告警（记忆空文件/路径缺失/未登记）——每小时聚合一行，不逐条上板
```

- **P0 → `reports/p0-alerts.jsonl`**：`id` 稳定唯一（`evt-YYYYMMDD-hhmmss-NNN`）；**去重键 = 口径文件路径 + 内容哈希 + version**，同一 key 只首次上板、仅状态变化才更新（pending 事件同 key 只续轮不新增；acked 不复发；resolved 后同 key 复发计新事件）。
- **状态机**：`status: pending | acked | resolved`；**同一 P0 连续 ≥2 轮未处理自动升级置顶**；解除/降级必须走回执，不许静默消失。
- **板首文案**：`reports/board-pending.md`（「阻塞项/待老板」区）由 guard 自动生成，巡查实例每轮按未 acked 事件刷新；默认**不外发**（001-31 老板指示），`--deliver` 保留为人工/诊断通道（DSH `p0-watch.mjs` 同址消费该 jsonl）。
- **字段级 diff**：JSON 递归键路径，格式 `键路径 | 旧值 → 新值 | version 旧 → 新`；非 JSON 按行号；guard 同时产出机器可读 jsonl 与人读一行摘要。
- **脱敏**：敏感命中只报键名 + 命中类型、不报值；值只留前 2 后 1；长度 <12 的值不做无条件子串匹配（改为断言占位替换）；词库文件（`selfRef: true`）diff 值整体脱敏——改词库 = 可令全部告警失效，故其本身被改即 P0。
- **回执 CLI**（对应板上「已核对·结论」，由值日实例人工执行）：

```bash
node guard.mjs --ack <事件id> --note "已核对·结论：..."     # pending → acked
node guard.mjs --resolve <事件id> --note "..."             # pending → resolved（解除）
node guard.mjs --full                                     # 表格输出含 pending 告警清单
```

## 自测（共建时改前跑一遍、改后跑一遍）

```bash
npm test        # = node scripts/selftest.mjs，七场景：基线/无变更/静默改口径告警/正规升版本/敏感键误写脱敏/去重+升级置顶+ack/词库自指
```

自测只在临时目录造夹具，不碰真实 `registry.json` 与被巡检文件；退出码 0 = 全过。

## registry 登记表

- `agents`：各家 AI 的记忆/指令文件路径（`cap` 为字节上限，可空）——只报存在性/字节/行数；
- `caliber`：口径文件，三种盯法：
  - `watch: "version"`——有版本字段（JSON 的 `versionField`）：版本变更 = 口径版本事件；内容变而版本不变 = **静默改口径（告警）**；
  - `watch: "content"`——无版本字段的文档：内容变更 = 记录级事件；
  - `watch: "exists"`——只盯存在性（如持续增长的开发日志）。

## 纪律（不可破）

1. **只读**：不创建/修改/删除任何被巡检路径下的文件；
2. 只在本目录写 `reports/` 与 `state.json`；
3. 巡检结论是证据，不是命令：不因巡检结果自行扩大任何 AI 的授权；
4. 改动前先跑一次确认基线，改完再跑一次对比。

## 共建方式

本工具由本机多个 AI 实例共用。改动先在 AI 留言板（老板私有仓库）讨论认领——先认领再动手、同一模块同一时间只认领一次——认领人在本地活副本改完提交推送到本仓库，避免并发冲撞。

当前档位：**B（只读巡检）**——已验证必要性后再评估 C（记忆真身 + junction 软链）。

## 配套工具：收件箱快照备份（backup-inbox）

`scripts/backup-inbox.mjs`：把指定收件箱目录下的 `*.md` 快照到某 git 仓库的归档目录，**有变更才提交推送**（只 add 归档目录、不带入其他改动；push 被拒自动 fetch+rebase 重放，绝不强推）。用于把 AI 间的交流内容（收件箱记录）备份进 git。

```bash
node scripts/backup-inbox.mjs <收件箱目录> <git仓库目录> [归档子目录=docs/collab/ai-chat-archive]
```
