---
title: 数据要活得比进程久：PostgreSQL 与 Drizzle
---

# 数据要活得比进程久：PostgreSQL 与 Drizzle

## 工具箱

本章要用两块旧积木，先摆上台面。

- 无状态服务——判断数据该放哪的那把尺：「进程重启后它该不该还在」；该在的，就不能放进程内存（[第 1 章](./01-request-journey)）。
- 端点——前后端之间的函数签名：URL 加方法加输入输出约定；本章三个端点的行为契约一行不改，换的只是签名背后的存储（[第 2 章](./02-monorepo-api)）。

手边有这两条，就能开工。

昨晚的演示很成功。你给朋友发了一串 localhost 开头的短链，创建、跳转、再创建，一切正常，然后合上电脑去睡觉。

今早打开电脑，进程重新拉起来，逐条点开昨晚的短链——404，全部 404。服务明明活着：healthz 照样回 200，新建短链照样 201。死掉的不是服务，是数据。它们昨晚住在进程内存的一个 Map 里，进程一重启，那块内存被操作系统收走再分配，昨晚的十几条短链就这样蒸发了——没有报错、没有日志、没有尸体。

这不是玄学，是可以预演的机制。dev 模式里它天天发生：tsx watch 每次存盘都重启进程，等于每次存盘都清空一次数据。拿工具箱里那把尺量一下：短链重启后该不该还在？该在。所以它不该住在进程内存里——放错了地方，才是 404 的全部原因。

这一章把数据的家搬到进程外：一块真正的磁盘地皮（PostgreSQL），一张为短链量身定的表，一套让表结构跟着代码进版本管理的迁移，一条按值定位的索引，以及一组复用一生的连接。搬完之后，端点不动、测试不改，重启随便来。

## 原理：把数据的家搬到进程外

本章一次立五个名字：持久化（数据活得比进程久）、表与行（数据库组织数据的方式）、迁移（表结构的版本管理）、索引（拿空间换读延迟的结构）、连接池（建连一次、复用多次的一组连接）。每个一小节，先讲为什么存在，再讲机制。

### 持久化：数据活得比进程久

持久化（persistence）就是让数据活得比进程久——写进进程之外的存储，进程崩溃、重启、升级，数据不动。载体这一章选 PostgreSQL：一个关系数据库系统，数据落在磁盘文件里，由它自己的服务进程管理。你的 api 进程死了，它的进程还活着；它的进程死了，数据还在磁盘上。

先替一个流行的直觉说句公道话：「数据库不就是个更大的变量吗？put 一下、get 一下，跟 Map 没什么区别。」从接口看确实像——本章的存储接口就只有 put 与 get 两个方法。你在前端用过 localStorage、见过键值对缓存，这个直觉有来处，而且在小数据量下完全够用。

边界出在代价结构。Map 的读写发生在自己进程的内存里，纳秒级；数据库的每次读写，都是一次跨进程、跨网络的消息往返，毫秒级——差着五个数量级。正因为贵，才长出了本章剩下的四个概念：数据要按结构放（表与行）、结构要版本化（迁移）、查找不能逐行翻（索引）、连接不能每次新建（连接池）。把这五个名字当成一组，它们共同回答一个问题：**怎么把「更大的变量」的错觉，换成真实的成本观**。

### 表与行：换一种组织方式

表与行（table and row）是关系数据库组织数据的方式：表是同类记录的集合，每行是一条记录，每列有固定的类型与约束。换算成程序视角：表像 element 类型固定的数组，行像对象，列的约束像运行时版本的编译器检查——NOT NULL 挡空值，UNIQUE 挡重复，类型挡脏数据。

这跟请求校验是同一套思路的两道门：zod schema 挡在网络门口，表约束挡在存储门口。前者防的是「不可信的请求」，后者防的是「即便代码有 bug，脏数据也进不了库」。短链的表叫 links，四列：

- id：uuid 主键，默认值由数据库生成随机 uuid（PostgreSQL 13 起内置 gen_random_uuid）；
- slug：短码，text，NOT NULL 加 UNIQUE；
- url：原网址，text，NOT NULL；
- createdAt：创建时间，timestamptz（带时区的时间戳），默认取写入时刻。

UNIQUE 值得多看一眼：它有双重身份。作为约束，第二个相同 slug 插进来会被数据库当场拒绝；作为副产品，数据库会自动为这一列维护一棵唯一索引——下一节的主角，这里先埋个名字。

schema 用 Drizzle 写成 TypeScript，查询结果自动带类型。跟 zod 一样，这是一份声明式描述：你说表长什么样，Drizzle 负责生成 SQL 与类型。

### 迁移：表结构也进版本管理

迁移（migration）是把 schema 的每次变更——建表、加列、加索引——记录成有序的、可重放的小脚本。表结构跟代码一样会演进，本章自己就要变两次：先建 links 表，再给 url 列加索引。

