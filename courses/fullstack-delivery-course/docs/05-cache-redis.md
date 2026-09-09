---
title: 把数据库从热路径上搬开：Redis 与缓存
---

# 把数据库从热路径上搬开：Redis 与缓存

## 工具箱

先领工具：两块旧积木，一把当尺，一根当管道。

- 无状态服务——判断数据该放哪的那把尺：「进程重启后它该不该还在」；该在的，就不能放进程内存（[第 1 章](./01-request-journey)）。
- 连接池——预先建好并复用的一组连接：postgres.js 里一个 sql`` 实例就是池，进程启动建池、全程复用、退出时关（[第 3 章](./03-persistence)）。本章 Redis 客户端走同一条纪律。

动工之前，先算一笔账。

跳转端点是整个服务最热的路径——热路径的意思是：别的端点按需调用，它按点击计数。每个访客、每次点击、每条转发出去的分享，最后都落到同一条查询上：按 slug 取一行。走了索引、走了连接池，这条查询已经不慢；但「不慢」乘以「每次都要查一次库」，是另一回事。

数量级口径（不是精确值，随机器与网络浮动）：同一台机器上，应用进程经 Redis 做一次内存级读（含本地往返）在 0.1ms 这一档；一次走索引的数据库查询，算上应用进程与数据库之间的往返，通常落在 1ms 到 10ms 这一档。取上限对比：0.1ms 对 10ms，差两个数量级。折成体感：每秒 100 次点击时，10ms 的查库把数据库的时间整秒吃满（100 × 10ms = 1s）；换成 0.1ms 的缓存读，只占其中的 10ms——一秒里的 99% 还给了别人。

更要紧的是重复。同一条热门短链一分钟里吃下 500 次点击，意味着数据库把同一行完整读了 500 遍，而第一遍与第 500 遍之间，结果没有任何差别。延迟账的两边就此摆开：一边是「每次都查一次库」的贵且重复，一边是「放内存」的便宜但易丢。

这一章在两边之间架一条旁路：读先问内存，内存没有再问数据库；顺带给写路径装一道闸，让脚本刷不动创建端点。新鲜度怎么买、乱打的流量怎么挡、闸装在哪一环——读完这章，这三问各有落点。

## 原理：读路径的旁路，写路径的闸

本章立五个名字：缓存、TTL、缓存穿透、限流、Redis。前两个把热数据的读搬进内存，第三个讲旁路自己的破绽，第四个管写路径的配额，最后一个提供前面四件事的载体。每个一小节，先讲为什么存在，再讲机制。

### 缓存：把重复的读搬进内存

先替一个流行的直觉说句公道话：「缓存就是更快的数据库，加上就能提速，架构不用动」。这个直觉有来处：缓存的接口确实像数据库——给键、还值；而且很多教程演示缓存，就是「加一层、变快了」的前后对比图。在「只加不改」的世界里，它看起来确实是件小事。

边界出在缓存改变的是读路径的结构，而不是存储的速度。缓存（cache）——把昂贵计算或查询的结果，放进一层更快的小存储，下次同样的读直接取这层副本。它是旁路，不是新家：数据库仍然是唯一记全账的地方，缓存里只有「最近有人读过」的那部分副本。副本一旦加入，三件新问题随之进门：副本可能过时（下一节的 TTL）、不存在的键能把副本打穿（再下一节）、副本所在的那层可能整体消失（最后一节的 Redis 定位）。说「只加不改」的人，是把这三笔账都记到了未来。

读侧的标准装法叫 cache-aside（旁路缓存）：应用自己去维护缓存与数据库的一致，读的次序固定为四步。逐步做反事实，看跳过哪步坏什么：

1. 先查缓存。跳过它，每次读都直奔数据库——缓存形同虚设，白付一份内存。
2. 命中缓存就直接返回。跳过「直接返回」改去查库，等于每次读都付了双份延迟，比不装缓存还慢。
3. 未命中时查数据库。这一步是正确性的兜底：缓存里没有的，只有数据库说了算。它不能跳，也正因如此——数据库永远不用改。
4. 查到结果后回填缓存，再返回。跳过回填，缓存里永远只有冷启动时那几条，命中率趋近于零，旁路等于没铺。

四步合起来一句话：**缓存是读路径的旁路，数据库仍是唯一真相**。旁路上一切可丢，丢了就按这四步重新铺。

### TTL：花一点新鲜度，买两个数量级

副本过时怎么办？先替直觉说句公道话：「TTL 只是防过期的小参数，设个大数就行」。来处很自然：参数名就叫「存活时间」，看起来跟防火墙的超时一样，属于配置清单的末尾。在「数据从不变化」的服务里，设大设小确实看不出差别。

边界出在 TTL 真正买的东西上。TTL（time to live，存活时间）——缓存条目的寿命，到期自动删除。它不是防过期的卫生参数，而是在付一笔一致性账：TTL 定义了副本与真相之间最长的失同步窗口。数据库里的行在第 0 秒有人改动，缓存里的副本最多再活 TTL 秒——这段时间内读到的都是旧值。TTL 越短越新鲜，但条目更容易过期、命中率越低；TTL 越长命中率越高，但陈旧窗口越长。新鲜度与命中率是同一枚参数的两面，调它就是在两边挪筹码。

