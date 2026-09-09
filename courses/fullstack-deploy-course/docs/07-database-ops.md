---
title: 生产数据库：备份要能恢复，迁移要看时机
---

# 生产数据库：备份要能恢复，迁移要看时机

做一个思想测验，现在就做：假如这一刻整座数据库消失——卷损坏、误删库、磁盘报废，原因不重要——你能答上三个问题吗？最近的备份是什么时候的？很多人的诚实答案是「三个月前」，或者「cron 一直在跑……应该挺新的吧」。那份备份恢复得出来吗？「没试过。」真去恢复时会不会报错？「不知道，恢复的时候再说。」第四个问题在另一条线上：今晚要上线的版本带着一条新迁移，它会在流程的哪一步执行？如果它要改的表恰好有个长事务占着，页面会卡多久？「上线的时候自然知道。」

这四个「不知道」没有一个是技术不会——pg_dump 谁都会敲。缺的是把备份当成一个敢拿来检验的承诺：备份是旧的、恢复时报错、迁移在上线瞬间锁死表，这三种翻车全都发生在「以为有保障」和「验证过保障」之间的缝隙里。本章把这个缝隙填掉，落三块积木：把库导出成归档文件的逻辑备份、用一次真恢复证明备份可用的恢复演练、以及在部署流程里给迁移选位置的迁移执行时机。主线新增三个脚本（备份、恢复、一键演练）与一条主门槛 `pnpm drill:backup-restore`：它会造数据、备份、亲手把库砸空、再从备份里捞回来，行数与校验和一项不等地对账。迁移时机的论证不改动任何编排文件——既有编排里 tools profile 前置执行迁移的方案（第 5 章）原地升级为有实验支撑的选择。

## 工具箱

本章调用两块旧积木。

schema 迁移——generate 生成可审查的 SQL 账本，migrate 按序执行，库里 journal 表记着「已应用到第几条」（第 4 章）。本章要回答的是这份账本在部署流程里的执行位置。

Compose 应用栈——一份编排文件声明整套拓扑与健康等待，`up -d --wait` 拉起、`down` 拆除（第 5 章）。本章借用它的 tools profile 迁移执行器与栈内 db 做时机论证；备份与恢复的客户端（pg_dump/pg_restore）跑在开发库容器里（compose.db.yaml 编排的那只，同款 postgres:16-alpine 镜像）。

## 逻辑备份：把库导出成归档

逻辑备份——用 pg_dump 把数据库导出为一个包含全部建库语句与数据的归档文件，恢复时用 pg_restore 把它灌回去；与直接拷贝数据文件的物理备份相对。先做反事实称一称分量：如果没有它，「数据没了」就是终局——卷损坏时容器文件系统跟着容器一起蒸发，能救回来的只有你额外导出过的那份文件。而导出这件事的天然缺陷是它永远在「过去」完成：此刻的备份描述的是按下回车那一刻的库，之后写入的每一条都不在里面。所以备份从来不是一个动作，而是一个策略——多久备份一次、留几份、放在哪、多久验一次，本章收尾会给一份最小可行的清单。

载体是两个参数。`pg_dump -Fc` 里的 `-F` 选输出格式，`c` 是 custom（自定义归档）。官方文档的原话：这种归档 "is designed to be portable across architectures"。归档格式也让 pg_restore 可以 "be selective about what is restored"。选择性恢复、并行恢复（`-j`）这些能力只有归档格式有，纯文本 SQL 做不到；归档格式默认还是压缩的。恢复端的两个参数是本章真正的承重点：

```text
# PostgreSQL 官方文档对 pg_restore 两个参数的原文（16 版）
-c, --clean    Before restoring database objects, issue commands to DROP
               all the objects that will be restored.
--if-exists    Use DROP ... IF EXISTS commands to drop objects in --clean mode.
               This option is not valid unless --clean is also specified.
```

翻译过来：`--clean` 在重建之前先把「即将恢复的对象」挨个 DROP 一遍；`--if-exists` 让这些 DROP 带上 IF EXISTS。两句话合起来是一个不平凡的性质——同一份备份、同一条命令，对空库和脏库（结构已在的库）都成立：空库里 DROP 找不到对象，`--if-exists` 把「不存在」降级为跳过；脏库里先清掉旧对象再重建，不用先手工清库。这不是背参数，这是下面全部演练的地基。

