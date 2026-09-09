---
title: 数据库层：schema、迁移与类型安全的落库
---

# 数据库层：schema、迁移与类型安全的落库

生产环境的 /api/deploys 一夜之间全是 500，dev 这边却怎么都复现不出来——同一个 commit，同样的配置，一边炸一边好。最后定位问题的人没去读代码，而是把两边的表结构各导出一份做 diff：生产库的 deploys 表多出一列，上个月有人登上服务器用 psql 手工加的，救完急就没人记得。手动改表，改掉的不只是一列：表结构从此脱离代码的版本历史，dev 库与生产库的 schema 不一致，同一个 bug 于是只在一边复现；而那列没人认领的结构，正安安静静躺在下一次部署的必经之路上。

病根是一件缺席的东西：表结构没有单一事实源。接口的形状早就享受过这份纪律——一份共享类型、两侧编译期对账；本章把同样的纪律搬进数据库。四块新积木：声明表结构的 Drizzle schema、把声明变成可审查可重放 SQL 的 schema 迁移、管连接预算的连接池、断言真实落库的集成测试数据库。两件主线变化随之合流：/api/deploys 的数据源从内存数组换成 PostgreSQL，域规则与 HTTP 行为一行不动；runtimeConfig 里登记的 dbUrl 迎来第一个真实消费者——连接串由环境变量流进连接池，代码里没有一处写死的地址。收尾的门槛里，你会亲手删一次表、再靠迁移账本的重放把它长回来，也会亲手复刻一次开篇的「手改表」然后看两个工具都对此沉默。

## 工具箱

本章调用三块旧积木。

server API——server/api/ 下文件路径即路由的 TS 后端，export default defineEventHandler 导出处理器（第 2 章）。本章它的两个 handler 只各改一行装配：数据从进程内的仓库换进数据库仓库。

runtimeConfig——nuxt.config.ts 登记键名与默认值，NUXT_ 前缀环境变量运行时覆盖，代码用 useRuntimeConfig() 读取（第 3 章）。本章起代码第一次真正用上 dbUrl 这个键。

请求校验——readValidatedBody 配 zod 在系统边界拦截非法输入，失败自动 400（第 2 章）。它守的门不因换库而变：脏请求进不了 SQL，和当初进不了内存数组是同一道门。

## 先起一座真库

换库之前先回答一个问题：为什么开发与测试需要一座真的 PostgreSQL，而不是继续用内存数组「模拟」？因为本章要证明的事，内存里装不下：枚举在数据库层的兜底、id 由数据库分配、写入的数据活过进程死亡——这些行为的主语都是数据库本身，模拟不出「真的做到了」。测试要断言的是 SQL 的行为，就得有一座真的发 SQL 的库。

本地的这座库由 Compose 编排——一条声明式文件描述容器怎么跑，一条命令拉起。文件如下（注释略有精简；数据卷与容器健康检查的完整讨论在容器化一章展开，这里先照抄用起来）：

```yaml
# companion/compose.db.yaml · 开发数据库编排（只含 db 一个服务；完整应用栈在容器化一章）
# 端口约定：宿主 54329 → 容器 5432（避开本机可能已有的 5432，容器名带 shiplog 前缀防撞名）
# 镜像 tag 固定 postgres:16-alpine：版本锁死，复现时不猜「latest 里装的是什么」。
# name: shiplog 是 compose 项目名——容器、网络、卷的实际名都以它为前缀（如卷 shiplog_db-data）。
name: shiplog

services:
  db:
    image: postgres:16-alpine
    container_name: shiplog-db
    environment:
      # 引导超级用户与初始库：POSTGRES_USER 是超级用户，因此开发机上它能自建测试库（shiplog_test）
      POSTGRES_USER: ship_log
      POSTGRES_PASSWORD: ship_log
      POSTGRES_DB: ship_log
    ports:
      - "54329:5432"
    volumes:
      # 数据放卷里：容器删了重建，数据仍在
      - db-data:/var/lib/postgresql/data
    healthcheck:
      # pg_isready 探活：--wait 等的就是这个探针转绿
      test: ["CMD-SHELL", "pg_isready -U ship_log -d ship_log"]
      interval: 2s
      timeout: 3s
      retries: 15

volumes:
  db-data:
```

三个配置各有一句要说。镜像 tag 固定 postgres:16-alpine：复现环境时不猜「latest 里今天装的是什么」。宿主端口用 54329 映射容器的 5432：5432 太热门，本机但凡已有一座 PostgreSQL 就会撞端口。54329 避开它——应用测试统一用 417x 段端口，数据库统一 54329，全书沿用。三个环境变量引导出超级用户与初始库 ship_log。数据放进 db-data 卷：容器删了重建，数据仍在——pnpm db:down 再 pnpm db:up 之后，种子与写入的行一条不少。健康检查让编排器用 pg_isready 周期性探活，起库命令的 --wait 等的就是它转绿。

起停的包装是 scripts/compose-db.mjs（pnpm db:up / pnpm db:down 的落点）。up 做三件事：调 docker compose 拉起并等健康、再发一条真实连接探针、打印下一步提示。探针这段值得看一眼：

```js
// companion/scripts/compose-db.mjs · 片段：readiness probe——轮询发 select 1，直到成功或超时（不 sleep 硬等）
async function waitUntilAcceptingConnections(timeoutMs) {
  const sql = postgres(PROBE_URL, { max: 1, connect_timeout: 2 })
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      try {
        await sql`select 1`
        return true
      } catch {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    return false
  } finally {
    await sql.end({ timeout: 1 })
  }
}
```