为什么非要脚本？反事实：三个环境（你的本机、同事的本机、将来的生产）各自手工改表，第一次变更就开始漂移——你加了索引、同事没加，代码一模一样，性能天差地别；漂移到某天，一边的表少一列，查询直接报错。迁移让「表结构」进 git：代码与表结构同一次提交、同一份历史，每个环境按同一顺序重放到同一形态。

Drizzle 的分工是两条命令：`drizzle-kit generate` 对比 schema 与上次的差异，生成一份 SQL 迁移文件（进 git）；执行侧把文件按序重放，已应用过的自动跳过——所以重复执行是安全的，空库也能一键就绪。演练里你会看到生成的 SQL 原文：就是两条朴素的 `CREATE TABLE` 与 `CREATE INDEX`，没有任何魔法。

### 索引：拿空间和写放大，换读延迟

索引（index）是数据库为某几列额外维护的有序查找结构——PostgreSQL 默认用 B-tree，一棵按值排好序的树。它解决的问题是：数据量线性增长时，逐行扫描的延迟也线性增长；短链服务最热的查询是「按 slug 找一行」，30000 行逐行翻，每次跳转都要翻一遍。

有了索引，查找从「逐行看」变成「按值定位」。数字换体感：30000 行的表躺在约 2968 kB 里，PostgreSQL 每次读一页 8 kB，全表扫一遍要碰三百多页；走 B-tree，从树根到叶子只要两三步。本章演练用 EXPLAIN 亲眼看这两种计划的原文，先按下不表。

先替第二个直觉说句公道话：「加索引没有成本，全加上就好。」读变快这件事确实接近免费——小表上甚至感觉不到差别；而且很多教程只演示加索引前后的查询速度，成本从来不进画面。这个直觉在「只看读」的世界里成立。

但账有两笔，都得算。第一笔是空间：索引是额外的数据结构，实打实占磁盘。本章演练的实测数字——30000 行的 links 表占 2968 kB，url 列的索引占 1480 kB——一棵索引，约等于半个表。第二笔是写放大：每次 INSERT 或 UPDATE，除了写表本身，还要同步更新这张表上的每一棵索引。links 表现在有三处写入点：表、slug 的唯一索引、url 的索引；再加一列索引，写路径就再多一处。索引越多，写越慢、占得越多。**索引是拿空间和写放大，换读延迟**——按查询加，不按列加。

### 连接池：建连一次，复用一万次

连接池（connection pool）是应用预先建好并复用的一组数据库连接。先算没有它会怎样。

每条连接的诞生不便宜：TCP 三次握手，加上 PostgreSQL 的认证对话（SCRAM 加密验证，好几个来回），每个来回都是一次网络往返。数量级口径：本机回环一次往返 0.1ms 级，跨网络 1ms 到 10ms 级——建连随手就是几毫秒，而一条走了索引的查询本身常常不到 1ms。也就是说，每个查询新建一条连接，连接的开销可能比查询还贵。

第二笔账是上限。数据库能同时服务的连接数有限，PostgreSQL 默认 100。假设每个请求各开一条连接，一百来个并发就把名额吃满，之后所有新连接被直接拒绝——服务看起来毫无征兆地瘫了。池子把「建连」从每次查询的成本，摊销成按连接计的一次性成本：连接按需建立、建好后全程复用，数量封顶（postgres.js 默认 10 条）。并发再高也不多建，超过上限的查询排队等归还。

本章用的 postgres.js 驱动把这件事做到了 API 形状里：`postgres(url)` 返回的那一个 `sql` 实例本身就是池。连接懒建立——第一条查询才真正建连，连接串写错也是那时才炸；建好后全程复用，上限默认 10 条，进程退出前 `end()` 归还。不需要额外的池库、不需要配置类——一个实例，就是一个池。

五个名字到齐，可以拼出本章的组装式：无状态服务的判据说「该在的数据不放进程内存」；put/get 注入缝让存储可以整体替换；表装数据、迁移管结构、索引管快、池子管连接。四样凑齐 ⇒ 数据活得比进程久，端点一行不改。

## 演练：从红到绿，换掉存储

companion 这座验证物工程你已经跑过两轮门槛，本站继续在它上面动刀：代码跟着敲、门槛跟着跑，每段代码首行标注它在仓里的真实路径。环境要求沿用上一站：Node 22 与 pnpm 10（本课验证环境 2026-09 时点为 Node 22.22.2、pnpm 10.32.1），外加能跑的 Docker。命令在 Windows 的 Git Bash 与 PowerShell 里都能执行。

### 手术清单

进手术室之前，先看清动刀范围。

**不改**：apps/api/src/app.ts 的三个端点——路由、校验、状态码、响应形状一行不动；src/store.ts 的 LinkStore 注入缝原样（它的返回值本来就同时放行同步与 Promise）；apps/api/src/app.test.ts 与 contract.test-d.ts（第 2 章的 e2e 与契约类型测试，一字不改，最后用文件哈希对账）；packages/shared 与 apps/web 整包不碰。

