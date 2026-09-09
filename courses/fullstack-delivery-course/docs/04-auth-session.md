---
title: 登录是怎么发生的：密码、会话与 Cookie
---

# 登录是怎么发生的：密码、会话与 Cookie

## 工具箱

身份这一层动工前，要用到两块旧积木，先把接口摆出来。

- 无状态服务——判断数据该放哪的那把尺：「进程重启后它该不该还在」；该在的，就不能放进程内存（[第 1 章](./01-request-journey)）。
- 表与行——数据库组织数据的方式：表收同构记录、约束当运行时版编译器检查，schema 用 Drizzle 写成 TypeScript（[第 3 章](./03-persistence)）。

手边有这两条，身份就能落成两张新表加一列外键。

打开 DevTools 的 Network 面板，随便登录一个网站，然后刷新页面。几十个请求鱼贯而过，每个都带着同一小段 Cookie 头。把这些 Cookie 删掉再刷新——你被登出了。

「记住登录」这四个字，前端视角里通常长这样：登录接口回一个 token，存进 localStorage，之后每个请求手动塞进 Authorization 头。它能工作，教程也都这么写。可你多半也听人警告过：token 放 localStorage 是危险的。危险在哪，说得清所以然的人不多。

要回答它，得先回答一个更基本的问题：HTTP 根本不记得你是谁。协议里每个请求彼此独立——第一个请求和第十个请求之间，没有任何「这是同一个人」的标记。服务端进程眼里，每次都是陌生人进门。

那「记住登录」到底记在哪、谁在记、怎么防冒充？这一章把身份装进短链服务：注册、登录、登出、当前用户四个端点，一张用户表，一张会话表，一枚浏览器替你保管的 Cookie，一道挂在业务前面的守卫。装完之后，localStorage 那个 token 危险在哪，答案会自己浮出来。

## 原理：把「你是谁」变成数据库里查得到的一行

本章要立五个名字：密码哈希（加盐）、会话、httpOnly Cookie、路由守护、CSRF 与 SameSite。前三个把「你是谁」变成查得到、偷不走的一行；后两个管这行记录怎么被安全地使用。每个一小节，先讲为什么存在，再讲机制。

### 密码哈希（加盐）：按「数据库一定会泄露」设计

先替一个流行的直觉说句公道话：「密码加密存起来就行了」。这个直觉有来处：加密是开发者最熟悉的保护动作，HTTPS 全程都在加密；而且「加密」听起来天然等于「安全」。在「密钥永远不泄露」的世界里，它甚至确实成立。

边界出在密钥身上。加密是可逆的——有密钥就能还原明文；密钥又不能丢，丢了连自己都没法验证密码。于是密钥多半躺在同一台服务器的配置或环境变量里，而拖库的人通常连配置一起拖走：密文和钥匙一手交一手，等价于明文。

密码哈希（加盐）——注册时用慢哈希函数加一段随机盐，把密码变成不可逆的定长串存库；登录时用同样的盐重算一遍再比对。它和加密的分界只有一条：**哈希不可逆，加密可逆**。这条线画在哪，决定了拖库那天攻击者拿到的是废纸还是密码清单。

本课用 Node 自带的 scrypt，不引入新依赖。三个成本参数对齐 RFC 7914 的记法：N=16384（CPU 与内存总成本，Node 默认值）、r=8（块大小）、p=1（并行度）。内存占用约为 128×N×r 字节——算出来正好 16 MiB。这个「每次派生都要真金白银的内存」是 scrypt 的看家本领，后面算账要用。

盐是一段 16 字节的随机数，每次哈希重新生成。它废掉了攻击者最划算的一笔生意——「预计算一次、全库通吃」：没有盐时，相同密码算出相同串，攻击者可以离线把一亿条常用密码先算成一张对照表，拖库后直接查表；有了盐，每个用户的串都掺了不同的随机数，对照表按用户作废，只能一个一个重算。

现在算这笔拖库账（数量级口径，不是精确值）：

- 明文存储：直接读。更糟的是密码复用——这里的密码多半也是邮箱的密码。
- 可逆加密：连钥匙一起拖走，等价明文。
- 快哈希、无盐（比如直接存 SHA-256 结果）：现代 GPU 每秒能算数十亿次，一亿条常用密码的字典几分钟过完；无盐还让查表一次命中全部同密码用户。
- 慢哈希、加盐（本课方案）：每个候选都要占 16 MiB 内存重算，单机每秒千次量级，比快哈希慢约六个数量级；预计算作废，只能逐用户逐候选地磨。批量撞库从「分钟级」被拖到「按年计」。

一句诚实的收尾：慢哈希不保护单个弱密码——123456 仍排在字典前排，它会第一个被磨出来。它保护的是「批量」：让一整表密码不再是拖库者的一次性奖品。在入口处按频次设卡，是另一类手段——那块积木在下一站登场（[第 5 章](./05-cache-redis)）。

存库格式是一根字符串：`scrypt:<盐>:<派生键>`。登录比对时拆开它，用盐重算，再用 timingSafeEqual 做常数时间比较——比对耗时不随「对到第几位」变化。不加这层，理论上存在逐字节试探的计时通道；加了，通道焊死，代价为零。