### 客户端的现实：经容器执行

pg_dump 与 pg_restore 是 PostgreSQL 的客户端工具，宿主机上并没有装——本课的 PostgreSQL 一直在容器里。解法现成：postgres:16-alpine 镜像自带全套客户端，`docker exec` 进 db 容器里跑。产物是二进制归档，让它流经 stdout 管道再落盘在跨平台上并不保险（重定向可能改写字节），所以脚本的走法是三步：容器内 `pg_dump -f /tmp/xx.dump` 落盘 → `docker cp` 取回宿主 → 删掉容器内的中转文件。docker cp 逐字节精确，三步在任何操作系统上行为一致。

顺带一个 Git Bash 专属的坑，手工敲命令时会撞上：`docker exec shiplog-db pg_dump -f /tmp/x.dump` 里的 `/tmp` 会被 Git Bash 改写成 Windows 的临时目录路径再传给容器（MSYS 路径转换），报错 `could not open output file "C:/Users/…/Temp/x.dump"`。惯用解法是写双斜杠 `//tmp/x.dump`。本章正文里的 node 脚本不经 MSYS，不受影响；验证一节的手工命令统一用双斜杠。

备份脚本的承重核心（完整脚本见 companion/scripts/backup.mjs）：

```js
// companion/scripts/backup.mjs · 节选：容器内 pg_dump → docker cp 取回
// 与 compose.db.yaml 一致：容器名 shiplog-db，引导用户与初始库都是 ship_log
const dump = run('docker', [
  'exec', CONTAINER, 'pg_dump', '-U', PG.user, '-d', PG.db, '-Fc', '-f', STAGING,
])
// …退出码检查（No such container → 提示先 pnpm db:up）…
const cp = run('docker', ['cp', `${CONTAINER}:${STAGING}`, file])
run('docker', ['exec', CONTAINER, 'rm', '-f', STAGING])
```

产物落在 `companion/.backups/shiplog-<时间戳>.dump`，文件名按时间排序即按新旧排序；`.backups/` 整个目录在 .gitignore 里——数据快照不入库，与 .env 同一条「仓库只留生成方式」的纪律。点出一个容易忽略的事实：pg_dump 导出的是整座库的全部非系统 schema，包括 drizzle 的迁移账本。备份里因此同时装着三样东西——表结构、数据、以及「迁移已应用到第几条」的记录。这一点马上会在演练里兑现。

### 恢复的语义：两种红

空口说「--clean --if-exists 通吃空库脏库」不算数，两种红摆出来看。都在开发库上真实执行（STAGING 是容器内中转路径，下同）。

红一：目标库是脏的（结构已在），命令少了 `--clean`——pg_restore 按归档内容直接 CREATE：

```text
# docker exec shiplog-db pg_restore -U ship_log -d ship_log //tmp/probe.dump
pg_restore: error: could not execute query: ERROR:  schema "drizzle" already exists
Command was: CREATE SCHEMA drizzle;
pg_restore: error: could not execute query: ERROR:  type "deploy_env" already exists
Command was: CREATE TYPE public.deploy_env AS ENUM ( …
pg_restore: error: could not execute query: ERROR:  relation "deploys" already exists
Command was: CREATE TABLE public.deploys ( …
pg_restore: error: COPY failed for table "deploys": ERROR:  duplicate key value
             violates unique constraint "deploys_pkey"
pg_restore: warning: errors ignored on restore: 11
# 退出码 1
```

十一处报错，全是 already exists 一族：归档说「我来建这些对象」，库说「它们已经在了」。更要紧的是最后一行——`errors ignored on restore` 说明 pg_restore 是边报错边继续的，退出码 1 之下可能已经灌进去一部分数据。**部分失败的恢复比整体失败更危险**，你不知道此刻的库里什么是新的什么是旧的。

红二：目标库是空的，命令有 `--clean` 但少了 `--if-exists`：

```text
# 目标是一座全新空库 red_probe
# docker exec shiplog-db pg_restore -U ship_log -d red_probe --clean //tmp/probe.dump
pg_restore: error: could not execute query: ERROR:  table "deploys" does not exist
Command was: DROP TABLE public.deploys;
pg_restore: error: could not execute query: ERROR:  schema "drizzle" does not exist
Command was: DROP SCHEMA drizzle;
pg_restore: warning: errors ignored on restore: 9
# 退出码 1
```