**动**：apps/api/src/main.ts，把注入的工厂从内存版换成 PgStore；apps/api/package.json 与 tsconfig.json，新增依赖、把 test 目录纳入类型检查。

**新增**：基础设施两件——docker/compose.infra.yml 与 scripts/compose-infra.mjs（教学数据库的开关）。存储五件——src/config.ts（连接串读法）、src/db/schema.ts（表声明）、drizzle.config.ts 与 drizzle/ 迁移目录、src/db/store.pg.ts（新心脏）。测试四件——test/ 下三个文件与 vitest.config.ts。

### 第一步：起一个自己的 Postgres

数据库用一个容器跑。容器（container）——把软件连同运行环境装进一只一次性盒子里运行：盒子删掉整体消失，数据另存在盒外的「卷」里（它凭什么做得到，第 7 章专门拆）。眼下把它当成一只随开随关的数据库盒子即可，声明成一个 YAML 文件：

```yaml
# companion: docker/compose.infra.yml —— 教学基础设施（本章只有 pg；第 5 章在同一文件加 redis）
services:
  pg:
    image: postgres:16-alpine
    container_name: shortlink-pg
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: shortlink
    ports:
      # 宿主 5544 -> 容器 5432：避开本机可能已装的 Postgres
      - "5544:5432"
    volumes:
      # 具名卷：docker compose down 不删数据，up 回来数据仍在
      - shortlink_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d shortlink"]
      interval: 2s
      timeout: 3s
      retries: 15

volumes:
  shortlink_pgdata:
```

三处细节承重。端口 5544 映射到容器里的 5432，是为了不跟你本机可能已有的 Postgres 抢 5432。healthcheck 让「就绪」变成可判定的：compose 反复跑 `pg_isready`，问到数据库真答应为止。volumes 是一块具名卷——数据库的磁盘文件住在卷里，容器删了卷还在；这本身是第一重持久化，验证槽里会实测。

再来一个跨平台开关脚本，Windows、macOS、Linux 用同一条命令。命令都在 companion 目录里执行。

```js
// companion: scripts/compose-infra.mjs —— 教学基础设施的开关
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const companionRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const composeFile = join(companionRoot, 'docker', 'compose.infra.yml')

const command = process.argv[2]

function compose(args) {
  const result = spawnSync('docker', ['compose', '-f', composeFile, ...args], {
    stdio: 'inherit',
  })
  if (result.error) {
    console.error('找不到 docker 命令：请先安装并启动 Docker Desktop（或本机等价的 docker + compose）。')
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (command === 'up') {
  compose(['up', '-d', '--wait'])
  console.log('教学 Postgres 已就绪：postgres://postgres:postgres@localhost:5544/shortlink')
} else if (command === 'down') {
  compose(['down'])
  console.log('教学基础设施已停止（具名卷保留：再次 up 后数据仍在）。')
} else if (command === 'status') {
  compose(['ps'])
} else {
  console.error('用法: node scripts/compose-infra.mjs up|down|status')
  process.exit(2)
}
```

在 companion 目录里执行：

```text
$ node scripts/compose-infra.mjs up
Container shortlink-pg Starting
Container shortlink-pg Healthy
教学 Postgres 已就绪：postgres://postgres:postgres@localhost:5544/shortlink
```

`--wait` 会一直等到 healthcheck 转绿才返回，所以这条命令结束，数据库就真能用了。down 停容器不删卷；status 看状态。这套脚本以后每章共用。

### 第二步：依赖与版本

在 apps/api 里装三样东西（2026-09 时点安装结果，以伴生仓 pnpm-lock.yaml 固定为准；依赖会过期，lockfile 不会）：

```text
$ pnpm --filter @shortlink/api add drizzle-orm@^0.45.0 postgres@^3.4.5
$ pnpm --filter @shortlink/api add -D drizzle-kit@^0.31.0
```

| 依赖 | 版本 | 角色 |
| --- | --- | --- |
| drizzle-orm | 0.45.2 | schema 声明与类型化查询 |
| postgres | 3.4.9 | postgres.js 驱动；一个实例就是一个连接池 |
| drizzle-kit | 0.31.10 | 生成与执行迁移（devDependency） |
| 镜像 postgres:16-alpine | PostgreSQL 16.15 | 教学数据库本体 |

### 第三步：schema——表在 TypeScript 里的样子

```ts
// companion: apps/api/src/db/schema.ts · links 表——短链在数据库里的形状
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const links = pgTable(
  'links',
  {
    // 主键：数据库自己生成的随机 uuid（gen_random_uuid()，PostgreSQL 13 起内置）
    id: uuid('id').primaryKey().defaultRandom(),
    // 短码：唯一。unique 约束同时让数据库自动维护一棵唯一索引
    slug: text('slug').notNull().unique(),
    // 原网址
    url: text('url').notNull(),
    // 创建时间：带时区的时间戳，默认取写入时刻
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 「按原网址反查短码」也会出现在查询里：给 url 单独建一棵索引（0001 号迁移）
    index('links_url_idx').on(table.url),
  ],
)
```