容器健康与应用能建连接是两回事：pg_isready 说的是「数据库进程就绪」，应用要的是「我能登录、能发 SQL」。多一道 select 1，就是用应用视角再确认一次。down 默认保留数据卷（开发数据跨重启保留）；要连数据一起清零，用 pnpm db:down --volumes。

```text
# pnpm db:up 输出（节选；首次运行会先拉镜像、建容器）
 Container shiplog-db Healthy
[db] 开发库就绪: postgres://ship_log:ship_log@127.0.0.1:54329/ship_log
[db] 下一步: pnpm db:migrate 建表, pnpm db:seed 种子数据

# pnpm db:down 输出（节选）
[db] 容器已停并移除，数据卷保留（数据不丢）。恢复: pnpm db:up
```

连接串里的 ship_log:ship_log 是开发库的引导凭据，本课教学用；它同时躺在 .env.example 模板里，密钥管理的纪律照旧——值经环境注入，仓库里只有模板。

## Drizzle schema：表结构的单一事实源

Drizzle schema——用 TypeScript 声明数据库表结构的单一事实源，类型由此流向应用代码。声明落在 server/db/schema.ts，drizzle-orm 读它获得类型安全的查询，迁移工具拿它当 diff 的基准。

先做反事实：如果没有这份声明会怎样？表结构就只剩两个藏身处——实际数据库，和某个人脑子里的记忆。代码里的行类型靠手写「对齐」，漂移只在运行时暴露；两座库各自手改过后，连「哪边是对的」都无从谈起——开篇的双库事故正是这个状态。schema.ts 立起来之后，「表长什么样」有且只有一份答案，库是从它推导出的产物。这与共享类型的思路同构：接口的形状一份定义两侧对账，表的结构一份声明、代码与数据库两侧对账。

```ts
// companion/server/db/schema.ts · 表结构的单一事实源：TS 声明表，类型由此流向应用代码
// 刻意不 import 工程内其他模块（包括 #shared）：drizzle-kit 要独立编译本文件，
// 表结构定义保持自包含；它产出的行类型与 shared/types.ts 的 DeployRecord 结构对齐
import { integer, pgEnum, pgTable, text } from 'drizzle-orm/pg-core'

// 枚举在数据库层建类型（CREATE TYPE）：非法值连写进表的机会都没有——API 边界的 zod 之外再一道防线
export const deployEnv = pgEnum('deploy_env', ['production', 'staging'])
export const deployStatus = pgEnum('deploy_status', ['success', 'failed'])

export const deploys = pgTable('deploys', {
  // identity 列：id 由 PostgreSQL 分配（GENERATED ALWAYS AS IDENTITY），INSERT 不带 id
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  env: deployEnv('env').notNull(),
  status: deployStatus('status').notNull(),
  commit: text('commit').notNull(),
  summary: text('summary').notNull(),
})
```

三个设计各有一句理由。pgEnum 把枚举建进数据库层（DDL 里是 CREATE TYPE）：请求校验的 zod 挡在 API 边界，枚举类型挡在表边界。运维脚本、未来别的服务这类绕过 API 直接写库的路径，同样有它兜底——两道防线组装，而不是互相替代。id 用 identity 列且 GENERATED ALWAYS：id 由数据库分配，INSERT 不带 id，带 id 的写法直接拒收——「id 轮不到客户端说了算」从接口约定升级成了物理事实。行类型不手写：`deploys.$inferSelect` 由 drizzle 从声明自动推出，表长什么样类型就长什么样。它此刻与 shared/types.ts 的 DeployRecord 字段一致，往返的对齐由本章的集成测试守住。

现在拆一个流传最广的误会：「改了 schema 代码就等于改了数据库」。反着做一次就明白了：往 schema.ts 的 deploys 里加一列，保存，去库里 \d deploys——纹丝不动。重启应用、重新生产构建，还是不动。schema.ts 是声明，不是执行；声明与现实之间隔着一条通道，声明改完只是改了「应该是什么」，库里「实际是什么」要等通道把差异送过去。这条通道就是下一节的迁移。没走通道的手改（无论改代码还是改库），就是开篇事故的起点。

## schema 迁移：把变更变成账本

schema 迁移——把 schema 的变更生成为有序、可审查、可重放的 SQL 迁移文件，让数据库结构与代码版本对齐，而不是手改线上表。两个命令各管一半：drizzle-kit generate 对比「schema 声明」与「上一次迁移」，产出编号的 SQL 文件；drizzle-kit migrate 把账本里还没执行的条目按序执行。

配置 14 行，两件事各归其位：

```ts
// companion/drizzle.config.ts · drizzle-kit 的配置：generate 看哪儿 diff、migrate 连哪个库
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  // 单一事实源：表结构声明。generate 对比「这份声明」与「上一次迁移」产出 diff
  schema: './server/db/schema.ts',
  // 迁移账本：生成的 SQL 文件落在这里，按序号排队，入库共享
  out: './server/db/migrations',
  // 连接串走环境（.env 的 NUXT_DB_URL，经 npm script 的 --env-file 装载）——不在代码里写死
  dbCredentials: {
    url: process.env.NUXT_DB_URL ?? '',
  },
})
```

本章的账本里已经躺着第一条迁移，随仓库提供，是 generate 的产物。