九处报错，这次全是 does not exist：`--clean` 忠实地先 DROP 一切要恢复的对象，但空库里没有东西可 DROP。两个参数各管一个方向的失败，合在一起两个方向都关闭。补全后同一条命令对两种库各跑一次：退出码都是 0，恢复后 `deploys` 3 行、迁移账本 1 条，两种目标库殊途同归。这就是 restore 脚本把 `--clean --if-exists` 写死在命令里的原因（companion/scripts/restore.mjs，`pnpm db:restore <文件>`），它让「恢复」不需要 precondition——不用先问目标库干不干净。

### 恢复成功不等于恢复对

还有一个更安静的红，不报任何错。备份之后库仍在接受写入：插入一条新记录（commit `0ld777a`，此时表里 4 行），然后恢复那份只含 3 行的旧备份：

```text
# pnpm db:restore .backups/shiplog-….dump
[restore] 恢复完成: .backups/shiplog-….dump
[restore] 3 行 / 校验和 be5b793b73d9…

# docker exec shiplog-db psql -U ship_log -d ship_log -t -c \
#   "SELECT commit FROM deploys ORDER BY id DESC LIMIT 1;"
 77aa01f        ← 新写入的 0ld777a 不见了，最后一条回到了种子
```

退出码 0，输出里没有任何异常——恢复完全成功，成功地把数据库退回了过去。`0ld777a` 这条记录没有任何报错地消失了。这就是「备份是旧的」的真面目：它不是故障，是一次静默的时光倒流，而损失的大小等于备份与事故之间的时间差。对抗它的手段只有两个：把备份频率提上去（缩小窗口），以及用对账在恢复后立刻发现「回到了过去」（本课选后者作为可自动化的那半）。

## 恢复演练：备份要用一次才算数

恢复演练——把备份真的导入目标库并对账，证明这份备份可恢复、数据完整。它要回答的问题不是「备份存在吗」，而是「恢复到一台只有 Docker 的机器上，多久能回到已知状态」。没恢复过的备份不算备份：灭火器没试过喷射，着火时你不知道它喷得出来。

对账需要一把尺子。光看行数不够——上面那场静默回滚，行数从 4 变 3 会露馅，但如果是 UPDATE 改坏了字段，行数纹丝不动。所以指纹要压到内容级：

```sql
-- 演练用的指纹 SQL（drill 脚本内同款）：
-- 行数 + 按 id 排序聚合全表内容后的 md5 + 迁移账本条数
SELECT count(*)::int AS rows,
       coalesce(md5(string_agg(
         id::text || '|' || env || '|' || status || '|' || commit || '|' || summary,
         E'\n' ORDER BY id)), 'EMPTY') AS checksum
FROM deploys;
```

`ORDER BY id` 是指纹稳定的前提：同一份数据无论物理顺序如何，聚合出来的 md5 恒定，恢复前后的指纹才可比。三项一起比——行数防丢行，校验和防内容变，账本条数防「结构对了但迁移记录没了」这种会在下次部署时炸的隐性伤。恢复演练的完整幕序就是：造已知数据 → 备份 → 记指纹 → 破坏 → 恢复 → 指纹必须逐项相等。这套东西手工做一次就会腻，腻了就不做，不做等于没有——所以它生下来就该是脚本（下一节），而 `pnpm drill:backup-restore` 的退出码就是演练结论。

备份策略的最小可行清单，正文一次说清。频率：能承受丢多少数据，就多久备份一次——本课体量一天一次绰绰有余，cron 或计划任务调 `pnpm db:backup` 即可。保留：至少三份（昨天的、上周的、上月的），只留最新一份等于把鸡蛋放回同一个时间点。位置：**绝不能只放在数据所在的那台机器或那个卷上**——磁盘报废时备份陪着数据一起走，这正是「本地演练覆盖不了」的第一项；最小做法是脚本尾部加一步上传对象存储或 rsync 到异机（频率同备份）。演练节奏：换结构的大迁移前必演一次，平时每月一次足够；演练打的是隔离环境或开发库，不打生产。清单里点名但本课环境验证不了的两件事——异地存放、生产库的真演练——搬上真服务器时要补。

## 迁移执行时机：前置与内嵌的失败窗口