列定义与原理节那张清单一一对应。`(table) => [index(...)]` 这第三个参数是表级附件：这里声明一棵名为 links_url_idx、按 url 列组织的索引——它先按下不表，第九步生成迁移时才登场。`withTimezone: true` 对应 timestamptz：时间点本身没错乱，时区只是它的显示方式。

### 第四步：生成迁移——表结构进 git

drizzle-kit 需要一份配置，放在 api 包里：

```ts
// companion: apps/api/drizzle.config.ts · drizzle-kit 的配置
import { defineConfig } from 'drizzle-kit'
import { requireDatabaseUrl } from './src/config'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: requireDatabaseUrl(),
  },
})
```

package.json 加两条脚本：`"db:generate": "drizzle-kit generate"`、`"db:migrate": "drizzle-kit migrate"`。先只建表——把 schema 里 url 索引那三行暂时注释掉，执行 `pnpm --filter @shortlink/api db:generate`，apps/api/drizzle/ 里落下第一份迁移：

```sql
-- companion: apps/api/drizzle/0000_links.sql
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_slug_unique" UNIQUE("slug")
);
```

这就是原文，没有魔法：一张表、四个列定义、一个唯一约束。注意最后一行——slug 的 UNIQUE 落成了名为 links_slug_unique 的约束，数据库会为它自动维护一棵同名唯一索引。旁边还有个 meta/ 目录，drizzle 用它记住「上次生成到哪」，下次 generate 只对差异出 SQL。

执行侧有两个入口：开发时 `pnpm --filter @shortlink/api db:migrate`；测试里用 drizzle-orm 自带的 migrator（第六步的 helpers 里），每个测试批次开工前把库跑到最新。两边都幂等——已应用的迁移自动跳过，空库从零重放。

### 第五步：DATABASE_URL 的读法

```ts
// companion: apps/api/src/config.ts · 数据库连接串的读法
const DEV_DATABASE_URL = 'postgres://postgres:postgres@localhost:5544/shortlink'

/**
 * 读取 DATABASE_URL。
 * 开发环境给一个指向教学 Postgres 的默认值；生产环境（NODE_ENV=production）缺失时当场报错——
 * 与其带着空配置起一个必坏的服务，不如启动即失败（fail-fast）。
 */
export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim()
  if (url) return url
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_URL 未设置：生产环境必须显式提供数据库连接串（开发默认值只在开发环境生效）',
    )
  }
  return DEV_DATABASE_URL
}
```

读法一句话：优先读环境变量 `process.env.DATABASE_URL`，开发环境缺省时用指向教学库的默认值，生产环境缺失就启动即报错——坏配置应该在部署那一刻炸，而不是在第一个用户请求上炸。它由三段拼成：用户 postgres、密码 postgres、主机 localhost:5544（宿主端口）加库名 shortlink。本章只教这一条环境变量的读法；.env 文件分层与密钥边界后面统一收口（[第 7 章](./07-containerize)）。

### 第六步：PgStore——缝后面换心脏

```ts
// companion: apps/api/src/db/store.pg.ts · PgStore——住在 PostgreSQL 里的存储实现
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import type { LinkResponse } from '@shortlink/shared'
import { links } from './schema'

export interface PgStore {
  put(link: LinkResponse): Promise<LinkResponse>
  get(slug: string): Promise<LinkResponse | undefined>
  /** 关掉连接池：进程退出前调用，把连接还给数据库 */
  end(): Promise<void>
}

/**
 * 一个 postgres() 实例就是一个连接池：连接按需建立、复用到进程退出（默认上限 10 条）。
 * 数据库连接串来自 DATABASE_URL（见 src/config.ts）。
 */
export function createPgStore(databaseUrl: string): PgStore {
  const pool = postgres(databaseUrl)
  const db = drizzle(pool, { schema: { links } })

  return {
    async put(link) {
      // id 不传：让数据库自己生成随机 uuid
      await db
        .insert(links)
        .values({ slug: link.slug, url: link.url, createdAt: new Date(link.createdAt) })
      return link
    },
    async get(slug) {
      const rows = await db.select().from(links).where(eq(links.slug, slug)).limit(1)
      const row = rows[0]
      if (!row) return undefined
      // 契约形状在门口对齐：timestamptz 的 Date 转回 ISO 字符串
      return { slug: row.slug, url: row.url, createdAt: row.createdAt.toISOString() }
    },
    async end() {
      await pool.end({ timeout: 5 })
    },
  }
}
```