```sql
-- companion/server/db/migrations/0000_deploys-table.sql · 账本第 0 条：建枚举类型与表（全文）
CREATE TYPE "public"."deploy_env" AS ENUM('production', 'staging');--> statement-breakpoint
CREATE TYPE "public"."deploy_status" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TABLE "deploys" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deploys_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"env" "deploy_env" NOT NULL,
	"status" "deploy_status" NOT NULL,
	"commit" text NOT NULL,
	"summary" text NOT NULL
);
```

它是一段普通 SQL，逐行可审查——将来某条迁移要在生产执行，值班的人读的就是这样的文件，而不是赌一段自动生成的黑盒魔法。migrate 把它送进数据库后，执行记录落在库里的一张小表上：

```text
# docker exec shiplog-db psql -U ship_log -d ship_log -c 'SELECT id, created_at FROM drizzle.__drizzle_migrations;'
 id |  created_at
----+---------------
  1 | 1788770800631
(1 row)
```

这就是「账本已记到第几条」的实体。下次 migrate 只执行 journal 里没有的条目，已应用的原样跳过——迁移因此可以无限次重跑，同一座库跑两遍结果不变。一座全新的库则从第 0 条一路重放到最新，长出与声明一致的结构。

### 反事实：不迁移会发生什么

迁移的价值用「没有它」来称最重。两段都是真实运行。

第一段：库在、连接串对，但没跑迁移（一座空库）。生产构建后把 NUXT_DB_URL 指过去启动，进程正常监听。失败推迟到第一个碰表的请求：客户端只看到一句脱敏的 Server Error；细节留在进程日志里——驱动报 PostgresError，SQLSTATE 42P01，表不存在（响应体与日志原文见「演练：从红到全绿」）。跑一遍 pnpm db:migrate，同样的请求转成 200。这是每一座新库的必经红：结构不会自己长出来，账本送它出来。

第二段更贴开篇：手动改表。在一座已迁移的库上，绕过账本手工加一列（下面是取证时在一次性库 red_probe 上的真实命令与输出；验证一节的实验三会让你在自己的开发库上重演）：

```text
# docker exec shiplog-db psql -U ship_log -d red_probe -c 'ALTER TABLE deploys ADD COLUMN note text;'
ALTER TABLE

# 此后 pnpm db:migrate 的完整输出
Reading config file …/drizzle.config.ts
Using 'postgres' driver for database querying
[✓] migrations applied successfully!
```

```text
# 此后 pnpm db:generate 的完整输出
deploys 5 columns 0 indexes 0 fks

No schema changes, nothing to migrate 😴
```

成功、无变化、无警告——尽管此刻 \d deploys 里躺着一列 schema.ts 根本不认识的 note。两个工具的沉默各有原因：migrate 只对账本负责，journal 里记着第 0 条已应用、没有新条目，无事可做；generate 对比的是 schema.ts 与迁移文件夹，两边一致，也谈不上变化。没有一台机器在对比「声明」与「现实的库」——手改发生在通道之外，差异没有任何哨兵。这就是开篇事故的完整机理：手动改表不会当场炸，它埋进两座库的差异里，等下一次部署、下一个消费者撞上来。恢复一致只有两条正路：手工把改动的逆向补回去，或者把库交给账本从头重放。由此定下纪律：凡是迁移管着的表，不手改；急修也走迁移。

顺带把分工钉死：结构归迁移管（可无限重放），数据归种子脚本管。scripts/seed.mjs 把开发库重置回 3 条演示记录——TRUNCATE 清空并归零 identity 计数，再按序插入；依赖精确计数的 e2e 门槛（如 e2e:ch2）靠它从同一状态出发。迁移不造数据，种子不建结构，谁也不越界。

## 连接池：连接是预算，不是自来水

连接池——复用一组数据库连接的机制：避免每请求建连的握手开销，并给并发设上限，防止把数据库压垮。落点只有一个函数：

```ts
// companion/server/db/client.ts · 数据库出口：连接串 → postgres 连接池 → 绑定 schema 的 drizzle 实例
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// drizzle 实例的类型：绑定 schema 后查询带类型；测试用它造第二个实例证明「数据不在进程里」
// （ReturnType 反推，createDb 本身不标注返回类型——标了就成了自引用）
export type Db = ReturnType<typeof createDb>

// 连接池 max 设小值（5）：postgres 默认 max_connections=100，是整个实例的连接预算——
// 应用副本、集成测试、psql 运维连接都在里面分。教学单体应用并发达不到 5 条在途 SQL，
// 池开大只会白占预算；每个应用实例最多占 5 条，多个副本扩起来也不会把库压垮
export function createDb(dbUrl: string) {
  const pool = postgres(dbUrl, { max: 5 })
  return drizzle(pool, { schema })
}
```

为什么非要池？先替「每请求一条新连接」说句公道话：代码上它最省事，连接用完即弃，永远新鲜。它不成立的地方在成本：每条连接在 PostgreSQL 那头是一个服务进程，建连要走 TCP 握手、认证、进程初始化——全是请求还没开始干活的纯开销；并发一上来，数据库先忙着接客再忙着干活。池把这笔固定成本摊销掉：开机时备好一小撮长连接，请求借了还、还了借。