### 会话：服务端记一行，客户端攥凭据

密码验证只完成第一次相认。「记住登录」需要的是：此后每个请求都能被认出是谁。HTTP 不带记忆，这份记忆只能有人造出来。

会话（session）——服务端为已登录用户保存的一条状态记录；客户端只拿一条不记名凭据：token。流程一句话：登录成功，服务端生成随机 token，把一行记录写进 sessions 表，token 原文发给浏览器；此后浏览器每个请求带上它，服务端查表还原「这是谁」。

为什么不能像存短链的那个内存 Map 一样，把在线用户记在进程内存里？拿工具箱里的尺量一下：进程重启后，用户的登录态该不该还在？该在——用户不该因为服务重启被集体登出。还有更要命的复制场景：服务横向扩成两份时，两个进程各记各的会话，在 A 实例登录的用户打到 B 实例就不认。会话表设在数据库里，正是无状态服务这把尺的直接推论。

sessions 表四列，两个设计决定值得单说：

- token_hash 做主键，存的是 token 的 SHA-256 指纹，不是原文。拖走这张表，也仿造不出合法 Cookie：伪造者得先找到一个原文，它的 SHA-256 恰好等于库里某行指纹——SHA-256 不可逆，这条路在计算上走不通。而真正的原文只存在于浏览器里。
- expires_at 记过期时刻（本课 7 天），读取时发现过期就顺手删行。会话不是终身制，死行不在表里攒着。

会话 token 的熵也有口径：OWASP 的会话管理清单要求至少 64 位随机性，本课用 randomBytes(32)——256 位；并且登录成功要发新 token，注册与登录各自新建会话，不复用旧的。

### httpOnly Cookie：浏览器替你保管，JS 读不到

token 发到浏览器之后住哪、怎么回来？两个候选：localStorage 或 Cookie。这个选择正好命中开篇的第二个问题。

先替直觉说句公道话：「token 放 localStorage 和放 Cookie 差不多」。来处很硬：两者都在浏览器里、都能随请求带上、教程两种写法都常见。在「页面永远干净」的世界里，它们确实差不多。

差别在「谁能读」。推一个反事实：页面被注入了一段脚本——一条没过滤的评论、一个被劫持的 CDN 文件——它正在你已登录的页面上执行。localStorage 是同源脚本随便读写的仓库，token 一行代码就能发去攻击者的服务器，之后他离线冒充你，你毫无感知。httpOnly Cookie 的表现是另一回事：**XSS 偷得走 localStorage 里的 token，偷不走 httpOnly Cookie 里的 sid**。这个属性告诉浏览器「此 Cookie 不暴露给 document.cookie」，页面上任何脚本都读不到它。

诚实的边界也要说：httpOnly 不挡「脚本借你的浏览器发请求」。脚本仍可以在页面里以你的身份调 API——浏览器照样自动带上 Cookie。它挡的是「把凭据偷走、拿到别处另用」：前一半归 XSS 防线（输入过滤、CSP）管，后一半归 httpOnly 管。两件事，两道锁。

下发 Cookie 的原文长这样（注册端点的真实响应头）：

```text
set-cookie: sid=2oONGaBDGG4wThjajcXk6IeZwV6t3boLCVLj2sdzX_0; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax
```

逐个属性过一遍：sid 是名字；Max-Age=604800 是寿命，7 天，与 sessions.expires_at 同步；Path=/ 让全站路径都带；HttpOnly 锁读取；SameSite=Lax 管发送，下一节主角。生产部署走 HTTPS 后必须再补 Secure（浏览器只在 https 上接受并回传带它的 Cookie）；本课 dev 跑在本地 http 上，不加——加了浏览器直接拒收，登录永远失败。

带回来的机制不用你写一行代码：同源请求浏览器自动带 Cookie，fetch 的默认 credentials 就是 same-origin。开发期 Vite 代理把 /api 转发给 4510，浏览器眼里全程同源，Cookie 自动跟走。真要跨源直连，三件事缺一不可。前端 fetch 要声明 credentials: 'include'；后端要回 Access-Control-Allow-Credentials: true；Allow-Origin 还得写明确源——带凭据时通配符 * 无效。本课生产走同域统一入口（[第 9 章](./09-deploy-https)），不开这个口子。

### 路由守护：身份检查不能散装

有了会话与 Cookie，受保护的端点怎么检查身份？最朴素的写法是在每个端点开头手抄一遍「读 Cookie、查表、不认识回 401」。三个端点抄三遍还扛得住；三十个端点就是三十处可能漏抄的地方，漏一处，越权就从那里进来。

路由守护（route guard）——在业务逻辑之前统一执行的身份检查层。它是一个中间件：从 Cookie 读 sid、查会话、把当前用户挂进上下文变量 currentUser；任何一步失败直接回 401，根本走不到业务代码。挂在守卫之后的路由，都可以假定「用户已验明」。

POST /api/links 的挂载次序是本章最重要的设计取舍：

```text
请求校验(422) → 会话检查(401) → 业务(201)
```

