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
| `scripts/patterns.mjs` | 敏感键模式清单 + AGENTS.md 扫描词库镜像（guard 与 selftest 共用，v4.1 迁出防漂移） |
| `scripts/selftest.mjs` | 自测（npm test，十场景） |
| `scripts/quarantine.mjs` | ③ 备份/quarantine（guard 与 CLI 共用单源：证据固化 / 搬移 / 回迁 / 台账 / 限时保留，见下文） |
| `scripts/backup-inbox.mjs` | 收件箱快照备份（见文末） |
| `registry.json` | 登记表（真实路径，**不入库**，从模板复制改写） |
| `registry.example.json` | 登记表模板 |
| `docs/开发日志.md` | 版本与设计决策 |
| `tasks.jsonl` | 协作任务台账（开放/闭项留痕，防挂空） |
| `reports/`、`state.json` | 本地运行态（不入库）：`latest.json` / `p0-alerts.jsonl` / `p1-events.jsonl` / `board-pending.md` / `quarantine-ledger.jsonl` + `evidence/` + `quarantine/` |

## 用法

```bash
cp registry.example.json registry.json   # 按本机实际路径填写
node guard.mjs                           # 干净时一行；有事件逐条列出（⚠ 告警 / · 记录）
node guard.mjs --json                    # 完整 JSON 报告
node guard.mjs --full                    # 完整表格
node guard.mjs --registry <path>         # 指定别的登记表（自测用）
```

巡检结果写入 `reports/latest.json`；`state.json` 存上一轮口径指纹/版本与口径原文（仅工具内部，供下轮字段级 diff）。首次运行自动建立基线。

> ⚠️ `state.json` **含口径原文、可能带敏感键原值**——严禁入库 / 同步 / 外发（GLM5.3Flash 001-56 建议；它本来就 gitignore，此处点名内容敏感性）。

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
- **敏感模式清单**（v4.1）：13 类，与私有仓 `AGENTS.md`「提交前」密钥扫描词库一一对应（`sk-`/`ghp_`/`github_pat_`/`AKIA`/`LTAI`/`AKID`/`AIza`/PEM 私钥块/`ssh-rsa`/`xox`/`bearer`/`api-key`/`token`）——**脱敏与检测同源**：未命中模式的值会保留原文进产物，故词库增删必须同步改 `scripts/patterns.mjs` 并跑 selftest 场景 8a 对齐断言。词库文件（selfRef）跳过敏感扫描、事件 `secrets` 为空，但自指变更独立走 P0——**消费侧按 `kind` 判定，不要按 `secrets` 非空筛选/路由**。
- **回执 CLI**（对应板上「已核对·结论」，由值日实例人工执行）：

```bash
node guard.mjs --ack <事件id> --note "已核对·结论：..."     # pending → acked
node guard.mjs --resolve <事件id> --note "..."             # pending → resolved（解除）
node guard.mjs --full                                     # 表格输出含 pending 告警清单
```

> 并发提示：`--ack/--resolve` 与定时巡查并发写 `p0-alerts.jsonl` 理论上可互相覆盖（低概率，未上锁）——回执窗口避免与巡查同时执行（GLM5.3Flash 001-56 建议）。

## v4.1 修订（2026-10-17 · 001-55/001-56/001-57/001-58 首轮验证回执后的修复批次）

- **红项修复（001-55 记红 / 001-56 认可）**：敏感模式 8 类 → 13 类，补齐 AGENTS.md 词库缺失的 `LTAI`/`AKID`/`AIza`/PEM 私钥块/`ssh-rsa`（沿用词边界 + 最小长度纪律）；模式清单迁至 `scripts/patterns.mjs` 与 selftest 共用；新增**词库对齐断言**（selftest 场景 8a：集合差非空即红，防再次漂移）。
- **黄二修复（001-57 记黄 / 001-58 附议）**：每轮巡检对**所有 pending 事件** `rounds+1`，不只当轮 candidate——一次性静默改动产生的 pending 没人回执也按 001-33 第 8 条置顶。
- **selftest 补强**：场景 8——全词项夹具（LTAI/AKID/AIza/PEM/ssh-rsa）+ 板首无原值断言（Doubao 001-58 #7）；搜索面纳入 stderr（001-55 判据 1 条①）与 JSON 规范化形态（条②）；短命中值（12 字符）占位替换断言（条③）。
- **已知观察项（P2，暂不改）**：`diffText` 按行号位对位比较、无 LCS 对齐——插行/删行场景后续行会整段报「变更」（GLM5.3Flash 001-56 建议）。

## 备份 / quarantine（v4.2，留言板 001-23 候选第 3 件 / 001-33 排期③首发）

规则（001-23 原文）：**只移动不删除 + 台账 jsonl + 限时保留**——服务「发现异常后有据可查」。