逐处看关键行。`postgres(databaseUrl)` 返回的 pool 就是连接池本身——一个实例、一组连接、全程复用，这正是原理节说的「一个 sql 实例即池」。put 把契约里的 ISO 字符串转成 Date 交给 timestamptz，get 再转回来。LinkResponse 的形状在 store 门口对齐，端点永远不知道底下是 Map 还是表。PgStore 没写 `implements LinkStore`——TypeScript 按结构认接口：put 与 get 的形状满足那道缝，它就过。

启动入口换成新心脏，这是本章唯一动到的旧文件：

```ts
// companion: apps/api/src/main.ts
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { requireDatabaseUrl } from './config'
import { createPgStore } from './db/store.pg'

const port = Number.parseInt(process.env.PORT ?? '4510', 10)
const store = createPgStore(requireDatabaseUrl())

serve({ fetch: createApp(store).fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
})
```

第一次跑 dev 之前先执行一次 `pnpm --filter @shortlink/api db:migrate`，把空库备好（或者干脆先跑测试，测试会替你备）。

### 第七步：先红——重启剧本打在内存实现上

新测试 file 写一个「重启剧本」：第一代进程（独立 store + 独立 HTTP 服务）创建一条短链后整体丢弃；第二代进程用全新的 store 与 app 查同一条短链。两代之间没有任何共享引用——数据若还能找到，它只能住在进程之外。

```ts
// companion: apps/api/test/persistence.test.ts · 重启剧本与两代进程（红阶段形态·教学示意，终态为参数化 boot 与工厂表，见第八步）
import { serve } from '@hono/node-server'
import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store'

// 红阶段：工厂先指向内存 store——如果数据只活在进程内存，重启剧本必须失败
const makeStore = () => createMemoryStore()

/** 起一个「进程」：独立 store + 独立 HTTP 服务（临时端口） */
function boot(): { base: string; shutdown: () => Promise<void> } {
  const store = makeStore()
  const server = serve({ fetch: createApp(store).fetch, port: 0 })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('expected the test server to listen on an ephemeral port')
  }
  return {
    base: `http://127.0.0.1:${address.port}`,
    shutdown: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      const maybeEnd = (store as { end?: () => Promise<void> }).end
      if (maybeEnd) await maybeEnd()
    },
  }
}

/** 重启剧本：第一代创建短链并退出；第二代全新 store+app 查同一条短链 */
async function playRestart(): Promise<{ slug: string; status: number; location: string | null }> {
  const gen1 = boot()
  const created = await fetch(`${gen1.base}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/survives-restart' }),
  })
  expect(created.status).toBe(201)
  const body = (await created.json()) as { slug: string }
  await gen1.shutdown()

  // 第一代已被整体丢弃：如果数据还在，它只能在进程之外
  const gen2 = boot()
  const redirect = await fetch(`${gen2.base}/${body.slug}`, { redirect: 'manual' })
  const outcome = {
    slug: body.slug,
    status: redirect.status,
    location: redirect.headers.get('location'),
  }
  await gen2.shutdown()
  return outcome
}
```

断言只有两条：第二代拿到 302，Location 指向原网址。跑它：

```text
× 模拟进程重启：丢弃第一代 app 与 store，同一数据库起第二代——旧 slug 仍是 302
AssertionError: expected 404 to be 302
Tests  1 failed (1)
```

红得干净：expected 404 to be 302。红因单一——数据只在第一代进程的堆里，第二代的 Map 是一张白纸。不是语法错、不是路径错、不是连不上数据库：是持久化这个能力还不存在。

### 第八步：转绿——换一行工厂

把工厂行换成 PgStore，再在开工前把库跑到最新：

```ts
// companion: apps/api/test/persistence.test.ts · 转绿后的工厂与就绪步骤（节选）
import { createPgStore } from '../src/db/store.pg'
import { databaseUrl, ensurePg, migrateToLatest } from './helpers'

await ensurePg()

const makeStores: Record<'pg' | 'memory', () => AnyStore> = {
  pg: () => createPgStore(databaseUrl),
  memory: () => createMemoryStore(),
}

beforeAll(async () => {
  await migrateToLatest()
})

describe('持久化：重启之后数据还在', () => {
  it('模拟进程重启：丢弃第一代 app 与 store，同一数据库起第二代——旧 slug 仍是 302', async () => {
    const outcome = await playRestart(makeStores.pg)
    expect(outcome.status).toBe(302)
    expect(outcome.location).toBe('https://example.com/survives-restart')
  })

  it('对照组：同一剧本换内存 store，第二代拿到 404（重启即丢的机制性记录）', async () => {
    const outcome = await playRestart(makeStores.memory)
    expect(outcome.status).toBe(404)
  })
})
```

断言一字未动，换的是工厂。两个帮手住在 test/helpers.ts。`ensurePg` 在文件顶部连一次 `select 1`，连不上时给出「先跑 node scripts/compose-infra.mjs up」的提示，而不是一屏 ECONNREFUSED。`migrateToLatest` 用 drizzle-orm 的 migrator 把迁移跑到最新，幂等、空库一键就绪。

```ts
// companion: apps/api/test/helpers.ts · pg 就绪检查与迁移执行
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { requireDatabaseUrl } from '../src/config'

export const databaseUrl = requireDatabaseUrl()
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

export async function ensurePg(url: string = databaseUrl): Promise<void> {
  const client = postgres(url, { max: 1 })
  try {
    await client`select 1`
  } catch (err) {
    throw new Error(
      `连不上教学 Postgres（${url}）。\n` +
        '先在 companion 目录执行：node scripts/compose-infra.mjs up\n' +
        `原始错误：${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    await client.end({ timeout: 3 })
  }
}

export async function migrateToLatest(url: string = databaseUrl): Promise<void> {
  if (!existsSync(migrationsFolder)) {
    throw new Error(`迁移目录不存在：${migrationsFolder}\n先执行：pnpm --filter @shortlink/api db:generate`)
  }
  const client = postgres(url, { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder })
  } finally {
    await client.end({ timeout: 3 })
  }
}
```

顺手补一个 vitest.config.ts：测试共享同一个教学数据库，文件之间要串行（`fileParallelism: false`），否则一个文件清表时另一个文件正在断言。再跑：

```text
✓ test/persistence.test.ts (2 tests)
Tests  2 passed (2)
```

绿了，而且对照组那条永远绿的 404 把「内存实现重启即丢」钉成了机制性记录。现在对账组装证据。app.test.ts 里的六条 e2e 与 contract.test-d.ts 的契约类型断言，从本章开工到现在一个字符没动（文件 sha1 前后一致）。PgStore 就位后它们照常全绿——旧接口照常工作，这就是「只换心脏、不动门面」的机械证据。

### 第九步：索引实验——30000 行的两种命运

把第三步注释掉的 url 索引放回 schema，再生成第二份迁移：

```text
$ pnpm --filter @shortlink/api db:generate --name links_url_idx
```

```sql
-- companion: apps/api/drizzle/0001_links_url_idx.sql
CREATE INDEX "links_url_idx" ON "links" USING btree ("url");
```

一行 SQL，一棵 B-tree。实验测试把这个过程原样走一遍：播种 30000 行、用 EXPLAIN 看两份计划原文、然后重放 0001 号迁移再看一次。核心三段：

```ts
// companion: apps/api/test/index-experiment.test.ts · 播种与计划打印（核心）
const ROWS = 30_000
const PROBE_SLUG = 'seed-012345'
const PROBE_URL = `https://example.com/${PROBE_SLUG}`