常见做法是身份在前：未登录者连 422 都不配看到。本课选校验在前，两个理由。其一，zod 校验是无状态纯检查——不查库、开销固定，先挡掉畸形请求最便宜。其二，「缺 url → 422」这条契约对任何调用方成立：你用 curl 调试字段错误时，不必先注册登录一轮。代价是匿名者能探到校验细节，而字段清单本来就是公开契约，无密可泄。**校验先于身份：422 挡在 401 之前**。这个取舍写进了测试——匿名 POST 一个空 body，拿到的依然是 422。

### CSRF 与 SameSite：自动带 Cookie 是把双刃剑

第三个直觉也先听公道话：「登录了就安全了，改状态的接口不用再防跨站」。来处是上一站的印象：浏览器拦跨源、后端有校验，看起来层层设防。而且登录确实堵住了一半——匿名脚本刷创建端点，现在只能收到 401。

漏掉的另一半，正是「自动带 Cookie」这个特性本身。浏览器带 Cookie 不分页面：你登着短链服务，另一个标签页打开 evil.com，它放一个自动提交的表单：

```html
<!-- 用法示例（evil.com 的陷阱页——教学示意，别真的做） -->
<form action="https://your-host/api/links" method="post">
  <input type="hidden" name="url" value="https://evil.com/i-was-here" />
</form>
<script>document.forms[0].submit()</script>
```

浏览器替这个跨站 POST 带上了你的 sid，请求以你的身份发出。CORS 管这事吗？不管——CORS 管的是页面脚本能不能「读」跨源响应；这个请求根本不需要读响应，副作用已经发生。分工一句话：CORS 管读，SameSite 管发。

CSRF 与 SameSite 由此成对出现——CSRF（跨站请求伪造）指恶意网站借浏览器自动带 Cookie 的特性，诱导它向你的服务发请求；SameSite 是 Cookie 的属性，Lax 档让 Cookie 只随同站请求与顶层导航携带：跨站的 fetch、XHR、表单 POST 一律不带。evil.com 的表单打过去，sid 根本没上车，守卫回 401，攻击落空。

还有两件配套纪律：会话 Cookie 一律加 SameSite=Lax，改状态的操作再从严；写操作不用 GET——Lax 下顶层导航的 GET 会带 Cookie，而恶意站点可以用一条诱导链接、一段 `window.location` 脚本把用户的顶层导航「送」到你的 GET 端点。logout 设计成 POST，正是这条纪律的落点。

### 三张表怎么咬合

把三张表和两块旧积木拼起来看：users 是身份本体；sessions.user_id 和 links.user_id 两根外键都指向 users.id——一根管「这场会话是谁」，一根管「这条短链归谁」。外键是表与行这一层给的黏合剂：数据库保证挂在 user_id 上的行一定对应真实用户，删用户时也不会留下悬空的归属。

登录时查 users 验密码、写 sessions、发 Cookie；此后每个受保护请求用 Cookie 查 sessions 还原用户；创建短链时把这个 user.id 写进 links.user_id。短链服务一直没有「谁」的概念、任何人都能建链——这个边界到此收口：POST /api/links 从「谁来都 201」变成「未登录 401、登录者 201 且归属可查」。

## 演练：从红到绿，把身份装进去

先看清动刀范围。

**不动**：GET /:slug 与 GET /healthz——跳转和存活检查是公开能力；packages/shared 既有的三个 schema；test/index-experiment.test.ts——索引实验与身份无关。

**动**：POST /api/links 拆成三段并要求登录；store 的 put 加 ownerId 参数写归属；端点 e2e 与重启剧本两批旧测试（第 2、3 章落下的）改经 createAuthedApp 创建——断言强度不降，201/422/302/404 的形状全部保留，只是创建前多一步登录；apps/web 加登录表单。

**新增**：迁移两份（0002 建 users 与 sessions、0003 给 links 补归属列）；src/auth/ 三件（password.ts、session.ts、guard.ts）；test/auth.test.ts；test/helpers.ts 增 createAuthedApp。

安全边界先说定：本章所有「攻击视角」的推演与破坏实验，都只在你自己的教学环境里做。对未经授权的系统做扫描或攻击性验证，从技术判断到法律结论都是另一回事。

### 第一步：shared 契约先立

身份的请求体也是契约，加在 shared 里：

```ts
// companion: packages/shared/src/index.ts · 身份契约——注册、登录与用户响应
/** 注册请求体：合法邮箱 + 至少 8 位密码 */
export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})

/** 登录请求体：形状与注册一致（分两个导出，将来两端可独立演进） */
export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})

/** 注册/登录成功与 me 的响应：一个已登录用户的公开形状 */
export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
})

export type CreateLinkInput = z.infer<typeof createLinkSchema>
export type LinkResponse = z.infer<typeof linkResponseSchema>
export type ValidationError = z.infer<typeof validationErrorSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type UserResponse = z.infer<typeof userResponseSchema>
```

schema.test.ts 补四条断言：合法输入通过；缺 email 拒绝且定位到 email；密码不足 8 位拒绝且定位到 password；非法邮箱拒绝。跑 `pnpm --filter @shortlink/shared test`：12 条全绿（旧 8 条加新 4 条）。

### 第二步：先红——十六刀砍在缺失的能力上