max 为什么是 5 这么小？因为 postgres 默认的 max_connections=100 不是给单个应用的配额，是整台实例的预算——应用副本、集成测试、值班人员的 psql，全在这 100 条里分。折算一下体感：100 ÷ 5 = 20，一个应用实例占 5 条时，20 个副本才吃满预算；若 max 开到 50，两个副本就把 psql 都挤在了门外。教学单体远达不到 5 条在途 SQL，池开大只是白占预算——**连接是整台实例共享的预算，不是每个进程的自来水**。

池还必须是进程级单例——这段属于下一小节的装配，但先记结论：每请求新建一个池，等于每请求重新握一遍手，池的意义原地蒸发。

### dbUrl 的第一个消费者

```ts
// companion/server/utils/db.ts · 节选：请求一侧的数据库出口，runtimeConfig.dbUrl 的第一个真实消费者
import { createDb, type Db } from '../db/client'
import { pgDeploysRepo } from '../db/deploys'
import type { DeploysRepo } from '../domain/deploys'

// 进程级单例：连接池在进程生命周期里共享——每请求新建池等于每请求重新握手，池就没意义了
let dbSingleton: Db | undefined

export function useDb(): Db {
  const config = useRuntimeConfig()
  dbSingleton ??= createDb(config.dbUrl)
  return dbSingleton
}

// handler 用这一个函数拿仓库：域逻辑只认 DeploysRepo 接口，这里决定给它 PostgreSQL 实现
export function useDeploysRepo(): DeploysRepo {
  return pgDeploysRepo(useDb())
}
```

dbUrl 在 nuxt.config.ts 的 runtimeConfig 里登记以来，一直只是被校验格式的字符串；本章它第一次被真正消费：useRuntimeConfig() 在 Nitro 的服务端环境里读出值，流进 createDb 的连接池。构建期与运行期配置的分界由此拿到了实证——同一份生产产物，NUXT_DB_URL 指向开发库就连开发库，指向测试库就连测试库，零重建零改码；环境变量注入是通道，连接串是密钥，.env 与密钥管理的纪律原样适用。生产构建出来的部署单元没有变，变的是它背后第一次有了活数据。

一个诚实的边界要说清：启动时的 fail-fast 配置校验守住的是格式（postgres:// 开头、非空），不是可达性。库没起、网络不通，进程照样监听端口，直到第一个碰表的请求才 500——本章反事实第一段你已经见过这个形态。可达性该由谁守，是健康分级的话题（第 10 章）。

## 集成测试数据库：一次性库与新的隔离缝

集成测试数据库——与开发库隔离的一次性数据库：测试前确保迁移就绪，测试间清理数据，断言到真实 SQL 行为。

为什么单测不够？内存仓库守得住域规则（新记录在前、id 递增），但「PostgreSQL 实现真的做到」这件事它证明不了：枚举兜底、identity 分配、数据活在库里而非进程里——主语全是数据库。答案不是把单测改造成连库（那会拖慢快车道），而是加一层：单测守规则，集成测试连真库守实现。vitest 把两个项目分进一份配置：

```ts
// companion/vitest.config.ts · 节选：测试分两个项目，unit 不碰数据库，integration 由 globalSetup 拉起一次性库
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
        },
      },
    ],
  },
})
```

库管家是 global-setup（节选；完整 80 行见 companion/tests/integration/global-setup.ts）。它在一座实例上扮演三种身份：开发库只读它的地址（绝不碰它的数据）、维护库 postgres 用来建删库、一次性库 shiplog_test 承载全部测试：

```ts
// companion/tests/integration/global-setup.ts · 节选：造一次性库 → 按账本迁移 → 测试后销毁
export default async function setup() {
  const { adminUrl, testUrl } = resolveUrls()

  // 实例可达性先行：连不上就说人话，而不是让每个测试各自炸一遍连接错误
  const probe = postgres(adminUrl, { max: 1, connect_timeout: 3 })
  try {
    await probe`select 1`
  } catch (err) {
    await probe.end({ timeout: 1 }).catch(() => {})
    throw new Error(
      `[global-setup] PostgreSQL 实例不可达（${adminUrl.replace(/\/\/[^@]*@/, '//***@')}）：${err.message}\n先 pnpm db:up 起开发库实例，再 pnpm db:migrate 生成表。`,
    )
  }
  await probe.end({ timeout: 1 })

  // 一次性库：删旧（FORCE 踢掉可能残留的连接；先探存在，免得 NOTICE 刷屏）→ 建新 → 按账本迁移到最新
  const admin = postgres(adminUrl, { max: 1 })
  const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`
  if (existing.length > 0) {
    await admin.unsafe(`DROP DATABASE ${TEST_DB} WITH (FORCE)`)
  }
  await admin.unsafe(`CREATE DATABASE ${TEST_DB}`)
  await admin.end({ timeout: 1 })

  const sql = postgres(testUrl, { max: 1 })
  await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER })
  await sql.end({ timeout: 1 })

  // 一次性库地址放进环境：vitest 的测试 worker 在 globalSetup 之后 fork，能继承到这份进程环境
  process.env.SHIPLOG_TEST_DB_URL = testUrl