没有 TTL 会怎样？反事实很具体：缓存只进不出，删除过的短链永远留在缓存里继续 302，内存随着见过的键数无上限增长——陈旧数据永远留住，进程最终让只进不出的缓存撑爆。TTL 让每条副本都自带死刑判决，过期后下一个读者重走四步、拿到新值。

落成命令是一句话：SETEX key 秒数 value——写入的同时声明寿命，一条命令完成，不存在「写了却没设上寿命」的中间态（对齐 Redis 官方文档的命令语义；秒数必须是正整数，传 0 时 Redis 当场拒绝）。到期后的清理由 Redis 自己负责：访问到过期键时惰性删除，加上后台周期清扫，不需要应用盯着。

短链服务该设多长？拿业务问「能容忍多久的陈旧」：跳转目标几乎不变，本课设 60 秒；唯一的一致性事件是极端情况下的数据修正，一分钟的窗口可以接受。你的业务若是「改完必须立刻可见」，答案就完全不同——那是写后主动失效的领域，收束处再点名。

### 缓存穿透：连「没有」也要记下来

旁路铺好之后，它自己会招来一种新攻击。缓存穿透（cache penetration）——专门查询永不存在的键：slug 是七位随机码，攻击者每次换一个乱码打过来，缓存永远未命中，每个请求都原样落到数据库。穿透的坏处在于缓存对这类流量完全透明：你花内存买的旁路，对恶意请求等于不存在。

对策是把第四步补全：查库发现「确实没有」，也是一个值得记的查询结果。往缓存里写一个短 TTL 的空值标记（null 标记），下一个同样打这个乱码的请求会在缓存里撞见标记，直接 404，不再打扰数据库。标记的 TTL 要短——「没有」这件事比「有」更容易过时：这条 slug 随时可能创建出来，标记活得越久，新数据吃 404 误判的窗口越长。本课给 10 秒。

穿透还有两个远亲，坏法同源、对策不同，一并认清：

- 缓存雪崩——大量键同时到期，同一瞬间齐齐回源，过期潮把数据库打满。对策形状：给 TTL 加随机抖动（比如 60 秒上下浮动 20%），把到期时刻摊开。本课实现的是固定 TTL，抖动未实现，登记在简化清单里。
- 缓存击穿——单个热键到期的瞬间，成百个请求同时未命中、同时回源查同一行。对策形状：互斥回源——同一键只放一个请求去查库，其余等它回填；或逻辑过期——条目永不过期、值里带过期时刻由应用判断。本课也未实现：到期瞬间的并发未命中会各自查一次库，靠数据库自己扛过这一拍。

三种坏法共用一个机制根源：缓存是副本，副本与真相之间有时间差，所有攻击都打这个时间差。穿透打「从未有过」，雪崩打「同时到期」，击穿打「恰好最热」——记住攻击的形状，对策自然对号入座。

### 限流：写路径的闸

读路径有了旁路，写路径还裸奔。创建端点登录之后确实挡住了匿名脚本，但一个注册成本可以忽略的攻击者照样能每秒上百次地创建：每次创建都是一行 INSERT、一次哈希、一堆连接占用。写操作的代价是结构性的——不能靠「更快」解决，只能靠「更少」。

限流（rate limiting）——对单位时间内的请求数设上限，超出直接拒绝（HTTP 429）。它是配额，不是安全：认证回答「你是谁」，限流回答「这个窗口里你还剩几次」。配额的量纲由业务定：本课的尺是每 IP 每分钟 5 次创建。

先替第三个直觉说句公道话：「限流是运维的事，网关上配一下就行」。来处不假：反向代理的职责清单里确实有「限速缓冲」这一项（[第 1 章](./01-request-journey)），硬件层也常见限流设备。在「只防总量」的目标下，网关层确实够用。

边界出在粒度与语义。网关看到的是 IP 与字节数，看不到「每 IP 每分钟 5 次创建」这种业务配额，更回不出带业务解释的 429 与 Retry-After。应用层限流知道键怎么分、阈值怎么定、超限时该告诉客户端等多久——这些是业务知识，只有应用自己有。两层各挡各的：网关挡总洪水，应用挡业务配额。

实现选 Redis 计数器，两条命令：INCR key 让键自增并返回新值（键不存在则从 0 起算，第一次返回 1）；返回 1 的那次顺手 EXPIRE key 60，给计数键设一分钟寿命。一分钟后键过期消失，下一次 INCR 又从 1 开始——新窗口自动开张。计数超过阈值，回 429 加 Retry-After 头，告诉客户端这一窗还剩多久（本课回整个窗口长度，是保守上界）。

计数为什么放 Redis 不放进程内存？拿工具箱的尺量一下：限流的状态重启后该不该还在？严格说不必——重启清零只是让所有人多得一个免费窗口。真正的判据是复制：服务横向扩成两份时，各自内存里的计数器各算各的，攻击者的请求在两实例间轮换，配额直接翻倍。**计数器放进程外，多实例才能共享同一把尺**——这与「会话放数据库而不是进程内存」是同一条纪律的两次落地。

还有一处信任边界要标出来：限流键默认取 TCP 连接的对端地址。服务直接暴露时它就是访客 IP；服务躲在反向代理后面时，对端永远是反代——全体访客共享一个桶，第 6 个无辜用户替所有人吃到 429。真实 IP 要从反代透传的 X-Forwarded-For 头里取，而那个头谁都能伪造，只该信任自己控制的反代（这个边界到部署时收口：[第 9 章](./09-deploy-https)）。