新测试文件 test/auth.test.ts 分三组：password 纯函数单测四条；裸服务（不带任何 Cookie）的守卫断言两条；注册、登录、登出、me 与归属的 e2e 十条。此刻实现还不存在，先跑它：

```text
Error: Cannot find module '../src/auth/password' imported from test/auth.test.ts
```

红因单一：能力不存在——连模块都还没有，不是语法错、不是路径拼错。

等 password.ts、session.ts、guard.ts 落盘、端点还没接线时，再跑一次，红得更具体：

```text
× 未登录创建（合法 body）→ 401
AssertionError: expected 201 to be 401 // Object.is equality
Error: 注册测试账号失败：expected 201, got 404
Tests  1 failed | 5 passed | 10 skipped (16)
```

读懂这份红：守卫未接线，匿名创建畅通无阻地 201；端点未注册，注册请求撞上 404。而「未登录且 body 缺 url → 422」那条一直绿——校验先于身份的设计，在守卫缺席时也成立。它守的是门口的形状检查，本来就不问来客是谁。

### 第三步：两张新表与一列归属

```ts
// companion: apps/api/src/db/schema.ts · users 与 sessions——身份在数据库里的形状
export const users = pgTable('users', {
  // 主键：数据库自己生成的随机 uuid
  id: uuid('id').primaryKey().defaultRandom(),
  // 登录邮箱：唯一。注册重复时数据库用唯一约束当场拒绝（端点回 409）
  email: text('email').notNull().unique(),
  // 密码的慢哈希串（scrypt + 随机盐，见 src/auth/password.ts）——绝不存明文
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  // 主键：会话 token 的 SHA-256 指纹。原文只发给浏览器，库里不存原文
  tokenHash: text('token_hash').primaryKey(),
  // 这场会话属于谁：外键指向 users.id
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // 过期时刻：读取时比对，过期即删行
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})
```

links 表同文件追加归属列：`userId: uuid('user_id').references(() => users.id)`。生成迁移，分两次而不是一次——「建身份表」和「补归属列」在迁移史上是两个可独立回放的步骤。

```text
$ pnpm --filter @shortlink/api db:generate --name auth_users_sessions
$ pnpm --filter @shortlink/api db:generate --name links_owner
```

```sql
-- companion: apps/api/drizzle/0002_auth_users_sessions.sql（sessions 表部分）
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
```

```sql
-- companion: apps/api/drizzle/0002_auth_users_sessions.sql（users 表与外键部分）
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
```

```sql
-- companion: apps/api/drizzle/0003_links_owner.sql
ALTER TABLE "links" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
```

0003 里 user_id 可空，是给存量数据的交代：登录接入之前创建的短链没有主人，可空让加列不破坏旧行。历史短链归谁，是运营决策，数据库替你推断不了。

### 第四步：password.ts——慢哈希与常数时间比对

```ts
// companion: apps/api/src/auth/password.ts · 密码的加盐慢哈希与常数时间比对
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

/** 派生键长度（字节）：64 字节 = 512 位，存成 hex 后 128 字符 */
const KEY_LENGTH = 64

/**
 * 把密码变成不可逆的存储串：`scrypt:<盐>:<派生键>`。
 * 盐是 16 字节随机数，每次哈希都重新生成——同一个密码两次入库，串也不一样。
 * scrypt 默认成本参数 N=16384、r=8、p=1（内存难度 16 MiB 量级，含义对齐 RFC 7914）。
 */
export async function hashPassword(
  password: string,
  salt: string = randomBytes(16).toString('hex'),
): Promise<string> {
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer
  return `scrypt:${salt}:${derived.toString('hex')}`
}

/**
 * 登录侧比对：用存串里的盐重算一遍，再与存串里的派生键做常数时间比较。
 * timingSafeEqual 逐字节比对、耗时与相同位置无关，不泄漏「对到第几位才错」。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split(':')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer
  const expected = Buffer.from(hash, 'hex')
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}
```

两个细节承重。其一，hashPassword 的盐参数带默认值——正常调用不传，测试可以注入固定盐。其二，timingSafeEqual 要求两串等长，先比长度再比内容，格式不对直接 false，不给坏存串炸 500 的机会。

### 第五步：session.ts——会话与账户的读写

身份这一侧的存储缝与 LinkStore 同构：端点只认方法，底下是 PostgreSQL。

```ts
// companion: apps/api/src/auth/session.ts · 常量、类型与指纹函数（节选）
/** 会话 Cookie 的名字：浏览器每次同源请求都会自动带上它 */
export const SESSION_COOKIE = 'sid'
/** 会话寿命：7 天（毫秒用于 expires_at，秒用于 Max-Age） */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

/** 已登录用户的最小形状：守卫通过后挂进上下文的 currentUser */
export interface SessionUser {
  id: string
  email: string
}

export type RegisterResult = { status: 'created'; user: SessionUser } | { status: 'conflict' }

/**
 * 身份这一侧的存储缝：注册、验密、建会话、查会话、删会话。
 * 与 LinkStore 同构——端点只认这五个方法，底下是 PostgreSQL（无状态服务的判据：
 * 会话重启后该不该还在？该在，所以它住在表里，不住在进程内存里）。
 */
export interface AuthStore {
  register(email: string, password: string): Promise<RegisterResult>
  verify(email: string, password: string): Promise<SessionUser | undefined>
  createSession(userId: string): Promise<{ token: string; expiresAt: Date }>
  getSession(token: string): Promise<SessionUser | undefined>
  deleteSession(token: string): Promise<void>
  end(): Promise<void>
}

/** token 原文 → SHA-256 指纹：库里只存指纹，拖库也仿造不出合法 Cookie */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
```