const client = postgres(databaseUrl)
const db = drizzle(client)

/** 跑 EXPLAIN（文本格式），把计划原文打进测试输出，并返回整段文本供断言 */
async function explain(label: string, query: string): Promise<string> {
  const rows = (await client.unsafe(`EXPLAIN ${query}`)) as Record<string, unknown>[]
  const plan = rows.map((row) => String(Object.values(row)[0])).join('\n')
  console.log(`\n===== ${label} =====\n${plan}\n`)
  return plan
}

beforeAll(async () => {
  await migrateToLatest()
  // 回到「url 还没有索引」的起点：0001 号迁移建过就先删掉，保证本文件从确定状态出发
  await client`DROP INDEX IF EXISTS links_url_idx`
  await client`TRUNCATE TABLE links`

  // 播种 30000 行：slug 与 url 一一对应、各不相同
  const batchSize = 1_000
  for (let start = 0; start < ROWS; start += batchSize) {
    const batch = Array.from({ length: batchSize }, (_, i) => {
      const n = String(start + i + 1).padStart(6, '0')
      return {
        slug: `seed-${n}`,
        url: `https://example.com/seed-${n}`,
        createdAt: new Date(),
      }
    })
    await db.insert(links).values(batch)
  }
  // 让规划器拿到新鲜统计信息，计划选择才稳定可断言
  await client`ANALYZE links`
}, 180_000)
```

断言直接押在计划文本上：slug 查询的计划里要有 `Index Scan`，无索引的 url 查询里要有 `Seq Scan`，重放 0001 之后 url 查询回到 `Index Scan`。跑完，三种计划的原文就躺在测试输出里：

```text
===== slug 等值查询（唯一索引） =====
Limit  (cost=0.29..8.30 rows=1 width=68)
  ->  Index Scan using links_slug_unique on links  (cost=0.29..8.30 rows=1 width=68)
        Index Cond: (slug = 'seed-012345'::text)
```

```text
===== url 等值查询（未建索引） =====
Limit  (cost=0.00..746.00 rows=1 width=68)
  ->  Seq Scan on links  (cost=0.00..746.00 rows=1 width=68)
        Filter: (url = 'https://example.com/seed-012345'::text)