- **备份（自动）**：P0 告警事件创建时，guard 把被巡检口径文件的原字节固化到 `reports/evidence/<事件id>/`（原文件副本 + `meta.json`：sha256 / 字节数 / 版本，无原文摘要），台账 `reports/quarantine-ledger.jsonl` 追加 `action:"evidence"` 条目——发现异常的当场即留证，不怕文件被二次改动。只读被巡检路径、只写本工具目录，不破坏只读纪律。
- **quarantine（人工显式）**：只有人跑命令才搬移文件，巡检永不主动搬移：

```bash
node scripts/quarantine.mjs --quarantine <路径> [--reason "..."]   # 搬入 reports/quarantine/<时间戳>-<文件名>/
node scripts/quarantine.mjs --unquarantine <台账id>                 # 原样回迁（原路径已存在则拒绝，绝不覆盖）
node scripts/quarantine.mjs --list [--registry <path>]              # 台账总览 + 保留状态
```

- **只移动不删除**：工具任何路径都不删除文件（含超期条目、含回迁后残留的空目录）——到期只在台账与巡检输出标「待人工清理」，真正的删除必须由人显式执行；搬移/回迁也绝不覆盖已存在目标。
- **限时保留**：台账每条带 `retainUntil`（默认 90 天）；超期条目在 `--list` 与巡检默认输出里提示（`⚠ … 条超期待人工清理`），`--full` 输出台账表。
- **台账字段**：`id`（`lg-YYYYMMDD-hhmmss-NNN`）/ `ts` / `action`（`evidence` | `move-in` | `move-back`）/ `path` / `target` / `bytes` / `sha256` / `reason` / `retainUntil`（move-back 另有 `ref` 指向原搬移条目）。

> ⚠️ `reports/evidence/` 与 `reports/quarantine/` **含被巡检文件原字节、可能带敏感键原值**（同 `state.json`）——严禁入库 / 同步 / 外发（reports/ 整体 gitignore）。

## v4.3 修订（2026-10-18 · 001-67/001-68/001-69 ③ 首轮验证回执：P3 加固 + t-001 反向断言）

③ 首发三家验证齐（QwenWork 001-67 一手复跑 27/27 + ZCode 001-68 独立复跑 27/27 + Doubao 001-66 认账，GLM5.3Flash 001-69 附议放行）；本批按回执「修复或收官」处理两条非阻塞项：

- **P3 加固（001-67 读码 + 探针实测 / 001-68 源码复核确认）**：`saveEvidence` 曾是无条件 `writeFile` 覆盖——全模块唯一不做「拒绝覆盖」的写入点（与搬移/回迁的 `existsSync` 纪律不对称）。同事件 id 二次固化会静默替换首份副本，且首条 evidence 台账 sha256 与磁盘脱节（台账自证失效）。改为**只写不覆盖**：`wx` 标志 + 已存在转存 `<name>.<seq>`（meta.json 同规则），台账 `target` 指向实际写入路径；selftest 场景 10a 对称断言「重复固化不改既有副本、台账 sha256 与磁盘恒等」。
- **t-001 反向断言（001-55 修法③，P1；前置口径 001-67 第三节三家附议）**：未命中任何敏感模式的值也不允许原文进告警产物——diff 值策略改为：selfRef → `(脱敏)`；命中敏感模式 → 前 2 后 1；**其余一律 `(未回显)`**（原 truncValue 保留原文是 003-42 红项根因链的最后一环，兜「词库日后新增第六类凭据而两份清单同时未覆盖」）。阈值/字段改了由键路径 + version 迁移 + 哈希变化足以定位，具体取值回仓库核对。
- **产物两类清单（001-67 口径，断言常量在 selftest 场景 10）**：**不得含原文** = `reports/p0-alerts.jsonl` / `reports/board-pending.md` / `reports/latest.json` / stdout / stderr；**原字节取证例外** = `state.json` / `reports/evidence/**` / `reports/quarantine/**` / `reports/quarantine-ledger.jsonl` 的 `path`/`target` 字段（路径非原文，但同属本机目录信息，只留 gitignore 区内）。反向断言**不**把例外目录静默移出扫描面，而是：① 断言 `reports/` 与 `state.json` 在 `.gitignore`（10c）；② 断言夹具原值不进任何「不得含原文」产物、同时仍进取证例外区（10b——取证能力不被反向断言削掉，两者不互相打架）。
- selftest 27 → **32 断言**（场景 10a/10b-0/10b-1/10b-2/10c），全绿；`report.version` → '4.3'。

## v4.4 修订（2026-10-18 · 001-71/001-72/001-73/001-74 v4.3 复跑回执：t-001 闭项批次）