工厂函数里五个方法的实现，一处一处看：

```ts
// companion: apps/api/src/auth/session.ts · createAuthStore 返回的五个方法（节选）
    async register(email, password) {
      const passwordHash = await hashPassword(password)
      try {
        const rows = await db
          .insert(users)
          .values({ email, passwordHash })
          .returning({ id: users.id, email: users.email })
        return { status: 'created', user: rows[0] }
      } catch (err) {
        // 23505 = unique_violation：邮箱已被注册，数据库替我们把关。
        // drizzle 会把驱动错误包在 cause 里，两级都要看
        const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
        if (code === '23505') {
          return { status: 'conflict' }
        }
        throw err
      }
    },

    async verify(email, password) {
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
      const row = rows[0]
      if (!row) return undefined
      const ok = await verifyPassword(password, row.passwordHash)
      return ok ? { id: row.id, email: row.email } : undefined
    },

    async createSession(userId) {
      const token = randomBytes(32).toString('base64url')
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
      await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt })
      return { token, expiresAt }
    },

    async getSession(token) {
      const tokenHash = hashToken(token)
      const rows = await db
        .select({ id: users.id, email: users.email, expiresAt: sessions.expiresAt })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1)
      const row = rows[0]
      if (!row) return undefined
      // 过期即作废：顺手删行，会话表不会攒下死行
      if (row.expiresAt.getTime() <= Date.now()) {
        await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
        return undefined
      }
      const { id, email } = row
      return { id, email }
    },

    async deleteSession(token) {
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
    },
```

register 里重复邮箱靠数据库的唯一约束把关——先查再插会留竞态缝隙，约束永远在。getSession 用 innerJoin 一次拿回「会话 + 它的主人」，过期行当场清理。Cookie 的下发与清除也在这个文件：

```ts
// companion: apps/api/src/auth/session.ts · Cookie 的下发与清除（节选）
/**
 * 下发会话 Cookie：sid=<token>; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax。
 * dev 跑在本地 http 上，不加 Secure；生产走 HTTPS 后必须补上（浏览器只在 https 上接受它）。
 */
export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    httpOnly: true,
    sameSite: 'Lax',
  })
}

/** 登出时清 Cookie：同名空值 + Max-Age=0，浏览器立刻丢掉它 */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}
```

### 第六步：guard.ts 与 app.ts 接线

```ts
// companion: apps/api/src/auth/guard.ts · authGuard——业务逻辑之前的身份检查层
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { SESSION_COOKIE, type AuthStore, type SessionUser } from './session'

/** 挂在 Hono 上下文上的类型：守卫通过后，后续 handler 都能读到 currentUser */
export type AuthEnv = {
  Variables: {
    currentUser: SessionUser
  }
}

/**
 * 从 Cookie 里读 sid → 查会话 → 把用户挂进上下文；任何一步失败回 401。
 * 它是中间件：可以整段挂在路由参数里（POST /api/links 的三段式就是这么排的）。
 */
export function createAuthGuard(auth: AuthStore): MiddlewareHandler<AuthEnv> {
  return async function authGuard(c, next) {
    const token = getCookie(c, SESSION_COOKIE)
    const user = token ? await auth.getSession(token) : undefined
    if (!user) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    c.set('currentUser', user)
    await next()
  }
}
```

app.ts 现在收两份注入，createApp 的签名多一个参数：

```ts
// companion: apps/api/src/app.ts · createApp 的签名与上下文类型（节选）
// （本章形态：两份注入；缓存章起签名加第三个可选参数 opts——缓存与限流住那里，终态见第 5 章演练）
type AppEnv = AuthEnv & {
  Variables: AuthEnv['Variables'] & {
    linkInput: CreateLinkInput
  }
}

export function createApp(
  store: LinkStore = createMemoryStore(),
  auth: AuthStore = createAuthStore(requireDatabaseUrl()),
) {
  const app = new Hono<AppEnv>()
  const authGuard = createAuthGuard(auth)
```

身份四端点里挑承重的两段看。注册是「建用户即登录」——201、冲突 409、成功当场发会话：