迁移执行时机——部署流程中执行迁移的位置：新版本上线前单独跑（前置），或新版本启动时自动跑（内嵌）。这个位置决定迁移失败时炸的是谁、回滚是什么动作。

先替内嵌说句公道话。「应用启动时自己跑迁移」看起来是最省心的设计：不用记步骤，新环境起容器即用，本地开发的默认体验就是这么来的——`nuxt dev` 时代 nobody 手动 migrate。它的问题不在能不能跑，在失败时会发生什么。而前置方案（部署脚本先跑迁移、成功后才换版本）多一步手续，换来的恰恰是失败时的从容。把两种方案的失败窗口摆开：

```text
前置：… 旧版本在线 → [迁移] → 换版本 → 新版本在线
内嵌：… 旧版本在线 → 换版本 → [迁移+启动] → 新版本在线
```

- 迁移**失败**（SQL 报错）：前置——部署管线停在迁移这一步，退出码非 0，新版本从未上线，旧版本继续服务；「回滚」是空操作，什么都不用做。内嵌——新容器启动即失败退出，重启策略把它拉起来、再失败、再拉起，无限循环；新版本从未服务，旧版本若已下线则线上黑洞。
- 迁移**卡住**（等锁、等网络）：前置——部署卡住，可 Ctrl+C 收兵，线上毫发无损。内嵌——新版本「在启动中」无限期不监听，端口黑洞；卡多久页面就死多久。
- 迁移**慢**：前置——慢在部署时长里，用户无感。内嵌——慢直接加进启动期，健康检查的 start-period 窗口被吃掉，副本越多放大越明显。

还有一层工程事实：内嵌首先跑不起来。本课的生产镜像（Dockerfile 的 run 段）里只有 `.output`——实测 `ls /app` 只有它。被 trace 进产物的运行期依赖里有 drizzle-orm 和 postgres 驱动，但没有 drizzle-kit（它在 devDependencies）；账本 SQL 文件 `server/db/migrations` 更是无人引用——没有任何运行时代码 import 它，它就不在产物里。要做内嵌迁移，得先把迁移工具链和账本塞进生产镜像——镜像变大，攻击面变大，为的是把一个失败时会拖垮启动的动作，搬进整个系统里最不该停摆的进程。

### 三组受控实验

论断要有可观察的证据。下面三组都在本地真实执行，用的都是现成积木：应用栈的 db（`up -d --wait db`）加 tools profile 迁移执行器的镜像（`shiplog-stack-migrate`，借的是 Dockerfile build 段的工具镜像）。把迁移接进应用启动的全部含义，浓缩成一条 docker run：命令里 migrate 成功后才轮到 server 启动——`sh -c "node node_modules/drizzle-kit/bin.cjs migrate && exec node .output/server/index.mjs"`。主线文件一行未动，变体活在命令行参数里。

实验一：迁移失败，两种时机的分岔。先制造一个真实的失败状态——账本与库不一致：`DROP SCHEMA drizzle CASCADE`（journal 没了，表还在），下次 migrate 重放第 0 条会撞上 `ERROR: type "deploy_env" already exists`（psql 里直接重放这条 CREATE TYPE 可证）。前置版跑 `docker compose -f compose.yaml -p shiplog-stack --profile tools run --rm migrate`：退出码 1，管线到此为止——应用容器一个没创建，版本一个没换。一个诚实的观察：drizzle-kit 这个版本的容器输出里只有 NOTICE 与沉默的退出码，SQL 错误原文不打印；工具吞错误文本是真实世界，别指望失败原因写在脸上。内嵌版用一条 docker run 把迁移接进启动（`&&` 保证迁移成功才轮到应用，`exec` 让 server 接管 PID 1 收信号）：

```bash
# 用法示例 · companion 目录内（宿主端口借 4185，镜像即 tools profile 的迁移执行器）
docker run -d --name shiplog-embedded --restart=unless-stopped \
  --network shiplog-stack_default \
  -e NUXT_DB_URL=postgres://ship_log:ship_log@db:5432/ship_log \
  -e NUXT_PUBLIC_APP_ENV=staging -e HOST=0.0.0.0 -p 4185:3000 \
  shiplog-stack-migrate \
  sh -c "node node_modules/drizzle-kit/bin.cjs migrate && exec node .output/server/index.mjs"
```