### Redis：凭什么快，凭什么不是数据库

前四节反复念叨的「内存」，需要一个载体。Redis——一个内存键值数据库：数据放在内存里，用键取值，读写微秒级。它凭什么比 PostgreSQL 快？两个来源。其一，介质：内存访问不存在磁盘寻道与页读取，这是那两个数量级的物理出处。其二，模型：Redis 用单线程事件循环处理命令——官方文档口径，命令执行是单线程的（新版本把网络读写交给了可选的 I/O 线程，执行仍单线程）。单线程听起来像缺点，在 Redis 这里恰是优点：没有锁竞争、没有上下文切换的账，而内存操作快到单线程也追不完网络。

单线程还送来一件对账重的东西：命令级原子性。一条命令从开始执行到完成，中间不会插入其他命令。INCR 这种「读、加、写」三合一的动作用一条命令完成，天然不需要锁——上一节的计数器敢在多实例并发下直接用，底气在这。但原子性到命令为止：INCR 与 EXPIRE 是两条命令，两条之间隔着崩溃的缝隙。进程恰在两步之间死掉，会留下一个没有寿命的计数键，永远卡在这个桶上（官方文档的限流模式也带这条注记；收紧的做法是让写入自带寿命，形状见收束的实验四）。

最后一个问题最要紧：Redis 是不是可以顺手取代 PostgreSQL？不是，两边的社会分工不同。PostgreSQL 的合同是「数据活得比任何进程久、丢了算事故」；Redis 的默认合同是「服务内存里的数据，重启即失」（它有可选的持久化机制，但那是重建辅助，不是数据库级的担保）。所以选型的判据一句话：**丢了能重建的数据才放进去**。缓存副本——丢了重查一遍就铺回来；计数器——丢了重数，一个窗口的误差；后面要登场的队列信箱也遵守同一条纪律（[第 6 章](./06-queue-mq)）。短链本体、用户、会话这些「丢了算事故」的数据，一天也不能搬过去。本课的教学 Redis 甚至不挂磁盘卷：容器删了数据就没了，这本身就是它定位的宣言。

### 组装式：两条缝，都不动旧接口

盘点一下新能力从哪来。缓存：cache-aside 四步（新增 Z）装在 store 缝的外面——端点代码只多一层「先问缓存」的包裹，store 接口一行未动。限流：一道中间件闸（新增 Y）插进已有的校验与守卫之间。于是：请求校验 + 会话守护 + 新增限流闸 ⇒ 写路径有了配额；直查数据库 + 新增缓存旁路 ⇒ 读路径绕开了热查库。装配的钥匙是可选注入：createApp 的第三个参数缺省时，闸自动放行、旁路自动旁路——旧调用方一行不改。这不是客气，是可检验的承诺：此前落下的 39 条旧测试一个字符未动，全量照绿，旧接口照常工作。

## 演练：从红到绿，给热路径装旁路

老规矩：代码跟着敲、门槛跟着跑，每段代码首行标注它在伴生仓里的真实路径。环境要求沿用前几章：Node 22、pnpm 10、能跑的 Docker（本课验证环境 2026-09 时点为 Node 22.22.2、pnpm 10.32.1），pg 与 redis 都用容器起。本章所有限流与「乱打」实验的对象都是你自己的教学环境；对未经授权的服务做频率攻击，从技术判断到法律结论都是另一回事。

### 手术清单

进手术室之前，先看清动刀范围。

**不动**：src/store.ts 与 src/db/store.pg.ts——存储缝与它的 PostgreSQL 实现，缓存是包在缝外面的，不动里面；src/auth/ 三件——身份层与本章无关；全部 39 条旧测试——一个字符不改，它们是「可选注入没有破坏旧契约」的活证据。

**动**：docker/compose.infra.yml——加 redis 服务；scripts/compose-infra.mjs——up 一并等 redis 健康；src/config.ts——加 Redis 连接串读法；src/app.ts——createApp 加第三个可选参数，两个端点各接一段；src/main.ts——生产装配注入缓存与限流；test/helpers.ts——追加 ensureRedis。

**新增**：src/cache/redis-cache.ts、src/cache/rate-limit.ts、test/cache.test.ts。

### 第一步：compose 加一个 Redis

在同一份基础设施声明里加 redis 服务。数据库那段一行不动，看新增的部分：

```yaml
# companion: docker/compose.infra.yml —— 教学基础设施：pg（第 3 章起）+ redis（第 5 章起）
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

  redis:
    image: redis:7-alpine
    container_name: shortlink-redis
    ports:
      # 宿主 6639 -> 容器 6379：避开本机可能已装的 Redis
      - "6639:6379"
    # 刻意不挂卷：redis 里只放丢了能重建的数据（缓存、计数器），
    # 容器删了数据就没了——这正是它和 pg 的分工线
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 3s
      retries: 15

volumes:
  shortlink_pgdata:
```

跟 pg 对照着看三处差异。端口 6639 映射 6379，理由同 pg 挪 5432——不跟本机可能已有的 Redis 抢端口。healthcheck 用 redis-cli ping，容器自己答 PONG 才算健康。最扎眼的是没有 volumes：pg 挂了具名卷、redis 刻意不挂——原理节那句「丢了能重建的数据才放进去」，落成了声明文件里的一行缺席。