```ts
// companion: apps/api/src/app.ts · 注册与登录端点（节选）
  app.post('/api/auth/register', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path.join('.') || 'body'
      return c.json(
        { error: { field, message: issue?.message ?? '请求体不合法' } },
        422,
      )
    }
    const result = await auth.register(parsed.data.email, parsed.data.password)
    if (result.status === 'conflict') {
      return c.json({ error: { field: 'email', message: '该邮箱已注册' } }, 409)
    }
    // 建用户即登录：注册成功当场发一场会话
    const session = await auth.createSession(result.user.id)
    setSessionCookie(c, session.token)
    return c.json(result.user, 201)
  })

  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path.join('.') || 'body'
      return c.json(
        { error: { field, message: issue?.message ?? '请求体不合法' } },
        422,
      )
    }
    const user = await auth.verify(parsed.data.email, parsed.data.password)
    if (!user) {
      // 邮箱不存在与密码错误回同一句话：不给「这个邮箱 registered 没」的免费探测
      return c.json({ error: { field: 'credentials', message: '邮箱或密码不正确' } }, 401)
    }
    const session = await auth.createSession(user.id)
    setSessionCookie(c, session.token)
    return c.json(user, 200)
  })
```

logout、me 与改造后的 POST /api/links 在同一文件里鱼贯而下。三段式是本章组装式的落点——看路由注册那一行的参数顺序：

```ts
// companion: apps/api/src/app.ts · 登出、me 与三段式的创建端点（节选）
// （本章形态：创建端点是三段式；缓存章起在守卫前多插一道限流闸，终态见第 5 章演练）
  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) {
      await auth.deleteSession(token)
    }
    clearSessionCookie(c)
    return c.body(null, 204)
  })

  app.get('/api/auth/me', authGuard, (c) => {
    return c.json(c.get('currentUser'))
  })

  // ---- 短链端点 ----

  /** 第一段：请求校验。无状态的纯检查先挡畸形请求——422 在身份之前 */
  const validateLinkBody: MiddlewareHandler<AppEnv> = async (c, next) => {
    const body = await c.req.json().catch(() => null)
    const parsed = createLinkSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path.join('.') || 'body'
      return c.json(
        { error: { field, message: issue?.message ?? '请求体不合法' } },
        422,
      )
    }
    c.set('linkInput', parsed.data)
    await next()
  }

  // 三段式按参数顺序执行：校验(422) → 守卫(401) → 业务(201)
  app.post('/api/links', validateLinkBody, authGuard, async (c) => {
    const { url } = c.get('linkInput')
    const user = c.get('currentUser')
    const link: LinkResponse = {
      slug: nanoid(7),
      url,
      createdAt: new Date().toISOString(),
    }
    // 归属：这条短链记在当前用户的 user_id 名下
    await store.put(link, user.id)
    return c.json(link, 201)
  })
```

me 是守卫的中间件形态最干净的展示：路由参数里挂上 authGuard，业务函数只剩一行。创建端点把校验也提成了中间件 validateLinkBody——参数顺序就是执行顺序，取舍写在代码形状里。store 那一侧，LinkStore.put 与 PgStore.put 都加了 ownerId 参数，写入时落进 user_id 列；启动入口 main.ts 相应多注入一份 auth（companion 里原样可查）。

### 第七步：旧测试回写——createAuthedApp

端点行为变了：匿名创建从 201 变成 401。旧章测试必须跟着改（第 2、3 章的 e2e 与重启剧本），这是终态一致性——书里引用的代码与伴生仓的实际形态不能互相说谎。改法不是放松断言：201/422/302/404 的形状断言原样保留，只是创建前多一步「注册并拿 Cookie」。帮手放在 test/helpers.ts：