```

三个设计点。其一，测试库的结构复用走同一条迁移路径——global-setup 里跑的 migrate 与你在开发库跑的是同一份账本。测试证明了账本可重放，顺带证明了测试环境与开发环境结构一致。其二，先删后建保证每次运行拿到的是全新库，上一轮的残留数据不可能泄漏进断言。其三，测试间清理用 TRUNCATE TABLE deploys RESTART IDENTITY：清空数据并把 identity 计数归零，任何顺序跑结果都一样。teardown 里无论全绿全红都把一次性库 DROP 掉——不留尸体，也永远不动开发数据。

### 隔离缝换岗，域逻辑不动

数据源换成数据库，域逻辑这一层一行都不该动——当初把它隔离出来，买的就是这一刻。它的全部改动是数据源从「模块级状态」变成显式入参：

```ts
// companion/server/domain/deploys.ts · 部署日志域逻辑：纯函数 + 注入式数据源
// 刻意不 import 任何 HTTP 概念（h3 的事件、请求、响应都不进这一层）——因此无需起服务器即可单测
// 数据源同样不进这一层：域逻辑只认下面的 DeploysRepo 接口——生产连 PostgreSQL（server/db/deploys.ts），
// 单测用内存实现。换数据源时这一层不动，这正是它存在的意义
import type { CreateDeployInput, DeployRecord } from '#shared/types'

// 部署日志仓库：域逻辑对数据源的全部要求。
// id 分配与「新记录在前」的排序规则由各实现自己承担——数据库里是 identity 列 + ORDER BY id DESC
export interface DeploysRepo {
  list(): Promise<DeployRecord[]>
  create(input: CreateDeployInput): Promise<DeployRecord>
}

// 对外接口保持原名：调用方从 listDeploys() / createDeploy(input) 变为
// listDeploys(repo) / createDeploy(repo, input)——数据源从此是显式入参，不再是隐藏的模块级状态
export async function listDeploys(repo: DeploysRepo): Promise<DeployRecord[]> {
  return repo.list()
}

export async function createDeploy(repo: DeploysRepo, input: CreateDeployInput): Promise<DeployRecord> {
  return repo.create(input)
}

// 内存实现：单测的快车道（毫秒级、无需数据库），规则与 PostgreSQL 实现一致。
// 测试隔离缝从 resetDeploys() 换成了它：每个测试 new 一个全新仓库，状态永远不串
export class InMemoryDeploysRepo implements DeploysRepo {
  #records: DeployRecord[]

  constructor(initial: readonly DeployRecord[] = []) {
    this.#records = [...initial]
  }

  async list(): Promise<DeployRecord[]> {
    // 新记录在前（按 id 倒序）；返回副本，改动结果不影响下一次读取
    return [...this.#records].sort((a, b) => b.id - a.id)
  }

  async create(input: CreateDeployInput): Promise<DeployRecord> {
    const nextId = this.#records.reduce((max, r) => Math.max(max, r.id), 0) + 1
    const record: DeployRecord = { id: nextId, ...input }
    this.#records = [...this.#records, record]
    return record
  }
}
```

DeploysRepo 是域逻辑对数据源的全部要求——两个函数，六个字段。resetDeploys() 测试缝正式退役，接岗的是两个新缝。单测每个测试 new 一个 InMemoryDeploysRepo（状态永不互串）；集成测试每轮 TRUNCATE 一次性库。断言的意图一条未变：种子可读、id 服务端分配、新记录在前、读取返回副本——换的只是缝，不是考题。

SQL 这一侧的实现：

```ts
// companion/server/db/deploys.ts · DeploysRepo 的 PostgreSQL 实现：域逻辑声明的接口在这里落成 SQL
import { desc } from 'drizzle-orm'
import type { CreateDeployInput, DeployRecord } from '#shared/types'
import type { DeploysRepo } from '../domain/deploys'
import type { Db } from './client'
import { deploys } from './schema'

// 用法示例（handler 一侧，见 server/utils/db.ts）：
//   const repo = pgDeploysRepo(useDb())
//   await listDeploys(repo)
export function pgDeploysRepo(db: Db): DeploysRepo {
  return {
    async list(): Promise<DeployRecord[]> {
      // select 显式挑列：表结构与 API 记录解耦——将来加列（如 created_at）不会顺带泄漏进接口
      const rows = await db
        .select({
          id: deploys.id,
          env: deploys.env,
          status: deploys.status,
          commit: deploys.commit,
          summary: deploys.summary,
        })
        .from(deploys)
        .orderBy(desc(deploys.id)) // 域规则「新记录在前」：按 id 倒序
      return rows
    },

    async create(input: CreateDeployInput): Promise<DeployRecord> {
      // 不带 id 插入：id 由数据库的 identity 列分配（GENERATED ALWAYS），RETURNING 拿回整行
      const [row] = await db
        .insert(deploys)
        .values(input)
        .returning({
          id: deploys.id,
          env: deploys.env,
          status: deploys.status,
          commit: deploys.commit,
          summary: deploys.summary,
        })
      if (!row) throw new Error('INSERT deploys 未返回行——PostgreSQL 实现的 RETURNING 契约被破坏')
      return row
    },
  }
}
```

select 显式挑列是有意的：将来表加列（比如 created_at），接口形状不会顺带膨胀——表结构与 API 记录解耦，靠的就是不写 select *。「新记录在前」的域规则落到 ORDER BY id DESC；id 分配落到 identity 列加 RETURNING。规则没变，搬了家。

集成测试断言四件事，其中两条是本章的判据，全文见 companion/tests/integration/deploys-db.test.ts。

```ts
// companion/tests/integration/deploys-db.test.ts · 节选：本章的两条判据（完整 4 条见原文件）
  it('数据活在数据库里，不活在进程里：换一个全新实例（新连接池）仍读得到', async () => {
    // 这是「换掉内存数组」的判据：内存数据源里，新实例读到的永远是空的种子副本
    await createDeploy(repo, { env: 'staging', status: 'success', commit: 'c3c3c3c', summary: '给下一个实例的遗言' })

    const secondDb = createDb(dbUrl)
    try {
      const seen = await listDeploys(pgDeploysRepo(secondDb))
      expect(seen.map((d) => d.commit)).toEqual(['c3c3c3c'])
    } finally {
      await secondDb.$client.end()
    }
  })