开关脚本随之扩一个服务，结构不变：

```js
#!/usr/bin/env node
// companion: scripts/compose-infra.mjs —— 教学基础设施（pg + redis）的跨平台开关（Windows / macOS / Linux 通用）
// 用法（在 companion 目录）：
//   node scripts/compose-infra.mjs up       拉起教学 Postgres 与 Redis 并等它们健康
//   node scripts/compose-infra.mjs down     停掉容器（具名卷保留，pg 数据不丢）
//   node scripts/compose-infra.mjs status   看容器状态
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
  console.log('教学 Redis 已就绪：redis://localhost:6639')
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

up 的 --wait 现在等两个 healthcheck 都转绿。在 companion 目录里执行：

```text
$ node scripts/compose-infra.mjs up
 Container shortlink-pg Healthy
 Container shortlink-redis Healthy
教学 Postgres 已就绪：postgres://postgres:postgres@localhost:5544/shortlink
教学 Redis 已就绪：redis://localhost:6639
```

### 第二步：依赖与版本

apps/api 装 ioredis（2026-09 时点安装结果，以伴生仓 pnpm-lock.yaml 固定为准；依赖会过期，lockfile 不会）：

```text
$ pnpm --filter @shortlink/api add ioredis@^6.0.0
```

| 依赖 | 版本 | 角色 |
| --- | --- | --- |
| ioredis | 6.0.0 | Redis 客户端；命令做成了方法，连接自己复用 |
| 镜像 redis:7-alpine | Redis 7.x | 教学缓存与计数器本体 |

连接串的读法加在 config.ts 里，与 DATABASE_URL 同一套纪律（dev 给默认值、生产缺失即报错）：

```ts
// companion: apps/api/src/config.ts · Redis 连接串的读法（节选）
const DEV_REDIS_URL = 'redis://localhost:6639'

/**
 * 读取 REDIS_URL，纪律与 DATABASE_URL 相同：开发默认指向教学 Redis（6639），生产缺失即报错。
 */
export function requireRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.REDIS_URL?.trim()
  if (url) return url
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'REDIS_URL 未设置：生产环境必须显式提供 Redis 连接串（开发默认值只在开发环境生效）',
    )
  }
  return DEV_REDIS_URL
}
```

### 第三步：redis-cache.ts——一个客户端，两个消费面

封装从接口出发。缓存的缝只要两个方法：get 问一次、setEx 写一次带寿命的。限流的缝也只要两个：incr 原子自增、expire 设寿命。同一个 ioredis 客户端把两张脸都给了：

```ts
// companion: apps/api/src/cache/redis-cache.ts · RedisCache——ioredis 的薄封装，缓存的读写与计数的原子自增都在这一个客户端上
import Redis from 'ioredis'

/**
 * 读路径缓存的缝：应用只认这两个方法。
 * get 返回 null 表示「键不存在」（缓存未命中）；setEx 是 SETEX key ttl value 的语义——
 * 写入并指定存活秒数，到期由 Redis 自动删除。
 */
export interface LinkCache {
  get(key: string): Promise<string | null>
  setEx(key: string, ttlSeconds: number, value: string): Promise<unknown>
}

/**
 * 同一个 Redis 客户端的完整视图：缓存放 get/setEx，限流放 incr/expire，
 * del 给测试清场。两个消费面共用一条连接（ioredis 自己管连接复用），end() 一并归还。
 */
export interface RedisCache extends LinkCache {
  del(key: string): Promise<unknown>
  /** INCR key：键不存在则从 0 起算返回 1。命令级原子，多进程并发自增不会丢数 */
  incr(key: string): Promise<number>
  /** EXPIRE key seconds：给键设存活秒数，到期自动删除 */
  expire(key: string, seconds: number): Promise<unknown>
  end(): Promise<unknown>
}

export function createRedisCache(redisUrl: string): RedisCache {
  const redis = new Redis(redisUrl)
  return {
    get: (key) => redis.get(key),
    setEx: (key, ttlSeconds, value) => redis.setex(key, ttlSeconds, value),
    del: (key) => redis.del(key),
    incr: (key) => redis.incr(key),
    expire: (key, seconds) => redis.expire(key, seconds),
    end: () => redis.quit(),
  }
}
```

两个设计决定值得多说一句。其一，LinkCache 与限流需求拆成两个接口、共用一个实现——端点依赖的缝越窄，测试能塞进去的替身就越简单。其二，new Redis(redisUrl) 这一个实例贯彻了连接池的纪律：连接按需建立、全程复用，进程退出前 quit() 归还。这与 postgres.js 那个「一个实例就是一个池」是同一种形状。

### 第四步：先红——探针与两段红

测试要证明两件事：读路径真的绕开了数据库，写路径真的挡得住第 6 次。第一件事靠查库探针：包住 store.get 数它调了几次——缓存若挡住了第二次查询，计数就不该动。

```ts
// companion: apps/api/test/cache.test.ts · 查库探针与测试应用的装配（节选）
import { createApp, type AppOptions } from '../src/app'
import { createRedisCache } from '../src/cache/redis-cache'
import { createRateLimiter } from '../src/cache/rate-limit'
import { databaseUrl, ensurePg, ensureRedis, migrateToLatest, redisUrl } from './helpers'