起容器，等十二秒，然后观察三样东西：

```text
# docker inspect -f 'RestartCount={{.RestartCount}} Status={{.State.Status}}' shiplog-embedded
RestartCount=6 Status=restarting
# curl -s --max-time 3 http://127.0.0.1:4185/api/health → 无应答（000）
```

十二秒里容器死了六次。每一次重启都重新撞上同一块石头，循环不会自愈——重启策略救的是「偶发失败」，救不了「确定性失败」。同一份失败，前置的世界里是一次红色的部署记录，内嵌的世界里是一场无限循环加线上黑洞。

实验二：锁把迁移卡住，内嵌的启动黑洞。换一种破坏：锁住迁移账本表（模拟「有长事务占着迁移要碰的对象」）。先腾出待迁移的账本——清掉 journal 记录、删表删枚举但留下账本表本身，让迁移有活可干、且第一步读账本就要碰锁：

```text
# 终端零：把库整理成「账本为空、表已清」（账本表还在，可以被锁住）
docker exec shiplog-stack-db psql -U ship_log -d ship_log -q -v ON_ERROR_STOP=1 \
  -c "DELETE FROM drizzle.__drizzle_migrations;" \
  -c "DROP TABLE deploys CASCADE;" -c "DROP TYPE deploy_env;" -c "DROP TYPE deploy_status;"

# 终端一：持锁 75 秒的会话（ACCESS EXCLUSIVE 与一切访问互斥）
docker exec -d shiplog-stack-db psql -U ship_log -d ship_log \
  -c "BEGIN; LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(75);"

# 终端二：起内嵌容器（同实验一的 docker run）
```

容器状态是 `Status=running RestartCount=0`——进程活着，但端口 4185 无应答。卡在哪一步，库自己说得最清楚：

```text
# docker exec shiplog-stack-db psql -U ship_log -d ship_log -c "SELECT wait_event_type, wait_event, state, left(query,60) AS query FROM pg_stat_activity WHERE query LIKE '%drizzle%' AND pid <> pg_backend_pid();"
 wait_event_type | wait_event | state  |                            query
-----------------+------------+--------+--------------------------------------------------------------
 Timeout         | PgSleep    | active | BEGIN; LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXC
 Lock            | relation   | active | select id, hash, created_at from "drizzle"."__drizzle_migrat
(2 rows)
```

第二行就是迁移进程：它在等一把 relation 锁，锁在第一行那个睡 75 秒的事务手里。这同时演示了锁队列的传导性：被锁的不只是迁移自己，一切想访问这张表的查询都会排到它后面。75 秒后持锁事务结束，锁释放、迁移完成、应用启动——`curl` 拿回 `{"status":"ok","appEnv":"staging"}`。启动时长 = 迁移时长 + 等锁时长，内嵌方案里这段全部由用户买单。

实验三：同样的锁，前置的世界。持锁会话照旧，改跑前置迁移并限时：`timeout 20 docker compose … run --rm migrate`。20 秒后 timeout 把它杀掉，退出码 124——管线卡在迁移步，但应用容器从头到尾都没创建，更谈不上换掉。「回滚」依然是空操作。两个世界对同一故障的差价就在这里：前置把迁移失败关在部署管线里，内嵌把它放进了服务可用性里。

### 主线的选择与它的边界

实验支持的选择与既有落地一致：迁移前置，由部署管线在换版本之前显式执行。compose 里 tools profile 的 migrate 服务就是它的雏形——一个独立于应用进程、先于换版本执行的迁移步骤。两条诚实的边界：其一，前置迁移也怕锁——只是炸点在部署时长而非线上可用性，大表 DDL 的锁队列问题要靠「迁移写成短事务、避开高峰」的纪律，这是迁移设计本身的话题，本课的表小到碰不到。其二，前置方案配多副本或蓝绿时要加一条纪律：新版本上线后旧版本还可能在线一小段，迁移必须向前兼容（只加列不删列、先加后用）——不兼容的迁移照样能把旧版本打挂。单副本的本课主线先记下这条约束，多副本扩容时它优先级最高。

## 演练：从两种红到 drill 全绿