  it('枚举约束在数据库层兜底：绕过 API 直接写非法 env 被数据库拒绝', async () => {
    const invalid = {
      env: 'dev',
      status: 'success',
      commit: 'ddddddd',
      summary: '绕过边界的非法枚举',
    } as typeof deploys.$inferInsert
    // 22P02 = invalid_text_representation：非法枚举字面量。drizzle 会把驱动错误包进 cause
    await expect(db.insert(deploys).values(invalid)).rejects.toMatchObject({
      cause: { code: '22P02' },
    })
  })
```

第一条用第二个连接池读第一个池写入的行。内存数据源里这个测试不可能通过：新实例读到的永远是空的种子副本。它转绿了，「数据不在进程里」才是证明了的事实，而非口号。第二条绕过 API 与 zod 直接写库，env 填 dev，数据库用 SQLSTATE 22P02 把它拒了——pgEnum 那道防线的实测。另两条（落库往返、连续创建 id 递增）与单测考同一套规则，考点换成真 SQL。

## 演练：从红到全绿

本章是一次数据源手术，先交代手术面再动刀：

- 一行未改：请求校验的 schema 与 400 行为、配置门卫与 fail-fast 清单、首页模板。
- 动签名一处：listDeploys 与 createDeploy 从读写模块级状态改为收一个 DeploysRepo 入参——全工程唯一动到的函数签名，行为等价。
- 换隔离缝：单测从 resetDeploys() 换成 new InMemoryDeploysRepo(seed)，断言意图不变；e2e:ch2 加了种子重置、e2e:ch3 加了库可达探针，断言本体未动。
- 新增：server/db/ 的三个文件与迁移账本、server/utils/db.ts、compose.db.yaml 与起停脚本；再补 drizzle.config.ts、scripts/seed.mjs、tests/integration/ 与 vitest 分项目，以及 e2e:ch4。

门槛命令十件：起库三件（db:up、db:migrate、db:seed）与检查三件（typecheck、test、build），再加 e2e:ch1 到 e2e:ch4。都在 companion 目录执行，跨平台。

### 红：库在，表不在

库已经起了（pnpm db:up），但还没跑迁移——一座刚拉起的库正是这个状态，也是本章的红。生产构建后按 .env 的连接串把产物进程起到这座无表的库上，进程正常监听，然后：

```text
# GET /api/deploys 的响应体（真实输出）
{
  "error": true,
  "url": "http://127.0.0.1:4188/api/deploys",
  "statusCode": 500,
  "statusMessage": "Server Error",
  "message": "Server Error"
}
```

客户端只看得到一句脱敏的 Server Error；全文在进程日志里——PostgresError: relation "deploys" does not exist，SQLSTATE 42P01。红得其所：代码要的是「表存在且行为正确」，而表还不存在——不是连接错、不是配置错。转绿的路径不是改代码，是跑账本：

```text
# pnpm db:migrate（真实输出）
Reading config file …/drizzle.config.ts
Using 'postgres' driver for database querying
[✓] migrations applied successfully!

# pnpm db:seed（真实输出）
[seed] deploys 已重置为 3 条种子记录
```

同一时刻再 GET /api/deploys：200，3 条种子。结构归迁移，数据归种子，一步一格。账本此时已记满——再跑 generate，它只会告诉你 No schema changes, nothing to migrate。它未来的产出是 0001、0002：每当你改 schema.ts，先 generate 出可审查的 SQL，再 migrate 送进库。

### 装配：连接串到 SQL 的完整链路

剩下的实现你已经全部见过零件，装配只花四步。client.ts 把连接串变成绑定 schema 的池（连接池一节）；db/deploys.ts 把 DeploysRepo 落成 SQL（隔离缝一节）；utils/db.ts 用 runtimeConfig 的 dbUrl 造进程级单例（dbUrl 消费者一节）；最后两个 handler 各改一行。

```ts
// companion/server/api/deploys.get.ts · GET /api/deploys：文件路径即路由，.get 后缀限定 HTTP 方法
import { listDeploys } from '../domain/deploys'
import { useDeploysRepo } from '../utils/db'

export default defineEventHandler(() => {
  return listDeploys(useDeploysRepo())
})
```

```ts
// companion/server/api/deploys.post.ts · 节选：校验照旧在边界，落库换成仓库
export default defineEventHandler(async (event) => {
  // 校验失败（缺字段、格式不对）时 readValidatedBody 抛 400，进不了 createDeploy
  const input = await readValidatedBody(event, createDeploySchema.parse)
  const created = await createDeploy(useDeploysRepo(), input)
  setResponseStatus(event, 201)
  return created
})
```

读一遍链路：NUXT_DB_URL（环境）→ runtimeConfig.dbUrl（配置面）→ useDb()（单例池）；往下是 pgDeploysRepo()（SQL 实现）→ listDeploys(repo)（域规则）→ handler（适配）。请求校验在前端门口不动，域规则在中间不动，换掉的只是最底下的储藏室。跑门槛：

```text
# pnpm test 终态输出
 ✓ unit  tests/deploys.test.ts (4 tests) 5ms
 ✓ unit  tests/config.test.ts (7 tests) 7ms
 ✓ integration  tests/integration/deploys-db.test.ts (4 tests) 96ms