await ensurePg()
await ensureRedis()

/** 查库探针：包住 store.get 数调用次数——缓存挡住的查询，这个计数不该动 */
function countGets(inner: LinkStore): { store: LinkStore; calls: () => number } {
  let calls = 0
  return {
    store: {
      put: (link, ownerId) => inner.put(link, ownerId),
      async get(slug) {
        calls += 1
        return inner.get(slug)
      },
    },
    calls: () => calls,
  }
}

/** 一个带缓存/限流选项的真实服务：探针化的 store + 独立 redis 客户端 */
async function bootApp(opts: AppOptions): Promise<{ base: string; calls: () => number; shutdown(): Promise<void> }> {
  const pgStore = createPgStore(databaseUrl)
  const counted = countGets(pgStore)
  const auth = createAuthStore(databaseUrl)
  const redis = createRedisCache(redisUrl)
  const server = serve({ fetch: createApp(counted.store, auth, opts).fetch, port: 0 })
  // ……省略地址解析与 shutdown（关服务、关三个连接池），见伴生仓终态
}
```

探针是装饰器写法：原 store 一行不改，外面数一层。断言全部押在 calls() 与状态码上。此刻实现还不存在，先跑：

```text
Error: Cannot find module '../src/cache/redis-cache' imported from test/cache.test.ts
Tests  no tests
```

红因单一：模块不存在——能力还没写。等两个 cache 模块落盘、app 还没接线时，再跑一次，红得更具体：

```text
× 同一 slug 连跳两次：第一次探针 1 次，第二次 0 次（SELECT 被缓存挡住）
AssertionError: expected 2 to be 1 // Object.is equality
× 已登录连发 6 次：前 5 次 201，第 6 次 429 且 Retry-After 为窗口秒数
AssertionError: expected 201 to be 429 // Object.is equality
Tests  6 failed (6)
```

读懂这份红：expected 2 to be 1——两次跳转、两次查库，缓存压根没人问；expected 201 to be 429——第 6 次创建畅通无阻，闸还没挂。六条全红、红因都指向「端点尚未接线」，不是语法错、不是连不上 Redis。

### 第五步：rate-limit.ts——两命令固定窗口

限流器是个纯逻辑件，只依赖「自增」与「设寿命」两件事：

```ts
// companion: apps/api/src/cache/rate-limit.ts · checkLimit——INCR + EXPIRE 的固定窗口限流

/** 限流缝的最小依赖：只要原子自增与设过期两件事（RedisCache 满足它，测试也可以换假实现） */
export interface CounterStore {
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<unknown>
}

export interface RateLimitResult {
  allowed: boolean
  /** 被拒时建议客户端等待的秒数：整个窗口长度，保守上界 */
  retryAfter: number
}

export interface RateLimiter {
  checkLimit(key: string): Promise<RateLimitResult>
}

/**
 * 固定窗口计数限流：窗口内的第 1 次请求 INCR 得 1，顺手 EXPIRE 设窗口长度；
 * 之后每次 INCR 拿到「本窗口第 N 次」，超过 limit 即拒。
 * 计数放在 Redis 而不是进程内存——多实例共享同一把尺，靠的是无状态服务的同一条判据。
 */
export function createRateLimiter(
  counter: CounterStore,
  options: { limit?: number; windowSeconds?: number } = {},
): RateLimiter {
  const limit = options.limit ?? 5
  const windowSeconds = options.windowSeconds ?? 60
  return {
    async checkLimit(key) {
      const count = await counter.incr(key)
      if (count === 1) {
        await counter.expire(key, windowSeconds)
      }
      return count > limit
        ? { allowed: false, retryAfter: windowSeconds }
        : { allowed: true, retryAfter: 0 }
    },
  }
}
```

四行核心逻辑：INCR、首次设窗、超限即拒、否则放行。阈值与窗口都从参数来——本课的 5 次 60 秒是 main.ts 装配时的决定，不是写死的政策。retryAfter 回整个窗口长度，是保守上界（窗口已过了几秒，真实等待更短；要精确可以用 TTL 命令查剩余寿命，本课不做）。

### 第六步：app.ts 接线——可选注入

createApp 加第三个参数。注意它的形状：一切可选、缺省即关闭：

```ts
// companion: apps/api/src/app.ts · AppOptions 与 createApp 签名（节选）
/**
 * 可选注入：缓存与限流。缺省时一概不启用——旧调用方（createApp(store, auth)）零改动。
 * 与 store、auth 是同一套注入思路：端点只认接口，给不给、给哪个实现，由装配处决定。
 */
export interface AppOptions {
  /** 读路径缓存（get/setEx）。给了才启用 cache-aside */
  cache?: LinkCache
  /** 命中库后回填缓存的存活秒数——按「能容忍多久的陈旧」定，默认 60 */
  cacheTtlSeconds?: number
  /** 「查过、库里没有」null 标记的存活秒数，应短于 cacheTtlSeconds，默认 10 */
  nullCacheTtlSeconds?: number
  /** 写路径限流。给了才启用 */
  rateLimiter?: RateLimiter
  /** 限流 key 的取法，默认按请求来源 IP 分桶 */
  rateLimitKeyFn?: (c: Context) => string
}