改动面先交代。新增四件：scripts/backup.mjs（`pnpm db:backup`）、scripts/restore.mjs（`pnpm db:restore <文件>`）、scripts/drill-backup-restore.mjs（`pnpm drill:backup-restore`）。package.json 里对应补三条 scripts，.gitignore 补 `.backups/` 一行。既有文件一行未动——两份编排、Dockerfile、迁移账本、应用代码原样。

红已经亮过：恢复到脏库少了 `--clean` 的十一连错，恢复到空库少了 `--if-exists` 的九连错（「恢复的语义」一节，报错原文都在）。restore.mjs 的最小实现就是把教训写成命令：

```js
// companion/scripts/restore.mjs · 节选：送入容器 → --clean --if-exists 回灌 → 非 0 即失败
const cp = run('docker', ['cp', file, `${CONTAINER}:${STAGING}`])
// …文件存在性检查（空文件直接拒）…
const restore = run('docker', [
  'exec', CONTAINER, 'pg_restore',
  '-U', PG.user, '-d', PG.db, '--clean', '--if-exists', STAGING,
])
run('docker', ['exec', CONTAINER, 'rm', '-f', STAGING])
// restore.status !== 0 → 抛错，stderr 原文透传——不做「静默部分成功」
```

主门槛把前面所有零件串成一幕消防演习。drill 脚本的幕序：起库（幂等）→ 迁移（幂等）→ 种子 3 条加演练写入 1 条 → 备份 → 记指纹。随后是破坏环节：表、枚举、迁移账本全部 drop，库回到空，再恢复，对账必须逐项相等。最后对刚恢复的脏库原样再灌一次（幂等实测），收尾把开发库重置回种子。其中「破坏后指纹查询必须失败」是一条容易漏掉的反向断言：库没真的坏，恢复就什么都没证明。真实运行：

```text
# pnpm drill:backup-restore 终态输出
[drill] 第 7 章备份-恢复演练开始（Docker 需在运行）
[drill] 幕一：开发库就绪（幂等——已在跑就不动它）
[drill] 幕二：迁移账本已执行到最新（幂等）
[drill] 幕三：种子 3 条 + 演练写入 1 条（commit "dr11bkr"）
[drill] 幕四：备份完成（5.3 KB），备份时刻指纹：4 行 / 校验和 ab26e6d112c0… / 账本 1 条
[drill] 幕五：破坏完成（表/枚举/迁移账本已 drop，指纹查询按预期失败）
[drill] 幕六：空库恢复完成，对账相等：4 行 / 校验和 ab26e6d112c0… / 账本 1 条
[drill] 幕七：脏库重复恢复完成（--clean --if-exists），对账仍相等：4 行 / 校验和 ab26e6d112c0… / 账本 1 条
[drill] 备份被证明可恢复：行数、全表校验和、迁移账本三项对账全部相等
[drill] 收尾：开发库已重置回 3 条种子；备份文件保留在 .backups/ 作演练证据
```

幕六测空库、幕七测脏库——门槛把 `--clean --if-exists` 的双向语义常态化地检验着。组装关系点名：备份与恢复脚本不另造轮子，drill 直接 import 两个函数；迁移用宿主机同一条 drizzle-kit 命令；造数据复用种子脚本的函数（第 4 章）；对账 SQL 就是「恢复演练」一节的指纹。演练打的是开发库——它的数据本来就是一次 `db:seed` 的事，砸了重灌没有代价；打生产库的演练在真实服务器上另算（见清单）。

门槛命令在本课全部既有门槛之上新增一件：`pnpm drill:backup-restore`，真实跑绿、退出码 0。旧门槛一件不回退：typecheck、test、build、e2e:ch1 到 e2e:ch4、compose:sim、sim:prod 与 db:up 体系全部照跑。

## 验证：押一个离散的答案，再动手

四个实验都在你的机器上成立。每个先把预测写成能判对错的离散值，再执行对照。

实验一：亲手做一次「备份是旧的」。开发库在跑（3 条种子），先 `pnpm db:backup`；然后往表里插一条新记录（照抄幕三的 INSERT，commit 换成你的记号）；再 `pnpm db:restore .backups/<刚生成的那份>`。先猜两个值：restore 的退出码是多少？恢复后 `GET /api/deploys`（或 psql 数行数）看到几条、你的记号在不在？对照：退出码 0，3 条，记号消失——恢复成功地把库退回了备份那一刻。解释：这不是 bug，是备份的定义；把「备份后过了多久」乘上写入频率，就是这类操作的理论损失上限，而频率与演练节奏就是为压它而设的。