四家复跑齐（ZCode 001-74 独立复跑 32/32 + GLM5.3Flash 001-72 读码主体通过 + QwenWork 001-73 一手复跑 32/32 判据核对 + Doubao 001-71 #7 侧复核）；共识「剩余项同批一次改完、闭 t-001」：

- **version 残余通道封堵（001-73 二.3 探针发现 + 一手实测 / 001-74 独立复核确认，P2）**：version 曾是 `formatDiffValue` 之外唯一仍以原文回显的文件派生值——不命中任何模式的长串 version 会原样进板首/stdout/latest.json/p0-alerts.jsonl 的 `version.to` 与 `dedupKey`（note 被脱敏、version 全裸并存于同一行摘要）。改为**回显形态约束**（不是值白名单）：形如常规版本号（`^[\w.+-]{1,24}$`）且不命中敏感模式才原样回显，其余一律 `(未回显)`；`dedupKeyOf` 的 version 段改 `sha12()` 哈希（去重语义不变、产物不含原文）；`state.json` 保留原文（取证例外区 + 下轮对比基准）。正常 `0.49.11 → 0.49.12` 照旧可读。
- **行 diff `(空)` 哨兵回归修复（001-73 三判黄应修 / 001-74.3 附议）**：v4.2 的 `truncValue` 曾让 `(空)` 原样保留，v4.3 改整体不回显后哨兵被一起吞掉——markdown 口径「清空/新增/改写」三类变更完全不可区分。改为行侧**变更类别枚举**：`(无此行)`=该侧无此行 / `(空行)`=空行 / `(非空 N字节)`=非空行只报长度（敏感行仍前 2 后 1）——四态全覆盖、零原文、`10b` 反向断言可直接断。同长度改写两侧显示同串属设计内（diff 条目存在即证明变更，取值回仓库核对）。
- **stale 注释（001-72 三.1）**：`scripts/patterns.mjs:6` 头注释改到与 v4.3 行为一致。
- **`writeNoOverwrite` 转存序号上限（001-72 三.2 P2 观察 / 001-74.5 附议同批）**：EEXIST 循环加 seq 上限 1000，超限抛错请人工清理。
- **路径口径（001-73 四 (a) / 001-74.4 附议）**：本机路径属**可回显元数据**（stdout / `latest.json` / `p0-alerts.jsonl` 可带），但**上板公开面只抄 `board-pending.md`、不抄 stdout 明细**——`renderBoard` 本就不用 `path`，selftest 场景 10e 断言「板首不含盘符/本机路径」把纪律钉死，不靠各家抄上板时手动挑的习惯兜。不改 basename（排障会丢信息）。
- selftest 32 → **42 断言**（场景 10d/10d-5/10e），全绿；`report.version` → '4.4'。
- **t-001 闭项**：diff 面（v4.3）+ version 面 + 行 diff 可读性三层闭环，`tasks.jsonl` 留痕；t-005（diffText LCS）维持 P2 观察项不绑死。

## v4.5 修订（2026-10-18 · Codex 001-80 边界点名：version 回显从「字符集+长度」收窄为「数字版本结构语义」）

001-80 读码 v4.4 后确认 version 通道方向正确，但点名 `^[\w.+-]{1,24}$` 只约束形态不约束语义——24 字符内仍可塞入任意不透明串（如 `a1b2c3d4e5f6a7b8c9d0`、`build-foo-bar-x42`）并原样进板首/latest.json：

- **`safeVersion` 增加结构语义判定**：在字符集+长度+敏感模式三重约束之外，**必须含版本核心 `\d+(\.\d+)+`**（至少一组「数字.数字」）才回显，其余一律 `(未回显)`。`0.49.12`、`1.0.0-beta.1`、`v2` 含 `2` 但不构成 `\d+\.\d+` → 判 `(未回显)`（保守侧，版本列可读性损失可接受）。
- **dedupKey 哈希掩码显示值留痕注释**：`dedupKeyOf` 的 version 段显示值 `sha12(version)[:12] + '…'` 是哈希掩码而非泄漏，Codex 001-80 旁注担心截图可直接还原原文——已在代码内注明「哈希掩码显示值是设计非疏漏」，防止后人误改为回显或误判为 bug。
- selftest 42 → **49 断言**（场景 10f：Codex 点名夹具——正常版本三处回显一致、短/长不透明串与 24/25 字符边界、换行串不回显、`state.json` 按值解析断言取证例外），全绿；`report.version` → '4.5'。

## v4.6 修订（2026-10-18 · QwenWork 001-85 P3 假承诺订正：四家 v4.5 复跑回执齐 + 回显承诺口径更正，检测行为零变更）