export function createApp(
  store: LinkStore = createMemoryStore(),
  auth: AuthStore = createAuthStore(requireDatabaseUrl()),
  opts: AppOptions = {},
) {
```

写路径的闸是一道中间件，插在校验与守卫之间：

```ts
// companion: apps/api/src/app.ts · 限流闸与四段式（节选）
  /** 限流 key 默认按请求来源 IP：直接连接时它是真 IP，躲在反代后面时全是反代的 IP（信任边界见正文） */
  const defaultRateLimitKey = (c: Context): string => {
    return `ip:${getConnInfo(c).remote.address ?? 'unknown'}`
  }
  const rateLimitKeyFn = opts.rateLimitKeyFn ?? defaultRateLimitKey

  /** 第二段：限流闸。超配额回 429 + Retry-After；挂在守卫之前——未登录的洪水也挡在门外 */
  const rateLimitGate: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!rateLimiter) {
      await next()
      return
    }
    const result = await rateLimiter.checkLimit(rateLimitKeyFn(c))
    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfter), { append: false })
      return c.json({ error: 'rate limited' }, 429)
    }
    await next()
  }

  // 四段式按参数顺序执行：校验(422) → 限流(429) → 守卫(401) → 业务(201)
  app.post('/api/links', validateLinkBody, rateLimitGate, authGuard, async (c) => {
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

挂载次序值得停一拍。校验是纯函数，零 I/O；限流一次 Redis 往返；守卫可能一次数据库查询；业务一次写入。四段按单位检查的代价升序排列，闸挂在最贵的检查之前——洪水来袭时，最坏也只烧到一次 Redis 自增，数据库碰都碰不到。限流放在守卫之前还有一层意思：未登录的洪水不该先消耗会话查询再吃 401，第 6 发直接 429 走人。校验仍在最前，维持「畸形请求连计数都不配消耗」的原判——那三条 422 断言继续锁着这层关系。

读路径的 cache-aside 装在 GET /:slug 里，四步与原理节一一对应：

```ts
// companion: apps/api/src/app.ts · GET /:slug 的 cache-aside（节选）
  // cache-aside：缓存键空间里只放 JSON 文本；'null' 是 JSON 的 null——「查过了，库里没有」
  const linkKey = (slug: string) => `link:${slug}`
  const cacheTtl = opts.cacheTtlSeconds ?? 60
  const nullTtl = opts.nullCacheTtlSeconds ?? 10

  app.get('/:slug', async (c) => {
    const slug = c.req.param('slug')
    if (cache) {
      const cached = await cache.get(linkKey(slug))
      // Redis 的 null = 键不存在 = 未命中；拿到 'null' 或 JSON 对象才算命中
      if (cached !== null) {
        if (cached === 'null') {
          return c.json({ error: 'not found' }, 404)
        }
        const link = JSON.parse(cached) as LinkResponse
        return c.redirect(link.url, 302)
      }
    }
    const link = await store.get(slug)
    if (cache) {
      // 命中库：回填 JSON；库里也没有：写短 TTL 的 null 标记，挡住同一 slug 的重复未命中
      await cache.setEx(
        linkKey(slug),
        link ? cacheTtl : nullTtl,
        link ? JSON.stringify(link) : 'null',
      )
    }
    if (!link) {
      return c.json({ error: 'not found' }, 404)
    }
    return c.redirect(link.url, 302)
  })
```

键空间的设计只立一条规矩：这个前缀下只放 JSON 文本。命中的副本是 LinkResponse 的 JSON；null 标记就是 JSON 的 null 序列化——四字符的 'null'。get 拿到的 null（键不存在）与 'null'（查过、没有）是两个世界，前者走查库，后者直接 404。TTL 两个默认值：副本 60 秒、标记 10 秒，理由都在原理节算过。

### 第七步：main.ts 生产装配与转绿

dev 与生产入口把两样东西全量注入；测试想关掉哪个，不传就是：

```ts
// companion: apps/api/src/main.ts
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { requireDatabaseUrl, requireRedisUrl } from './config'
import { createPgStore } from './db/store.pg'
import { createAuthStore } from './auth/session'
import { createRedisCache } from './cache/redis-cache'
import { createRateLimiter } from './cache/rate-limit'

const port = Number.parseInt(process.env.PORT ?? '4510', 10)
const store = createPgStore(requireDatabaseUrl())
const auth = createAuthStore(requireDatabaseUrl())
// 生产装配：一个 Redis 客户端同时当缓存的读写面与限流的计数面（同一条连接）
const redis = createRedisCache(requireRedisUrl())

serve(
  {
    fetch: createApp(store, auth, {
      cache: redis,
      rateLimiter: createRateLimiter(redis),
    }).fetch,
    port,
  },
  (info) => {
    console.log(`api listening on http://localhost:${info.port}`)
  },
)
```

再跑本章测试：

```text
✓ test/cache.test.ts (6 tests)
Tests  6 passed (6)
```

六条测试各自守住一件事：命中率探针（第二次 0 次查库）、TTL 过期重查（1.6 秒后又 +1）、null 缓存（两次 404 只查 1 次库）。另三条守限流：登录的 5 过 6 拒（第 6 次 429 且 Retry-After 恰为 60）、匿名洪水第 6 次 429（闸在守卫前）、不同 key 互不影响（A 桶打满 B 桶照常 201）。测试启动前 ensureRedis 先探活，连不上时提示先跑 node scripts/compose-infra.mjs up，而不是淹死在一屏连接错误里。

### 门槛

在 companion 目录里按序执行（pg 与 redis 都必须在跑）：

```text
$ node scripts/compose-infra.mjs up
教学 Postgres 已就绪：postgres://postgres:postgres@localhost:5544/shortlink
教学 Redis 已就绪：redis://localhost:6639
$ pnpm test
packages/shared  Tests  12 passed (12)
apps/api         Tests  33 passed (33)
$ pnpm typecheck
packages/shared typecheck: Done
apps/api typecheck: Done
apps/web typecheck: Done
```

退出码 0，45 条全绿。api 的 33 条里：六条端点 e2e、两条重启剧本、三条索引实验、十六条身份测试——全部 39 条旧测试一行未改；新增六条缓存与限流。旧测试照绿就是组装证据：可选注入没有碰到任何旧契约。

## 验证：亲眼看着数据库退到一旁

dev 服务起着（pnpm dev，端口 4510）。每一步先把预测写下来，再执行对照。

### 一、先猜后跑：第二次跳转，探针是 0 还是 1

跑本章测试之前，写下预测：同一 slug 连跳两次，第二次的查库探针计数是 0 还是 1？二选一，落笔再跑：

```text
$ pnpm --filter @shortlink/api exec vitest run test/cache.test.ts
Tests  6 passed (6)
```

全绿即证：第一次 1、第二次 0。如果你还想眼见缓存到底有没有人问，进 Redis 看实物（下一节）。

### 二、redis-cli：缓存里的东西长什么样

创建一条短链并跳转一次，然后打开 Redis 的抽屉：

```bash
curl -s -i http://localhost:4510/<你的slug>
docker exec shortlink-redis redis-cli get "link:<你的slug>"
docker exec shortlink-redis redis-cli ttl "link:<你的slug>"
```

应看到（拿本课的一次真实运行做样张，slug 为 FZEnJiu）：

```text
{"slug":"FZEnJiu","url":"https://example.com/cache-observe","createdAt":"2026-09-09T06:09:22.035Z"}
60
```

第一行是副本原文——整条 LinkResponse 的 JSON；第二行是剩余寿命，再跑一次 ttl，数字在往下走。接着乱打一个不存在的 slug 两次（都回 404），再看它的抽屉：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4510/ghost-probe-43
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4510/ghost-probe-43
docker exec shortlink-redis redis-cli get "link:ghost-probe-43"
docker exec shortlink-redis redis-cli ttl "link:ghost-probe-43"
```