实验二（定向破坏）：拆掉 restore.mjs 的两个保险。把 `companion/scripts/restore.mjs` 里 pg_restore 参数数组中的 `'--clean'` 一项删掉（保留 `'--if-exists'`），跑 `pnpm drill:backup-restore`。先猜：红在哪一幕，报错属于哪一族——SQL 的 already exists、SQL 的 does not exist，还是连库都没碰的参数错？对照：红在幕六（第一次恢复），报错是第三族：`pg_restore: error: option --if-exists requires option -c/--clean`。工具自己看穿了这对参数的依存关系，一句 SQL 都没发就退出；官方文档那句 "not valid unless --clean is also specified" 在命令行上兑现。改回来。再做第二遍：保留 `'--clean'`、删掉 `'--if-exists'`，同样先猜哪幕红、什么家族，再跑——还是幕六红，但这次是 SQL 族的 does not exist 九连错：空库上 `--clean` 的 DROP 全部打空。哪条没变也值得说：两遍实验里幕五「破坏成功」的反向断言都照常工作——它守的是「恢复真的检验过」，跟恢复本身的成败无关。复原：两项都改回，drill 重跑全绿。

实验三：亲手制造一次内嵌迁移的循环重启。前提：应用栈镜像已构建（跑过一次 `pnpm compose:sim` 即可），起栈内 db 并迁移到最新，然后复刻实验一的失败状态与内嵌容器（命令照「三组受控实验」小节原文，宿主端口用 4185）。先猜三个离散值：12 秒后 RestartCount 大于 5 还是等于 0？容器状态是 running 还是 restarting？`curl http://127.0.0.1:4185/api/health` 有应答吗？对照：大于 5、restarting、无应答。收尾必做：`docker rm -f shiplog-embedded`，然后 `docker compose -f compose.yaml -p shiplog-stack down --volumes` 还端口还容器清卷。追问一句留给纸面：如果这条 docker run 不带 `--restart`，观察值会怎么变？（容器停在 Exited，循环消失——但线上黑洞一点没少，只是从「循环失败」变成「躺平失败」。）

实验四：看清锁在哪。不起任何容器，三个终端直接对开发库演锁队列：终端一开 `docker exec -it shiplog-db psql -U ship_log -d ship_log`，执行 `BEGIN; SELECT * FROM deploys;`（拿到 ACCESS SHARE，事务保持开着）；终端二同样进 psql 执行 `ALTER TABLE deploys ADD COLUMN note text;`——先猜它立刻返回还是挂起；终端三执行 `SELECT count(*) FROM deploys;`——先猜谁挡住了它。对照：终端二挂起（ALTER 要 ACCESS EXCLUSIVE，等终端一）；终端三也挂起——它只要读锁，但排在终端二后面（锁队列的传导）。回终端一 `COMMIT;`，两个挂起的会话先后放行。这就是「上线跑迁移把表锁死」的微观机理：一个没关的事务加一条 DDL，就能把整张表的读写全部冻结，而冻结时长等于那个事务的时长。收尾：`ALTER TABLE deploys DROP COLUMN note;` 还原，`\q` 退出。

## 收束：四个「不知道」，现在有答案了

开篇的测验重答一遍。最近的备份是什么时候的——`ls companion/.backups/` 一眼可见，时间戳在文件名里；真要紧的是策略先行：频率、保留三份、异地存放、每月演练，清单在「恢复演练」一节。它能恢复出来吗——不是「应该能」，是被证明过：drill 把库砸空再捞回来，行数、校验和、迁移账本三项对账相等，退出码 0 就是证据；而两种恢复的红（少了 `--clean` 的 already exists、少了 `--if-exists` 的 does not exist）你已经见过原文，知道每种失败长什么样。恢复时报错怎么办——先看退出码与报错族群：already exists 说明目标库是脏的（缺 `--clean`），does not exist 说明 DROP 打了空枪（缺 `--if-exists`），部分失败的恢复要当心 `errors ignored` 那行。迁移会在哪一步执行、卡住会怎样——前置：失败关在部署管线里，回滚是空操作；内嵌：失败变循环重启、卡住变端口黑洞，三组实验的 RestartCount、pg_stat_activity 与 timeout 退出码都是证词。锁的机理也拆过了：一个开着没提交的事务加一条 DDL 就能冻结整张表，健康检查和重启策略对此都无能为力——能救它的只有时机和纪律。