```ts
// companion: apps/api/test/helpers.ts · createAuthedApp——已登录测试应用的工厂
/** 一个「已登录的应用」：真实 HTTP 服务 + 一个注册好的账号 + 它的会话 Cookie */
export interface AuthedApp {
  base: string
  cookie: string
  postLink(body: unknown): Promise<Response>
  shutdown(): Promise<void>
}

/**
 * 起一个真实服务并用随机邮箱注册一个账号：
 * 返回它的 Cookie 串（形如 "sid=..."）与带 Cookie 的 postLink。
 * 第 4 章起创建短链需要登录——旧章测试都从这里拿「已登录的手」。
 */
export async function createAuthedApp(store?: LinkStore): Promise<AuthedApp> {
  const linkStore = store ?? createPgStore(databaseUrl)
  const auth = createAuthStore(databaseUrl)
  const server = serve({ fetch: createApp(linkStore, auth).fetch, port: 0 })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await auth.end()
    throw new Error('expected the test server to listen on an ephemeral port')
  }
  const base = `http://127.0.0.1:${address.port}`

  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const register = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-123' }),
  })
  if (register.status !== 201) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await auth.end()
    throw new Error(`注册测试账号失败：expected 201, got ${register.status}`)
  }
  const setCookie = register.headers.get('set-cookie') ?? ''
  const cookie = setCookie.split(';')[0]?.trim() ?? ''

  return {
    base,
    cookie,
    postLink: (body: unknown) =>
      fetch(`${base}/api/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      }),
    shutdown: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      const maybeEnd = (linkStore as { end?: () => Promise<void> }).end
      if (maybeEnd) await maybeEnd()
      await auth.end()
    },
  }
}
```

端点 e2e 的改写一眼看尽：

```ts
// companion: apps/api/src/app.test.ts · 经 createAuthedApp 起服务（节选）
const app = await createAuthedApp()
const base = app.base

afterAll(async () => {
  await app.shutdown()
})

// res.json() 的类型是 unknown，测试里按需收窄成宽松的 JSON 形状
const json = (res: Response) => res.json() as Promise<Record<string, any>>

describe('GET /healthz', () => {
  it('返回 200 与 {status:"ok"}', async () => {
    const res = await fetch(`${base}/healthz`)
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ status: 'ok' })
  })
})

describe('POST /api/links', () => {
  // 不带 Cookie 的裸 POST：校验是无状态纯检查，先于身份——缺 url 依然 422
  const postLink = (body: unknown) =>
    fetch(`${base}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('登录后合法请求返回 201，body 含 slug/url/createdAt', async () => {
    const res = await app.postLink({ url: 'https://example.com/very-long-path' })
    expect(res.status).toBe(201)
```

201 那条经 app.postLink（带 Cookie）发送；两条 422 断言保持匿名——它们测的就是「校验先于身份」。重启剧本 persistence.test.ts 的两代进程也改经 createAuthedApp 起，断言一字未动：302 与 404 照旧，变的只是谁按下了创建键。

### 第八步：web——登录表单与自动跟走的 Cookie

前端的调用层补四个函数（companion 的 apps/web/src/api.ts 原样可查），核心是同源请求的姿势。

```ts
// companion: apps/web/src/api.ts · 同源请求与创建的 401 分支（节选）
/**
 * 同源 fetch：页面与 /api 之间隔着 Vite 代理，浏览器视为同一个源，
 * Cookie 默认随请求自动带上（credentials 的默认值就是 same-origin）。
 */
async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function createLink(url: string): Promise<LinkResponse> {
  const res = await postJson('/api/links', { url })
  if (res.status === 422) {
    const body = validationErrorSchema.parse(await res.json())
    throw new Error(`${body.error.field}：${body.error.message}`)
  }
  if (res.status === 401) {
    throw new Error('请先登录：创建短链需要一个已登录的会话')
  }
  if (!res.ok) {
    throw new Error(`创建失败（HTTP ${res.status}）`)
  }
  return linkResponseSchema.parse(await res.json())
}
```

注意前端没有一行「带上 Cookie」的代码——同源 fetch 默认就带，这是原理节说的默认 credentials 在替你工作。页面组件加一栏登录表单：未登录时显示邮箱、密码两个输入框与登录、注册两个按钮；登录后显示「已登录」与登出；未登录就点创建，页面会显示后端那句「请先登录」。组件全文在 companion 的 apps/web/src/App.vue。

### 门槛

在 companion 目录里按序执行（pg 必须在跑）：

```text
$ node scripts/compose-infra.mjs up
教学 Postgres 已就绪：postgres://postgres:postgres@localhost:5544/shortlink
$ pnpm test
packages/shared  Tests  12 passed (12)
apps/api         Tests  27 passed (27)
$ pnpm typecheck
packages/shared typecheck: Done
apps/api typecheck: Done
apps/web typecheck: Done
```

退出码 0，39 条全绿。api 的 27 条里：六条端点 e2e（经登录重写，形状断言未动）、两条重启剧本、三条索引实验（一行未改照绿——索引不关心来客是谁）、16 条本章新增。（本章形态的门槛输出；下一章起 up 还会拉起教学 Redis、测试再添新的一组。）

## 验证：让身份说话

dev 服务起着（pnpm dev）。每一步先把预测写下来，再执行对照。

### 一、先猜后跑：未登录创建，三选一

```bash
curl -i -X POST http://localhost:4510/api/links -H "content-type: application/json" -d '{"url":"https://example.com/guess-me"}'
```

先猜：201、401、422 三选一，写下再跑。应看到：

```text
HTTP/1.1 401 Unauthorized

{"error":"unauthorized"}
```

再发一个缺 url 的：

```bash
curl -i -X POST http://localhost:4510/api/links -H "content-type: application/json" -d '{}'
```

先猜：这次是 401 还是 422？执行后是 422，error.field 是 url。两次对照，就是本章最重要的取舍在说话：校验是无状态纯检查，先挡畸形请求；身份在它之后登场。如果你两次都猜对，说明挂载次序的设计已经内化。

### 二、定向破坏：摘掉 HttpOnly 这把锁

指认一处精确改动：apps/api/src/auth/session.ts 的 setSessionCookie 里，删掉 `httpOnly: true,` 这一行。重启 dev，在 5174 页面注册登录，然后 DevTools Console 里执行：

```js
// 用法示例
document.cookie
```

先写预测再回车：应看到 sid= 开头的一长串——锁摘掉后，页面脚本读得到它了。服务端侧用 curl 对照，注册一个新账号看响应头，Set-Cookie 原文里 HttpOnly 三个字消失：

```text
set-cookie: sid=xxxx; Max-Age=604800; Path=/; SameSite=Lax
```

改回 `httpOnly: true,`，重启，再读 document.cookie——应为空。跑 `pnpm --filter @shortlink/api exec vitest run test/auth.test.ts`，此刻应看到恰好 1 条红：断言 Set-Cookie 原文含 HttpOnly 的那条（expected … to contain 'HttpOnly'）；改回后全绿。哪条没红？SameSite 相关的行为照旧——它管「跨站请求发不发 Cookie」，与「页面脚本读不读得到」无关。两把锁各守各的门，摘掉哪把，哪扇窗开。

### 三、登出之后再建：先猜 401 还是 201

用 curl 的 cookie jar（-c 存、-b 用）把「登录—创建—登出—再创建」连成一出：

```bash
curl -i -c jar.txt -X POST http://localhost:4510/api/auth/register -H "content-type: application/json" -d '{"email":"you@example.com","password":"try-logout-1"}'
curl -i -b jar.txt -X POST http://localhost:4510/api/links -H "content-type: application/json" -d '{"url":"https://example.com/before"}'
curl -i -b jar.txt -X POST http://localhost:4510/api/auth/logout
curl -i -b jar.txt -X POST http://localhost:4510/api/links -H "content-type: application/json" -d '{"url":"https://example.com/after"}'
```

四步先猜再跑，应依次看到：201（Set-Cookie 进 jar）、201、204、401。第四步值得多看一眼：Cookie 还躺在 jar 里，浏览器侧毫无变化——但服务端那行会话记录已被删掉，查表无人认领。凭据作废不靠客户端自觉，靠服务端销毁记录，这就是会话权威在服务端的含义。

### 四、把结果讲给自己听

三个实验各对上一块积木：实验一对路由守护的挂载次序；实验二对 httpOnly 的读取边界；实验三对会话的服务端权威。哪一步的现象与此不符，回到对应小节重推一遍。

## 收束：HTTP 不记得你，但你们记得彼此

开篇说，HTTP 眼里每个请求都是陌生人。现在再刷新一次页面：me 端点用 Cookie 里的 sid 查 sessions 表，认出了你；你创建的短链写进了自己名下；点登出的那一刻，服务端删行、浏览器清 Cookie，两边的记忆同时归零。「记住登录」不在协议里，也不在进程内存里——一张表、一枚加了锁的 Cookie、一道挂对位置的守卫，三样合起来，陌生人协议之上长出了熟客。localStorage 那个 token 危险在哪，现在你能从机制讲到后果：它给页面里每一段脚本都留了读走你身份的门。

带走五块积木：

- 密码哈希（加盐）——慢哈希加随机盐存不可逆串，拖库也撞不动批量字典；
- 会话——服务端表里一行、客户端手里一枚 token，查表还原身份；
- httpOnly Cookie——浏览器保管、自动回传、页面脚本读不到的凭据载体；
- 路由守护——业务之前统一执行的中间件，通过后上下文里有 currentUser；
- CSRF 与 SameSite——跨站请求伪造的成因与 Lax 档的挡法，与 CORS 一读一发互补。

下一站把读路径上的数据库搬开（[第 5 章](./05-cache-redis)）；「谁在何时登录」的排查，后面作为日志关联场景接走（[第 10 章](./10-ops-observability)）。

自查一遍（先答再看）：

1. 产品要「30 天免登录」。要动哪几个数字？哪两处必须同步改、单位差多少倍？
2. 攻击者拖走了 sessions 表全部行，但没拿到写库权限。他能伪造一个合法登录吗？推导链是什么？
3. 把 validateLinkBody 与 authGuard 的挂载顺序对调，跑 pnpm test：几条红、各 expected 什么？哪条「该绿的照绿」？
4. 页面被注入脚本并在你登录状态下执行。httpOnly 挡住了什么、没挡住什么？没挡住的那半该靠什么防？
5. logout 为什么设计成 POST？改成 GET 会在哪种攻击下变脆？

<details>
<summary>展开参考答案</summary>

1. 要动两处数字：session.ts 的 SESSION_TTL_MS（毫秒）与 setSessionCookie 用的 SESSION_TTL_SECONDS（秒）。数值上，7 天改 30 天、604800 改成 2592000；sessions 新行的 expires_at 由前者推出。单位差 1000 倍——只改一处，就会出现「Cookie 还活着、会话已过期」（或反过来）的错位登录态。
2. 不能。合法登录需要服务端在 sessions 里查到「自己造的 token 指纹」，而查表入口拿着的必须是 token 原文；手上只有指纹时，反推原文撞的是 SHA-256 的不可逆性，计算上不可行。真正的原文只存在于每个用户的浏览器里。
3. 恰好 3 条红：app.test.ts 的两条匿名 422 断言，加上 auth.test.ts 的「未登录且 body 缺 url → 422」。对调后守卫先执行，三条都是 expected 401 to be 422。「未登录创建（合法 body）→ 401」照绿：它只关心无会话时的 401，与两段的先后无关；带 Cookie 的 201 也照绿。
4. 挡住：脚本读走凭据、拿到别处冒充的路径——document.cookie 里没有 sid。没挡住：脚本就在你页面上以你的身份发请求（浏览器照样自动带 Cookie）。那半要靠 XSS 防线：输入过滤与输出转义、CSP 限制脚本来源。
5. SameSite=Lax 下，顶层导航的 GET 会带 Cookie。GET 版 logout 可以被另一个站点「替你」触发：一条诱导链接、或恶意页面里的 `window.location` 跳转，都算顶层导航——轻则骚扰式登出，重则配合别的状态变更做定向攻击。POST 在 Lax 下跨站不带 Cookie，天然挡住这扇门。

</details>