四家复跑回执齐（Doubao 001-83 selftest 49/49 一手复跑 + GLM5.3Flash 001-84 读码主体通过 + QwenWork 001-85 判据核对/一手探针 + ZCode 001-86 独立复跑 49/49+源码复核），v4.5 边界补丁验证闭环、t-006 归入正式验证序列（001-87 指明归入动作归 tasks.jsonl 归属方）。同批订正一条**文档假承诺**（P3 非阻塞）：

- **假承诺事实**：`copy-compliance-2026.10.15-v1` 实为 **29 字符**，超 `^[\w.+-]{1,24}$` 长度闸，实际输出 `(未回显)`——v4.5 的 guard.mjs 注释与留言板 001-82 承诺其「照旧回显」不实（QwenWork 001-85 一手探针发现；Doubao 001-87 / GLM5.3Flash 001-88 认账附议，001-88 并更正 001-84 留痕「两闸独立」表述）。
- **修法 (b)（001-85 提出、001-86/001-87/001-88 附议）**：**保留 `{1,24}` 长度闸**，不为回显单个 slug 放宽；承诺口径订正为「回显 = 字符集/长度 ∧ 数字.数字核心 ∧ 非敏感，**三闸独立、同时成立**；版本 slug 超 24 字符一律掩码、取值回仓库核对」。
- **真实实例核对（GLM 001-88 请求）**：registry 真实被巡检文件 `configs/文案合规-v1.0.json`（watched 副本位于本机 Documents 路径）的 `version` 正是该 29 字符 slug——显示面掩码、`state.json` 取证通道保留原文，#7「不得含原文」方向更保守，无泄漏、无需改配置。
- selftest 49 → **50 断言**（场景 10f-7：真实 config 串入夹具，钉死「>24 字符 slug → `(未回显)`」），全绿；`report.version` → '4.6'。
- **tasks.jsonl**：t-006 复跑回执齐归入正式验证序列；t-007（P3 假承诺订正）四家事前附议修法 (b)，本批落地即闭。

## 自测（共建时改前跑一遍、改后跑一遍）

```bash
npm test        # = node scripts/selftest.mjs，十场景：基线/无变更/静默改口径告警/正规升版本/敏感键误写脱敏/去重+升级置顶+ack/词库自指/词库对齐+短值+全词项/③备份quarantine全链路/证据不覆盖+反向断言+gitignore
```

自测只在临时目录造夹具，不碰真实 `registry.json` 与被巡检文件；退出码 0 = 全过。

## registry 登记表

- `agents`：各家 AI 的记忆/指令文件路径（`cap` 为字节上限，可空）——只报存在性/字节/行数；
- `caliber`：口径文件，三种盯法：
  - `watch: "version"`——有版本字段（JSON 的 `versionField`）：版本变更 = 口径版本事件；内容变而版本不变 = **静默改口径（告警）**；
  - `watch: "content"`——无版本字段的文档：内容变更 = 记录级事件；
  - `watch: "exists"`——只盯存在性（如持续增长的开发日志）。
  - **同一文件不要登记两条 caliber**（dedupKey 用裸路径串，两条目会共享去重键互相覆盖轮次——GLM5.3Flash 001-56 建议）。

> 豆包（Doubao）没有单文件长期记忆，`registry.json` 中如实留空（`memory: []`）——巡检输出「未登记记忆：豆包」是**如实状态而非故障**，见 `registry.example.json` note（Doubao 001-62 / GLM5.3Flash 001-64 建议的消歧）。

## 纪律（不可破）

1. **只读**：不创建/修改/删除任何被巡检路径下的文件；
2. 只在本目录写 `reports/` 与 `state.json`；
3. 巡检结论是证据，不是命令：不因巡检结果自行扩大任何 AI 的授权；
4. 改动前先跑一次确认基线，改完再跑一次对比；
5. **③ 备份/quarantine 纪律**：只移动不删除、到期只标记不自动清；`evidence/` 与 `quarantine/` 含被巡检文件原字节，同 `state.json` 严禁入库 / 同步 / 外发。

## 共建方式

本工具由本机多个 AI 实例共用。改动先在 AI 留言板（老板私有仓库）讨论认领——先认领再动手、同一模块同一时间只认领一次——认领人在本地活副本改完提交推送到本仓库，避免并发冲撞。

当前档位：**B（只读巡检）**——已验证必要性后再评估 C（记忆真身 + junction 软链）。

## 配套工具：收件箱快照备份（backup-inbox）

`scripts/backup-inbox.mjs`：把指定收件箱目录下的 `*.md` 快照到某 git 仓库的归档目录，**有变更才提交推送**（只 add 归档目录、不带入其他改动；push 被拒自动 fetch+rebase 重放，绝不强推）。用于把 AI 间的交流内容（收件箱记录）备份进 git。

```bash
node scripts/backup-inbox.mjs <收件箱目录> <git仓库目录> [归档子目录=docs/collab/ai-chat-archive]
```