组装式一句话：schema 迁移（账本可重放）+ Compose 应用栈（db 容器与 tools profile 执行器）+ 本章三块新积木 ⇒ 备份被证明可恢复、迁移位置有论证支撑的数据库层。三个脚本全部由既有积木组装：备份与恢复是「容器内客户端 + docker cp」，演练是「迁移 + 种子 + 备份 + 恢复 + 指纹」的串联，没有一件新轮子。

三块新积木，后续章节按接口调用：逻辑备份——`pg_dump -Fc` 归档进 `.backups/`，`--clean --if-exists` 回灌，空库脏库通吃；恢复演练——破坏后恢复再对账，指纹三项（行数、校验和、账本条数）逐项相等才算数；迁移执行时机——前置执行、失败关在管线里，向前兼容是多副本时的前置纪律。下一站：CI 会把本课的检查链（typecheck/test/build）搬进流水线（第 8 章），部署脚本则把「前置迁移 + 健康门禁 + 失败回退」固化成一条命令（第 9 章）——本章的时机论证正是那份脚本的地基。

## 自查

四道题都换了情境，答案不在正文原句里。先默答，再展开对照。

<details>
<summary>1. 同事的备份方案是 pg_dump 不带 -Fc、导出纯 SQL 文本，恢复用 psql 灌回。对比本课的归档方案，他缺了什么？什么场景下纯文本反而是对的选择？</summary>

缺的：`--clean --if-exists` 这类恢复语义——文本要靠 psql 执行，没有「先 DROP 再重建」的参数化支持，恢复到脏库得先手工清库；也没有选择性恢复与并行恢复。对的选择：想人肉审查备份内容（文本可以直接读、直接 grep）、或要在不同大版本的 PostgreSQL 之间迁移时——归档格式对版本匹配更挑，文本更宽容。回查「逻辑备份」一节对 -Fc 的论证与官方引文。
</details>

<details>
<summary>2. 恢复演练的对账为什么必须含校验和，只对行数会漏掉什么？构造一个「行数对账通过、数据其实错了」的具体场景。</summary>

漏掉内容级变化。场景示例：备份之后有人 UPDATE 了一条记录的 summary（行数不变），事故后从这份备份恢复——恢复完行数与恢复前相同，但对不上「出事前」的真实状态；更贴近正文的是静默回滚的变体：备份后某条记录被改、又没有新增删除，旧备份恢复后行数不变而内容退回旧值。md5(string_agg(... ORDER BY id)) 把每一行的每个字段压进指纹，行数与内容一起比。回查「恢复演练」一节的指纹 SQL 与「恢复成功不等于恢复对」。
</details>

<details>
<summary>3. 团队把应用扩到三个副本并同时改用内嵌迁移：每次部署，三个新副本在启动时各自跑同一条迁移。列出至少两个由此新增的故障模式，并说明前置方案为什么没有它们。</summary>

至少两个：其一，三个副本并发执行同一份账本——竞态下重复执行同一条 DDL。本课的 journal 记账没有全局互斥；实验一里 journal 缺失时重放撞 already exists，就是它的静态版。其二，任一副本迁移失败就自己进入重启循环，而其他副本可能已成功——同一次部署产出「部分活着」的不一致集群，排障面从一条命令变成三个容器。前置方案里迁移是一次性的单进程动作，在换版本之前执行完才放副本上线，天然无竞态、失败点唯一。回查「迁移执行时机」的失败窗口对照与「主线的选择与它的边界」。
</details>

<details>
<summary>4. 备份清单里「绝不能只放在被备份的那台机器上」是为什么？对照本课的演练，指出这条纪律里哪半是本地验证过的、哪半验证不了。</summary>

因为最常见的失效模式（磁盘报废、机器失窃、勒索软件加密整机）会连备份一起带走——备份与数据同生共死，等于没备。本地验证过的半边：备份可恢复、对账通过（drill 全绿，含异地无关的完整链路）；验证不了的半边：备份文件离开这台机器之后的存放与取回（对象存储上传、异机 rsync、恢复演练打到生产库），这些只有真实异地环境能证明。回查「恢复演练」一节的清单与点名说明。
</details>