```

```text
===== url 等值查询（重放 0001 号迁移后） =====
Limit  (cost=0.41..8.43 rows=1 width=68)
  ->  Index Scan using links_url_idx on links  (cost=0.41..8.43 rows=1 width=68)
        Index Cond: (url = 'https://example.com/seed-012345'::text)
```

读懂这三段。Seq Scan 是顺序扫描：从第一页翻到最后一页，拿每一行的 url 跟目标比——30000 行、三百多页，一页不落。Index Scan 是按值定位：从 B-tree 树根往下走两三步，直接落在目标行所在的页。`Index Cond` 与 `Filter` 的区别就是这两种命运的原文：前者是「索引直接给出位置」，后者是「逐行过滤、可能全翻完」。

cost 是规划器自己的记账单位（顺序读一页记 1.0），不是毫秒——但它适合作相对比较：同一个查询，746 对 8.43，差着约 88 倍；表再涨十倍，Seq Scan 的 cost 大致跟着涨十倍，Index Scan 几乎不动。最后是空间账，测试输出里顺手打了实测：

```text
===== 空间账 =====
{ heap: '2968 kB', slug_index: '936 kB', url_index: '1480 kB', url_index_bytes: '1515520' }
```

表本体 2968 kB，slug 唯一索引 936 kB，url 索引 1480 kB——两棵索引合计 2416 kB，约为表本体的八成：相当于每存一张表，再付八成的索引地租。原理节那笔成本账，数字在此对齐：读延迟 88 倍的改善，买单的是约八成的额外空间与每行多一处索引写入。

### 门槛

在 companion 目录里按序执行（pg 必须在跑，测试才立得住）：

```text
$ node scripts/compose-infra.mjs up
教学 Postgres 已就绪：postgres://postgres:postgres@localhost:5544/shortlink
$ pnpm test
packages/shared  Tests  8 passed (8)
apps/api         Tests  11 passed (11)
$ pnpm typecheck
packages/shared typecheck: Done
apps/api typecheck: Done
apps/web typecheck: Done
```

退出码 0。8 条旧契约测试加 11 条 api 测试（六条端点 e2e 原样、两条重启剧本、三条索引实验），从本章起，数据库在跑是测试门槛的一部分。

## 验证：让数据死而复生

每一步先把预测写下来，再执行对照。前三步都在 pg 与 dev 服务就绪的前提下做。

### 一、先猜后跑：两代进程的 302

跑 `pnpm --filter @shortlink/api exec vitest run test/persistence.test.ts` 之前先猜：两条测试各是什么颜色——pg 版 302 还是 404？内存对照组呢？写下来再跑，对照输出。

定向变体：把第一条 it 里的 `makeStores.pg` 改成 `makeStores.memory` 再跑。先猜几条红几条绿——应看到恰好 1 条红（pg 那条变红，expected 404 to be 302），对照组那条照绿。它守的是「内存实现就该丢」这条机制记录，换工厂伤不到它。改回复原，2 条全绿。

### 二、定向破坏：删掉 url 索引

测试跑过后，30000 行还在库里，正好当实验田。进数据库看计划（Git Bash 与 PowerShell 同命令）：

```bash
docker exec -it shortlink-pg psql -U postgres -d shortlink -c "EXPLAIN SELECT id, slug, url, created_at FROM links WHERE url = 'https://example.com/seed-012345' LIMIT 1;"
```

先猜：输出里有 Index Scan 还是 Seq Scan？执行，应看到 `Index Scan using links_url_idx`。然后删掉它：

```bash
docker exec -it shortlink-pg psql -U postgres -d shortlink -c "DROP INDEX links_url_idx;"
```

再跑一遍同样的 EXPLAIN——先猜，应回到 `Seq Scan on links`，Filter 逐行过滤。恢复不用手写 SQL：重跑 test/index-experiment.test.ts——第三条测试会读取 0001 号迁移文件的原文、逐条重放，把索引建回来。或直接执行迁移里那一行 `CREATE INDEX "links_url_idx" ON "links" USING btree ("url");`，再 EXPLAIN 确认 Index Scan 回来。

解释：删索引改变的是「数据库手里的查找结构」，表与数据分毫未动；规划器每条查询现选路线——手里有按 url 排序的树就走树，没有就翻表。顺带试一句 `DROP INDEX links_slug_unique`，会被数据库拒绝：它背后站着 UNIQUE 约束，删它得先删约束——连带失去「挡重复」这重保护，这就是约束与索引的双身份。

### 三、终极重启：连容器一起死

前两步杀的是进程，这一步杀容器。起 dev（库已就绪），创建一条短链：

```text
$ curl -X POST http://localhost:4510/api/links -H "content-type: application/json" \
    -d '{"url":"https://example.com/container-restart-proof"}'
{"slug":"VzSf914","url":"https://example.com/container-restart-proof","createdAt":"2026-09-09T03:14:09.450Z"}
$ curl -i http://localhost:4510/VzSf914
HTTP/1.1 302 Found
location: https://example.com/container-restart-proof
```

然后停掉整个数据库容器再拉起来（dev 服务不用动）：

```text
$ node scripts/compose-infra.mjs down
教学基础设施已停止（具名卷保留：再次 up 后数据仍在）。
$ node scripts/compose-infra.mjs up
教学 Postgres 已就绪：postgres://postgres:postgres@localhost:5544/shortlink
$ curl -i http://localhost:4510/VzSf914
HTTP/1.1 302 Found
location: https://example.com/container-restart-proof
```

先猜再跑：第二条 curl 是 302 还是 500？——302。api 进程没死，只是它背后的数据库死过一次；重连由连接池自动完成，数据躺在具名卷的磁盘文件里，容器的生死与它无关。开篇那批 404 的短链，换成这套结构，一条都不会丢。

### 四、把结果讲给自己听

三步各自的结论：进程重启丢的是内存，不丢磁盘；删索引丢的是快，不丢数据；容器重启丢的是数据库进程，不丢卷。三句话共用一个机制——**数据活在进程外，进程就死得起**。哪一步的现象与此不符，回到对应小节重推一遍。

## 收束：数据现在活得比进程久

开篇那个早晨可以重演一遍了：进程重启、tsx watch 存盘重启、数据库容器整个 down 再 up——昨晚的短链一条不丢。它们不再住在 Map 里，而是住在一张由迁移建好形状的表里：slug 上有唯一约束挡重复也挡慢查，url 上有一棵算过账的索引，api 与数据库之间是一个复用一生的连接池。端点没动、六条 e2e 没改一个字符，动的只有缝后面那颗心脏。

带走五块积木：

- 持久化——数据活得比进程久：写进进程外存储，进程随便死；
- 表与行——同类记录成表、约束当运行时编译器，schema 用 Drizzle 写成 TypeScript；
- 迁移——表结构变更记成可重放的 SQL 小脚本，与代码同一份 git 历史；
- 索引——拿空间和写放大换读延迟，用 EXPLAIN 亲眼看 Seq Scan 与 Index Scan；
- 连接池——建连一次复用一生，postgres.js 里一个实例就是一个池。

边界照实说：服务还没有「谁」的概念，任何人都能建链、也看得到所有人的链——归属要等登录进来（下一站：[第 4 章](./04-auth-session)）。环境变量本章只教了 DATABASE_URL 这一条的读法，.env 分层与密钥边界到容器化时统一收口（[第 7 章](./07-containerize)）。

自查一遍（先答再看）：

1. 产品要加「最近创建的 100 条短链」列表页，查询是 `ORDER BY created_at DESC LIMIT 100`。该不该给 created_at 加索引？加完之后哪两笔账变贵？
2. 同事 review 时说：「slug 的索引白占 936 kB，反正查询也不慢，删了吧。」执行 `DROP INDEX links_slug_unique` 会发生什么？真正删掉（先删约束）又会同时失去什么？
3. 换了一个 DATABASE_URL 后服务照常启动，但第一次创建短链就 500。为什么启动时没报错？第一步该核对什么？
4. 重启剧本为什么要「丢弃第一代、另起第二代」，而不是在同一个 app 实例里查两次？
5. EXPLAIN 输出里的 `cost=0.00..746.00`，746 是 746 毫秒吗？两个计划比较时该看什么？

<details>
<summary>展开参考答案</summary>

1. 该加——这是新的热查询模式，ORDER BY 加 LIMIT 走索引可以免排序。变贵的账：每行 INSERT 的写放大多一处（表 + slug 索引 + url 索引 + 新索引）；磁盘多一棵索引的空间（参考 url 索引约占半个表）。
2. 直接 DROP INDEX 会被数据库拒绝——它背后站着 UNIQUE 约束，报依赖错误。真想删得先 `ALTER TABLE links DROP CONSTRAINT`，但同时失去两样：挡重复 slug 的约束，与按 slug 定位的唯一索引——跳转端点立刻回到 Seq Scan，行数涨延迟线性涨。
3. postgres.js 懒连接：`createPgStore` 只创建池，第一条查询才真正建连——连接串错、网络不通、容器没起，都炸在第一次查询上（启动时只拦「生产环境缺 DATABASE_URL」）。第一步核对三件事：容器 status 是否 healthy、连接串主机端口库名是否对、本机能否连上 5544。
4. 同一实例查两次，测的是那个实例自己的存储路径（内存或池内连接），「重启」的语义没有发生。两代进程之间没有共享引用，数据若还能找到，只能因为住在进程外——这才是持久化的判定场。
5. 不是毫秒。cost 是规划器的记账单位（顺序读一页记 1.0，加上行处理的小项），绝对值无意义；比较两个计划的总 cost 才有意义——746 对 8.43 说的是「同一查询两条路线的相对代价」，行数变化时看它怎么涨。

</details>