```text
404
404
null
10
```

四字符的 null——「查过了，确实没有」，寿命 10 秒。第二次 404 没有查库，是这行标记替它答的话。等十几秒再 get，键已经消失：到期自动删除，无需任何人善后。

### 三、定向破坏 A：注释掉回填那一行

指认一处精确改动：apps/api/src/app.ts 的 GET /:slug 里，把回填那一句注释掉——`await cache.setEx(...)` 一共五行（含跨行参数），整段注释。先写预测再跑：本章六条测试，几条红、几条绿？

执行 `pnpm --filter @shortlink/api exec vitest run test/cache.test.ts`，应看到恰好 3 条红：命中率探针（expected 2 to be 1——第二次跳转只能再查库）、TTL 过期重查（同样 expected 2 to be 1）、null 缓存（两次 404 查库 2 次）。3 条限流测试照绿——它们守的是写路径的闸，与回填无关。哪条「该绿的照绿」最有说头：匿名洪水那条依然 401 转 429，四段式的次序一点没动。改回复原，6 条全绿。

解释：回填是 cache-aside 第四步，砍掉它，缓存只读不写、永远未命中——旁路铺了却没人走。探针的计数变化（1 变 2）就是「缓存一条都没填过」的直接读数。

### 四、定向破坏 B：阈值 5 改 2

指认一处精确改动：apps/api/src/cache/rate-limit.ts 里 `options.limit ?? 5` 改成 `options.limit ?? 2`（默认阈值变了；测试注入的显式值不受影响）。tsx watch 会自动重启 dev。先猜：第三次创建，201 还是 429？清掉自己 IP 的计数桶再连发三次：

```bash
docker exec shortlink-redis redis-cli --scan --pattern 'ip:*'
docker exec shortlink-redis redis-cli del "<上面扫到的键>"
curl -s -i -c /tmp/jar.txt -X POST http://localhost:4510/api/auth/register -H "content-type: application/json" -d '{"email":"you@example.com","password":"try-break-1"}'
curl -s -i -b /tmp/jar.txt -X POST http://localhost:4510/api/links -H "content-type: application/json" -d '{"url":"https://example.com/break-b"}'
curl -s -i -b /tmp/jar.txt -X POST http://localhost:4510/api/links -H "content-type: application/json" -d '{"url":"https://example.com/break-b"}'
curl -s -i -b /tmp/jar.txt -X POST http://localhost:4510/api/links -H "content-type: application/json" -d '{"url":"https://example.com/break-b"}'
```

第三发的响应头应看到：

```text
HTTP/1.1 429 Too Many Requests
retry-after: 60

{"error":"rate limited"}
```