 Test Files  3 passed (3)
      Tests  15 passed (15)
```

组装证据在这一行输出里：unit 的 11 条断言意图一条未变——7 条配置门卫测试原样照绿，4 条域规则测试只换了隔离缝；integration 新增 4 条。只换骨架，不动门面。

### e2e:ch4：数据活过进程死亡

手工验证会烂掉，门槛不会。新增 scripts/e2e-ch4.mjs（端口 4174），两幕各钉一个主张。幕一：起进程 A，GET 恰好 3 条种子，POST 一条合法记录拿到 201 且 id=4（identity 接着种子计数），然后把进程 A 杀掉。幕二：同一份产物再起进程 B。进程 A 已死，它写的数据若还能读到，只可能活在数据库里：

```text
# pnpm e2e:ch4 终态输出
[e2e:ch4] 开发库已重置为 3 条种子记录
[e2e:ch4] 幕一：启动进程 A，写入一条记录后杀死它
[e2e:ch4] 进程 A 写入 {id: 4, commit: "e2e40fa"} → id 接着种子计数 PASS
[e2e:ch4] 进程 A 已被杀死 (pid 12000, code=null, signal=SIGTERM)
[e2e:ch4] 端口 4174 不再监听 → PASS
[e2e:ch4] 幕二：同一产物再启进程 B（进程 A 已死，数据只能活在数据库里）
[e2e:ch4] 进程 B GET 读回 4 条，新记录在最前 → PASS
[e2e:ch4] 首页裸 HTML 含幸存记录 "e2e40fa" → PASS
[e2e:ch4] 进程 B 已退出 (pid 42924, code=null, signal=SIGTERM)
[e2e:ch4] 端口 4174 不再监听 → PASS
[e2e:ch4] 全部断言通过 (3/3)
```

第三条断言值得单独看：fetch 不执行 JS，幸存记录出现在首页裸 HTML 里——SSR 渲染读的也是数据库。**数据活在数据库里，不活在进程里**，这句话在内存数据源时代不可能通过任何门槛。e2e:ch1 到 e2e:ch3 的既有断言一行未改照常全绿：SSR 文本由种子提供、POST 201/400、环境注入与缺配置自退——换的是粮仓，门面分毫未动。

## 验证：先猜，再跑

三个实验都在你机器上可复现。每个都先把预测写在纸上——离散的、能判对错的预测。

实验一：一次往返，两代进程。生产构建后起进程（Git Bash，companion 目录内）：

```bash
# 用法示例 · 终端一
PORT=4186 node --env-file=.env .output/server/index.mjs
```

先猜两件事：POST 一条合法记录（命令如下），状态码与响应里的 id 各是什么？然后用 psql 直接查库——你猜 psql 查得到刚 POST 的行吗，二选一？

```bash
# 用法示例 · 终端二
curl -s -X POST http://127.0.0.1:4186/api/deploys -H 'content-type: application/json' \
  -d '{"env":"production","status":"success","commit":"cafe012","summary":"手工验证：落库往返"}'
docker exec shiplog-db psql -U ship_log -d ship_log -c 'SELECT id, commit FROM deploys ORDER BY id DESC;'
```

对照：201 与 id: 4；psql 查得到——POST 写的就是这张物理的表，不是什么「应用内部状态」。第三步才是本题主菜：Ctrl+C 杀掉进程，重新起一个，GET /api/deploys——先猜几条？对照：4 条，新记录在最前。进程死了一回，数据毫发无伤：进程只是库的租客，租客换了，房产还在。进程留着别关，实验二继续用；另开终端把表重置回种子（pnpm db:seed），给破坏实验留干净起点。

实验二（定向破坏 A）：拆掉表。先写三个预测：DROP TABLE 之后 GET /api/deploys 的状态码是多少？GET / 的状态码呢——200 还是 500，二选一？页面上的表格还剩几行？

```bash
# 用法示例 · 终端二（进程还开着）
docker exec shiplog-db psql -U ship_log -d ship_log -c 'DROP TABLE deploys;'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4186/api/deploys
curl -s http://127.0.0.1:4186/
```

对照：500（42P01，本章红的那一幕）；首页居然还是 200，但表格空了零行——useFetch 的失败被页面吞掉，只剩一张空表。这个安静的半死比崩溃危险：健康检查若只探页面，库没了都发现不了。怎么把表找回来？先猜一步：跑 pnpm db:migrate 有用吗？对照：没用——它照常打印成功，表却没有回来。账本还在：journal 里那条「已应用」的记录没丢，migrate 只认账本，无事可做（和实验三将看到的沉默是同一个机制）。真正的复原路是连账本一起重置——开发库的数据本来就是种子给的，重置没有代价：

```bash
# 用法示例 · 终端二（数据卷一起清零重来）
pnpm db:down --volumes
pnpm db:up
pnpm db:migrate
```

这次是全新库、账本为空，全套迁移按序重放，表回来了；先猜现在 GET 返回几条？对照：0 条（空数组）——迁移只重放结构，不生产数据，这正是它可无限重放的原因。最后 pnpm db:seed，GET 回到 3 条种子。删表、重放账本、复种：结构与数据两条线各归其位。

实验三（定向破坏 B）：绕过账本手改表。在一切正常的库上执行：

```bash
# 用法示例 · 终端二
docker exec shiplog-db psql -U ship_log -d ship_log -c 'ALTER TABLE deploys ADD COLUMN note text;'
```

先猜两个输出再跑：pnpm db:migrate 报错还是照常成功，二选一？pnpm db:generate 说什么？然后各跑一次，再 \d deploys 看看那列在不在。对照：migrate 照常 migrations applied successfully（journal 里没有新条目，它无事可做）；generate 说 No schema changes（它 diff 的是 schema.ts 与迁移文件夹，不看活库）；\d 里那列在，schema.ts 里它不存在——三个事实拼起来就是开篇的事故现场：**手改发生在工具的视野之外，迁移只认账本，不盘点现实**。哪条没变也值得说：应用此时照常 200——select 显式挑列，多出来的列不碍事；风险不在今天，在下一次迁移与下一次消费者。复原：DROP COLUMN note，\d 回到 5 列，GET 仍 3 条。

## 收束：两座库重归一致

开篇那两座「一模一样」的库，现在能说清差在哪了：代码确实一字未差，差的是结构的历史。有人绕过版本控制手改了其中一边，表结构从此有了两份事实——bug 自然只在一边复现，下一次部署撞上那列孤儿结构才炸。本章给表结构立了单一事实源，并修了一条单向通道：schema.ts（声明）→ generate（可审查的 SQL 账本）→ migrate（按序执行、库里记账）。新库从账本一路重放出同一张表——本章你删过一次表、连账本一起清零后亲眼看它重放回来；手改发生在通道之外，账本不认、工具不报——所以纪律是：迁移管着的表不手改，急修也走迁移。两座库都从同一份账本建起来，「哪边是对的」这个问题失去意义，差异无处藏身。

组装式一句话：**server API（路由与序列化）+ 请求校验（边界守门）+ runtimeConfig（dbUrl 注入）+ 本章四块新积木 ⇒ 数据真实落库、活过进程死亡的全栈应用**。域规则与 HTTP 行为一行未动——当初把数据源挡在域逻辑之外，买的就是这次换心脏不用开颅。

本章的积木，后面每一章都在用：

- Drizzle schema——server/db/schema.ts 一份声明，行类型由 $inferSelect 流向应用代码；
- schema 迁移——generate 出账本、migrate 按序执行，库里 journal 记账，可无限重放；
- 连接池——createDb(dbUrl) 一池 max 5，进程级单例，连接是实例级预算；
- 集成测试数据库——globalSetup 造一次性库、跑同一份账本、teardown 销毁，开发数据永不入局。

两行去向：应用与这座库将被编排成一个可一键拉起的应用栈（第 5 章）；迁移在生产部署流程里的执行时机与失败处理（第 7 章）——CI 的服务容器还会原样搬用这座一次性测试库（第 8 章）。

## 自查

四道题都换了库与情境。先把答案押在纸上再翻面——每题都能靠本章的机制推出来，不必背原文。

<details>
<summary>1. 新同事往 schema.ts 的 deploys 表加了一列 remark，然后重启了 dev 服务器。psql 里 \d deploys 会看到 remark 吗？要让它在库里真正出现，还差哪两步？</summary>

看不到。schema.ts 是声明不是执行，改声明不动库。差的两步：pnpm db:generate（产出下一条可审查的迁移 SQL）与 pnpm db:migrate（把账本新条目送进库）。回查「Drizzle schema」末段与「schema 迁移」。
</details>

<details>
<summary>2. 接手的项目里，生产库被前员工手工加过一列 note，应用的 select 显式挑列所以一直没炸。今晚例行跑 pnpm db:migrate（没有新迁移文件），它会给出任何警告吗？要让「库的真实结构」回到与代码一致，正路是什么？</summary>

不会警告：journal 里没有新条目，migrate 无事可做，照常报成功——它只认账本，不盘点现实。正路是补一条走通道的修正：generate 出「删列」的迁移（先把 schema 与账本对齐到期望态）或手工执行逆向 ALTER 后确认 \d 与 schema.ts 一致；数据若需保全，先备份再动结构（恢复演练是数据库运维一章的话题）。回查「反事实：不迁移会发生什么」第二段。
</details>

<details>
<summary>3. 连接池的 max 为什么定 5 而不是 50？假设这个应用将来扩到 30 个副本，max=50 会先撞上什么墙？换成 max=5 呢，还剩多少余量？</summary>

max_connections=100 是整台实例的预算，应用、测试、psql 都在里面分。30 副本 × 50 = 1500 条，远超 100——新连接直接被库拒绝，业务还没压垮库，连接先耗尽。30 × 5 = 150，仍超预算但量级可控；真正要说的是：扩副本前先算连接预算，必要时调大 max_connections 或引入集中式代理。回查「连接池」一节的体感折算。
</details>

<details>
<summary>4. 「数据活在数据库里，不活在进程里」这条断言，为什么内存仓库的单测永远证不了、集成测试却证得了？给出那个测试用的判据动作。</summary>

内存实现里状态活在实例里：换一个 new 出来的仓库，读到的永远是空副本——「新实例读得到」在内存世界里恒假。集成测试的判据动作是：实例一写入后，用第二个全新连接池（createDb 再造一个实例）去 list，断言读得到同一条。这个动作只有持久层能满足，所以它就是「换掉内存数组」的证明。回查「集成测试数据库」的节选测试与 e2e:ch4 幕二。
</details>