改回 `?? 5`、再清一次桶、重发三次——第三发回到 201。两处都对上后，顺手跑一遍 pnpm test：45 条照绿。为什么阈值改了测试不红？测试注入的 limit 是显式参数，不吃默认值——「阈值由装配处决定」这条缝，正是这次破坏反过来证的。注意扫出来的键长什么样：直接连本机时它可能是 ip:127.0.0.1，也可能是 ip:::1——取决于 curl 走了 IPv4 还是 IPv6 回环，两个都是「TCP 对端地址」的如实记录。

### 五、把结果讲给自己听

四个实验各对一块积木：实验一对 cache-aside 的命中步；实验二对键空间与两种 null 的分界；实验三对回填步的反事实；实验四对限流的注入缝。哪一步的现象与此不符，回到对应小节重推一遍。

## 收束：把开篇那笔账再算一遍

开篇算过：每秒 100 次点击、每次 10ms 的查库，整秒吃满数据库的时间。现在把同一张表重算——每个曾在钩子里悬着的问题，各占一行：

| 这条路径 | 从前 | 现在 | 中间站着谁 |
| --- | --- | --- | --- |
| 读一个热门 slug | 每次查库，10ms 级 | 命中缓存，0.1ms 级 | cache-aside 四步 + 60 秒 TTL |
| 读一个不存在的 slug | 每次查库，攻击者随意点名 | 标记期内零查库 | 10 秒 null 标记 |
| 创建短链 | 登录后无上限 | 每 IP 每分钟 5 次 | INCR + EXPIRE + 429 |

同样每秒 100 次点击的账：首次访问查一次库，之后 60 秒内的 99 次走内存——数据库在这一秒里只出 10ms 的零头。新鲜度的代价写在第一行：目标网址改动后，最长 60 秒内读到的还是旧值；写后主动失效是更贵的 freshness，本课用 TTL 的秒数付账。第三行的闸替数据库挡住了最坏情况：洪水最远只能烧到一次 Redis 自增，四段式里比它贵的检查一个都碰不到。热路径还在，只是数据库不在上面了。

照实交代没做的事：雪崩的 TTL 抖动、击穿的互斥回源、滑动窗口、写后失效、按剩余寿命精确计算 Retry-After——都登记进简化清单，各自的对策形状正文给过。Redis 在这一章当了两回差：缓存的抽屉、限流的尺子。它还能再兼一职——队列的信箱，那是下一场「先答应、稍后完成」的开场（[第 6 章](./06-queue-mq)）。

迁移自查改成五个预测变体实验——每题先写下可判定的预言，再动手核对。

1. 「先乱打、后创建」的竞态：先 curl 一个不存在的 slug（种下 null 标记），再用 psql 往库里直插同一 slug 的一行，插完立刻再 curl 它。预言：这次是 302 还是 404？过多久会变？

   ```bash
   docker exec -it shortlink-pg psql -U postgres -d shortlink -c "insert into links (slug, url) values ('race-probe', 'https://example.com/race')"
   ```

2. 两个 api 进程共享同一个 Redis：A 进程刚跳转过 slug X 并命中，B 进程（全新进程、自己的探针）第一次跳转 X——B 侧查库几次？若缓存放在进程内存里，这个数字会变吗？
3. 窗口接缝：第 5 次创建落在窗口的最后一秒，第 6 次落在新窗口的第一秒——第 6 次回什么？一分钟这个口径下，接缝两侧实际最多放过几次？
4. 两命令之间的缝隙：进程恰好在 INCR 之后、EXPIRE 之前崩溃——那个计数键的 TTL 是多少？这个桶之后会怎样？收紧这条缝的命令形状是什么？
5. 删掉 app.ts 里 `cached === 'null'` 那个分支（让命中路径直接 JSON.parse 并跳转）：预言本章六条测试里恰好哪一条红、为什么只有它红？

<details>
<summary>展开参考答案</summary>

1. 仍是 404——标记还活着，跳转读的是缓存里的 null，不查库。等标记到期（默认 10 秒内）后再 curl，走查库拿到新行，回 302。这是 null 标记的代价面：标记期内「刚创建的数据」不可见。生产里创建端点若能预测 slug，写后主动失效（创建成功即 del 缓存键）能收掉这个窗口。
2. 0 次——缓存住在进程外的 Redis 里，A 写的副本 B 直接读得到。若放在进程内存，B 会查一次库（各自一份互不相通的缓存），多实例的命中率与限流尺都会因此裂开——这就是计数与副本都放进程外的判据。
3. 第 6 次回 201——键已过期，新窗口从 1 起算。最坏情况：旧窗口开头放过 5 次、新窗口末尾再放 5 次，紧挨着的 60 秒里实际放过 10 次——固定窗口的接缝坏法，滑动窗口（窗口内逐次过期）是对策形状，本课未实现。
4. TTL 显示 -1（永不过期）。这个桶的计数只增不减，配额永远回不来，受影响的 IP 永久 429，直到人工 DEL。收紧形状：首次写入用 SET key 1 EX 60 NX 一条命令带上寿命，或用 Lua 把 INCR 与 EXPIRE 合成原子脚本。
5. 恰好「null 缓存」那一条红。'null' 字符串会顺利 parse 成 JavaScript 的 null，随后 link.url 抛 TypeError。第二次乱打收到的是 500 而非 404（expected 404 to be 500 一类的红）。命中测试走的是 JSON 对象分支、TTL 测试的两跳与第三跳都不读 'null' 标记，三者照绿——两种 null 的分界是那一个等值判断在守。

</details>
