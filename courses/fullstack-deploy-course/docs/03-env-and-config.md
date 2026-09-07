---
title: 环境变量与运行时配置：同一份产物跑任何环境
---

# 环境变量与运行时配置：同一份产物跑任何环境

「staging 机器上起不来，报的是连不上数据库。」同一份 .output，测试环境跑得好好的，原样拷到另一台机器，一启动就死。有人蹲在服务器上翻产物文件，grep 出一行刺眼的东西：数据库连接串以字面量躺在编译后的代码里，地址写的是测试库。「换个环境连不上」与「连接串写死」是同一件事的两面——环境之间会变的值，被焊死在了不属于它的地方。

这个坑离本课的工程只有一步：/api/deploys 的数据源要从内存数组换成 PostgreSQL（去向第 4 章），staging 一台库、生产另一台。如果现在不回答「环境差异放在哪」，换库那天就会把连接串写死进产物，亲手复刻开篇的事故。本章在连库之前把这件事解决掉，落成五块积木：构建期与运行期配置的分界、runtimeConfig、环境变量注入、fail-fast 配置校验、.env 与密钥管理。收尾的门槛里，同一个产物不重建换环境跑给机器看，缺配置的进程在第一时刻死给机器看。

## 工具箱

本章调用两块旧积木。

**Nitro**——Nuxt 的服务端引擎兼编译器：页面渲染与 server/ 后端由它托管，并编译进同一个自包含产物（第 1 章）。本章用它的另一处设施：server/plugins/ 下的启动插件，在服务起跳时执行一次——正好是配置校验的挂点。

**server API**——server/api/ 下文件路径即路由的 TS 后端，defineEventHandler 导出处理器（第 2 章）。本章的配置模块与它同住 server/ 树，由同一个 Nitro 编译进同一个产物：校验逻辑与被校验的进程同生共死。

## 一条分界线：构建期与运行期

构建期与运行期配置——区分两类配置值的一条分界线：构建期配置随产物固化，构建完成即不可变；运行期配置在进程启动时注入。判定只需要一个问题：**这个值换环境会不会变？** 会变的走运行期，不会变的走构建期。

做反事实检验，看分界放错一侧的代价。假如数据库连接串是构建期配置：每个环境各要一次构建，staging 一个产物、生产一个产物，「一份产物」这个优势直接蒸发；更要命的是密钥被烤进产物文件——产物拷到哪台机器、进了哪个镜像仓库，密钥就泄漏到哪里。反过来放对一侧：一份产物走天下，每台机器在启动时注入自己的值。这道检验还有一个更快的问法：换环境，要不要重新构建？不要，就说明差异活在运行期。

对「环境变量在构建时打进产物效果一样」这个直觉先说句公道话：只有一套环境时，构建期注入确实省掉了服务器上的配置步骤，看起来毫无差别。它不成立的边界在环境数：一旦有了第二套环境，每套都要重建一次，且每个产物都携带一份密钥——构建次数与泄漏面一起翻倍。而且本课版本实测，这条路根本走不通：在构建机器上 export NUXT_ 变量再构建，产物里 grep 不到这些值（构建机器的临时目录翻遍也没有）；官方文档的口径与之相符——运行期配置的值由环境变量在运行时替换，构建产物里躺着的只有 nuxt.config 登记的默认值。

本课工程里其实早就有一条运行期配置的证据：PORT 环境变量不重建就换了监听端口（第 1 章）。端口如此，数据库地址与环境名同理。

## runtimeConfig：登记键名，不登记值

runtimeConfig——Nuxt 的运行期配置面：在 nuxt.config.ts 里登记键名与默认值，值由环境变量在运行时覆盖。代码一侧用 useRuntimeConfig() 读取。它是「分界线」落在 Nuxt 里的载体：键在构建期登记，值在运行期到达。

本章在 nuxt.config.ts 里登记两个键，全文如下。

```ts
// companion/nuxt.config.ts · 运行期配置面：只登记键名与「空默认」，值由环境变量在进程启动时注入
export default defineNuxtConfig({
  compatibilityDate: '2026-09-01',
  devtools: { enabled: false },
  runtimeConfig: {
    // 私有键：只在服务端可见。连接串属于密钥，永不进浏览器。
    dbUrl: '', // 注入变量：NUXT_DB_URL（第 4 章起真正连库使用）
    public: {
      // 公有键：会随页面序列化进浏览器，只放可展示的非敏感信息。
      appEnv: '', // 注入变量：NUXT_PUBLIC_APP_ENV（公有键在变量名里多一段 PUBLIC_）
    },
  },
})
```

两个键分别示范了配置的两种可见性。dbUrl 是私有键：连接串是密钥，只该存在于服务端进程的内存里。public.appEnv 是公有键：运行环境名要显示在页面上，浏览器也拿得到——所以它进 public 段，且永远只放非敏感信息。这条界线不是风格建议，是泄漏面：公有键会随页面发给每一个访客。

注意两个默认值都是空串，这是刻意的。必需的配置不给安全默认值：给了默认值，漏配的进程就能悄悄上岗，错误推迟到第一次连接时才爆；空默认加上本章后面的启动校验，让漏配在进程起跳的那一刻暴露。

首页把公有配置用起来——当前环境名渲染进页面：

```vue
<script setup lang="ts">
// companion/app/pages/index.vue · 节选：公有运行期配置渲染当前环境名
import type { DeployRecord } from '#shared/types'

const { data: deploys } = await useFetch<DeployRecord[]>('/api/deploys')
const config = useRuntimeConfig()
const appEnv = config.public.appEnv
</script>

<template>
  <p>
    ship-log 记录每一次部署。当前环境：<code>{{ appEnv }}</code>。
    数据来自 GET /api/deploys，SSR 期间由同一个 Node 进程里的 server/ 代码提供。
  </p>
  <!-- 表格部分未改动 -->
</template>
```

## 环境变量注入：值如何到达进程

环境变量注入——Nuxt 把环境变量映射进 runtimeConfig 的规则：变量名以大写 NUXT_ 开头，键与大小写转折用下划线分隔。与官方文档口径一致的两个要点：只有先在 nuxt.config 登记过的键才可被覆盖——随手 export 的任意变量不会暴露给应用代码；覆盖发生在进程运行时，不是构建时。

本章两个键的映射关系：

| runtimeConfig 键 | 注入它的环境变量 | 可见性 | 必需性 |
|---|---|---|---|
| dbUrl | NUXT_DB_URL | 私有（仅服务端） | 必需，无默认 |
| public.appEnv | NUXT_PUBLIC_APP_ENV | 公有（随页面进浏览器） | 必需，枚举 local / staging / production |

规则说完了，用生产产物验一遍（第 1 章的判定工具继续用：curl 不执行 JS，HTML 里有什么，服务端就渲染了什么）：

```text
# PORT=4191 NUXT_DB_URL=postgres://… NUXT_PUBLIC_APP_ENV=staging node .output/server/index.mjs
[config] 必需配置校验通过（appEnv=staging）
Listening on http://[::]:4191

# curl -s http://127.0.0.1:4191/ | grep -o '当前环境：<code>.*</code>'
当前环境：<code>staging</code>
```

零重建。产物里 appEnv 的默认值是空串，staging 这三个字母只能来自进程环境——同一个 .output，换一组变量就是另一个环境。再做一条反向验证：整个页面 HTML 里 grep 不到连接串。私有键没有公有面，密钥到浏览器为止一步都不多走。

还有一个事实必须现在钉死：**生产产物不读 .env 文件。**产物入口 index.mjs 全文三十余行，逐行可查——它只从 process.env 读端口等少数变量，没有任何加载 .env 的逻辑；官方文档同样直白：Nuxt CLI 在开发与构建时内建读取 .env，而运行构建出的服务器时 .env 不会被读。所以生产环境的值只能来自真正的环境变量，由谁来注入？服务器上的进程管理器、容器编排或 CI——本课后半程会把这件事逐层做实（容器化第 5 章、部署脚本第 9 章）。

## fail-fast 配置校验：缺配置的进程不配上岗

先看不做校验会发生什么。缺 NUXT_DB_URL 的进程照常启动：端口监听、页面能开、健康检查通过——直到第一个碰数据库的请求在深处炸成 500；或者更阴险的版本：带着某个默认值连上一台错误的库，把数据写进不该写的地方。失败暴露得越晚，定位越贵。

fail-fast 配置校验——进程启动时校验必需配置，缺失或非法就带着清晰清单退出，而不是等到第一次请求才在深处崩掉。它由三个零件组装：loadAppConfig(env) 校验函数、ConfigError 错误类型、Nitro 启动插件挂点。契约一句话：**齐全返回完整配置；有问题抛 ConfigError 并列出全部问题项；绝不部分返回。**

校验函数全文如下（zod 沿用既有依赖，零新增——同一块守门的库，在系统边界拦请求，在进程边界拦配置）。

```ts
// companion/server/utils/config.ts · 启动期配置门卫：必需环境变量一次校验、一次报全，绝不部分返回
import { z } from 'zod'

// 配置错误：problems 携带全部问题项（键 + 原因），由启动插件打印成清单后以非 0 退出码结束进程
export class ConfigError extends Error {
  constructor(readonly problems: readonly { key: string; reason: string }[]) {
    super(
      `必需环境变量校验失败（${problems.length} 项）：\n` +
        problems.map((p) => `  - ${p.key}: ${p.reason}`).join('\n'),
    )
    this.name = 'ConfigError'
  }
}

// 必需环境变量的守门 schema（键名与 nuxt.config.ts 的 runtimeConfig 注入规则一一对应）
const requiredEnvSchema = z.object({
  NUXT_DB_URL: z.string().refine(
    (v) => v.length > 0 && (v.startsWith('postgres://') || v.startsWith('postgresql://')),
    '不能为空，且必须以 postgres:// 或 postgresql:// 开头（第 4 章的 PostgreSQL 驱动只认这两种写法）',
  ),
  NUXT_PUBLIC_APP_ENV: z.enum(['local', 'staging', 'production'], {
    error: '只允许 local、staging 或 production',
  }),
})

// 应用视角的配置形状：env 里的 NUXT_ 前缀在这里翻译掉，调用方只见 dbUrl / appEnv
export interface AppConfig {
  dbUrl: string
  appEnv: 'local' | 'staging' | 'production'
}

export function loadAppConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = requiredEnvSchema.safeParse(env)
  if (!parsed.success) {
    // 一次报全：zod 的 issues 覆盖所有未通过的字段，不只第一个
    const problems = parsed.error.issues.map((issue) => {
      const key = issue.path.join('.')
      // 缺失与非法分开说：键没设置是「缺」，设置了但值不对是「错」
      const reason = env[key] === undefined ? '缺失（未设置）' : issue.message
      return { key, reason }
    })
    throw new ConfigError(problems)
  }
  return {
    dbUrl: parsed.data.NUXT_DB_URL,
    appEnv: parsed.data.NUXT_PUBLIC_APP_ENV,
  }
}
```

「一次报全」不是打印风格的偏好，是运维成本：两个变量都缺时一次列两项，补一轮就能上岗；缺一个报一个的校验，逼着运维跑三遍才能凑齐配置。「绝不部分返回」同理——返回一半配置的函数，等于邀请调用方在半配置状态下继续跑。

挂点是 Nitro 启动插件，全文九行：

```ts
// companion/server/plugins/config.ts · Nitro 启动插件：进程起跳前校验必需配置，缺项带清单退出
// server/plugins/ 下的插件由 Nitro 在服务启动时执行一次（dev 与生产产物都走这里）
// process 显式从 node:process import（与 Nitro 产物入口同款写法），不依赖全局类型
import process from 'node:process'
import { ConfigError, loadAppConfig } from '../utils/config'

export default defineNitroPlugin(() => {
  try {
    const config = loadAppConfig(process.env)
    console.log(`[config] 必需配置校验通过（appEnv=${config.appEnv}）`)
  } catch (err) {
    if (err instanceof ConfigError) {
      // fail-fast：不带病上岗。退出码 1 让守护进程 / 容器编排 / CI 都能看见「这次启动失败了」
      console.error(`[config] ${err.message}`)
      process.exit(1)
    }
    throw err
  }
})
```

process.exit(1) 把「启动失败」变成一个机器可判定的信号：进程守护者靠退出码决定要不要重启或报警，容器与 CI 同理。校验读的是 process.env——也就是所有注入渠道（shell、.env 装载、进程管理器、容器环境）汇合后的最终事实；至于读取配置值的代码，运行时一律走 useRuntimeConfig()，校验一次在门口，读取处处有通道。

## .env 与密钥管理：仓库里只有模板

.env 与密钥管理——一套纪律：.env 只放本机默认值且永不入库，仓库里永远只有 .env.example 模板，生产密钥经环境变量或托管密钥服务注入。逐条落到本课工程。

先回答 .env 是什么、谁在读它。它是「键=值」的本地文件；开发时 Nuxt CLI 自动读取它，让 nuxt dev 不必手动 export 一串变量；构建与生产前面已经钉死——产物进程不读它。所以它的准确身份是：开发期默认值的载体，而不是应用的配置来源。

两个文件，一进库一不入库：

```text
# companion/.env.example · 环境变量模板（入库）：新环境照此填值
# 复刻仓库后复制一份：cp .env.example .env（Windows Git Bash 同样适用）

# 数据库连接串（第 4 章起真正使用；值只在服务端存在，属于密钥）
# 必需：缺失或为空时进程启动即失败（fail-fast）
NUXT_DB_URL=postgres://ship_log:ship_log@127.0.0.1:5432/ship_log

# 运行环境名（显示在首页；公有配置，会随页面进浏览器——只放非敏感信息）
# 必需：只允许 local、staging、production
NUXT_PUBLIC_APP_ENV=local
```

.env 内容相同但注释更短。哪个文件进了版本库，不用背规则，让 git 回答：

```text
# git check-ignore -v .env .env.example（在 companion 目录执行）
.gitignore:35:.env	.env
.gitignore:37:!.env.example	.env.example
```

第一行：.env 命中仓库根 .gitignore 第 35 行的 .env 规则——被忽略。第二行命中的是带感叹号的反向规则——模板被豁免，照常入库。旁证在 git status 里：新文件列表看得到 .env.example，永远看不到 .env。

对「把 .env 提交进仓库最方便」说句公道话：单人短项目里它确实省事，克隆即能跑，谁也没吃亏。边界在时间和人数：.env 里迟早会躺进真实密钥，一旦入库，它就进入每一份克隆、每一次 fork、每一条 CI 日志；Git 历史里的密钥即使事后删除也仍可翻出，唯一可靠的补救是把密钥本身全部换掉。所以纪律定死：仓库里只有模板，值永远经环境注入。

最后一块拼图：本章之后，产物进程必需这两个变量，而两条老 e2e 门槛（起产物进程断言页面与 API）本来不设任何变量。package.json 给它们的启动方式补了环境装载，脚本本体一行未动。

```jsonc
// companion/package.json · scripts 节选
"e2e:ch1": "node --env-file-if-exists=.env scripts/e2e-ch1.mjs",
"e2e:ch2": "node --env-file-if-exists=.env scripts/e2e-ch2.mjs",
"e2e:ch3": "node scripts/e2e-ch3.mjs"
```

--env-file-if-exists 是 Node 22 的原生参数：有 .env 就把值装进脚本进程的环境，再随 spawn 传给产物进程；没有就静默跳过。断言一条未改，老门槛语义不变；复刻仓库后先 cp .env.example .env，全部门槛照常全绿。顺带它还预演了生产的正确姿势——值由外部装进环境，产物自己不找文件。

## 演练：从两条红到全绿

本章门槛六条命令，都在 companion 目录执行，跨平台。前五条沿用旧章：pnpm typecheck、pnpm test、pnpm build、pnpm e2e:ch1、pnpm e2e:ch2。新增的最后一条是 pnpm e2e:ch3。动手前照例先看真实失败。

### 红一：配置门卫不存在（测试先行）

行为测试先写。loadAppConfig 是普通函数，env 由测试显式给足——不起服务器、不 mock、不碰真实进程环境，「域逻辑不碰 HTTP 即可裸测」的分层思想（第 2 章）原样平移到配置层。测试全文钉死六件事：齐全返回、两个都缺一次报全、只缺一报一、清空等于缺失、非法值拒收、绝不部分返回。

```ts
// companion/tests/config.test.ts · loadAppConfig 行为测试：齐全返回 / 缺失与非法一次报全 / 绝不部分返回
// 刻意不依赖 Nuxt 运行时：loadAppConfig 是普通函数，env 由测试显式给足，进程环境不参与
import { describe, expect, it } from 'vitest'
import { ConfigError, loadAppConfig } from '../server/utils/config'

const DB_URL = 'postgres://ship_log:ship_log@127.0.0.1:5432/ship_log'

// 齐全且合法的环境：两个必需变量都在
const completeEnv = {
  NUXT_DB_URL: DB_URL,
  NUXT_PUBLIC_APP_ENV: 'staging',
}

describe('loadAppConfig（齐全）', () => {
  it('返回以应用视角命名的配置对象（NUXT_ 前缀被翻译掉）', () => {
    expect(loadAppConfig(completeEnv)).toEqual({ dbUrl: DB_URL, appEnv: 'staging' })
  })

  it('staging 与 production 都合法', () => {
    expect(loadAppConfig({ ...completeEnv, NUXT_PUBLIC_APP_ENV: 'production' }).appEnv).toBe('production')
  })
})

describe('loadAppConfig（缺失与非法）', () => {
  it('两个必需变量都缺失时，一次报全：清单同时含两个键', () => {
    try {
      loadAppConfig({})
      expect.unreachable('空环境必须抛 ConfigError')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      const message = (err as ConfigError).message
      expect(message).toContain('NUXT_DB_URL')
      expect(message).toContain('NUXT_PUBLIC_APP_ENV')
    }
  })

  it('只缺一个时，清单只含缺失的那个（不冤枉已就位的键）', () => {
    try {
      loadAppConfig({ NUXT_DB_URL: DB_URL })
      expect.unreachable('缺 NUXT_PUBLIC_APP_ENV 必须抛 ConfigError')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      const message = (err as ConfigError).message
      expect(message).toContain('NUXT_PUBLIC_APP_ENV')
      expect(message).not.toContain('NUXT_DB_URL')
    }
  })

  it('清空（空字符串）等于缺失：dbUrl 为空串时抛 ConfigError', () => {
    expect(() => loadAppConfig({ ...completeEnv, NUXT_DB_URL: '' })).toThrow(ConfigError)
  })

  it('非法值被拒：appEnv 不在允许集合内时报错并指认该键', () => {
    try {
      loadAppConfig({ ...completeEnv, NUXT_PUBLIC_APP_ENV: 'dev' })
      expect.unreachable('非法 appEnv 必须抛 ConfigError')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).message).toContain('NUXT_PUBLIC_APP_ENV')
    }
  })

  it('绝不部分返回：一项有问题就不返回任何配置对象', () => {
    // dbUrl 合法、appEnv 缺失——不允许「先给你 dbUrl，appEnv 稍后补」的半成品
    expect(() => loadAppConfig({ NUXT_DB_URL: DB_URL })).toThrow(ConfigError)
  })
})
```

此刻模块还不存在，跑 pnpm test：

```text
# pnpm test 红跑（节选）
Error: Cannot find module '../server/utils/config' imported from
D:/.../companion/tests/config.test.ts
Test Files  1 failed (1)
```

红得其所：测试要的是「配置门卫存在且行为正确」，而它还不存在。补上前文已全文给出的 server/utils/config.ts 与 server/plugins/config.ts，nuxt.config.ts 登记键名，.env 与 .env.example 就位，再跑一次。

```text
# pnpm test 转绿
 ✓ tests/deploys.test.ts (4 tests) 7ms
 ✓ tests/config.test.ts (7 tests) 9ms
 Test Files  2 passed (2)
      Tests  11 passed (11)
```

### 红二：产物进程缺配置，启动即死

单测管函数，管不了「进程真的会死」。先构建（pnpm build），然后不设任何变量直接启动产物：

```text
# node .output/server/index.mjs
[config] 必需环境变量校验失败（2 项）：
  - NUXT_DB_URL: 缺失（未设置）
  - NUXT_PUBLIC_APP_ENV: 缺失（未设置）
（echo $? → 1）
```

两行清单加退出码 1，端口从未监听。这就是 fail-fast 在真实产物上的样子：没有 500、没有空页面、没有带病上岗，进程在伤害发生之前死掉，且死因写满了清单。

### e2e:ch3：两幕钉进门槛

手工验证会烂掉，门槛不会。新增 scripts/e2e-ch3.mjs（端口 4173），把本章两个主张各钉一幕。控制流与前两章同款：断言失败抛专用错误，catch 记录并置退出码，finally 杀进程、验端口，exit 事件再兜底杀一次。

```js
// companion/scripts/e2e-ch3.mjs · 片段一：幕一显式注入变量，起同一份产物
const act1 = startServer({ NUXT_DB_URL: ACT1_DB_URL, NUXT_PUBLIC_APP_ENV: 'staging' })
// 断言：GET / 200；裸 HTML 含 <code>staging</code>；HTML 不含连接串；GET /api/deploys 200
```

```js
// companion/scripts/e2e-ch3.mjs · 片段二：幕二清空必需变量，等「进程自己退出」而不是等就绪
const act2 = startServer({ NUXT_DB_URL: '', NUXT_PUBLIC_APP_ENV: '' })
const outcome = await waitUntilExit(act2.exited, 30_000)
// 断言：退出码非 0；输出含清单且一次列出 NUXT_DB_URL 与 NUXT_PUBLIC_APP_ENV
```

幕一的三条正向断言各有归属：环境标识出现在裸 HTML，是公有配置注入并被 SSR 渲染的证据；连接串不在 HTML，是私有键不泄漏的证据；GET /api/deploys 返回 200，是 server API 的既有能力在配置体系下原样通过的证据——组装成立，不是替换。终态输出：

```text
# companion 门槛 pnpm e2e:ch3 · 终态输出
[e2e:ch3] 幕一：以 NUXT_PUBLIC_APP_ENV=staging 启动同一产物（不重建、不读 .env）
[e2e:ch3] GET / → 200
[e2e:ch3] 裸 HTML 含环境标识 staging → PASS
[e2e:ch3] 私有键 dbUrl 不出现在 HTML → PASS
[e2e:ch3] GET /api/deploys → 200
[e2e:ch3] 幕一进程已退出 (pid 2964, code=null, signal=SIGTERM)
[e2e:ch3] 端口 4173 不再监听 → PASS
[e2e:ch3] 幕二：清空 NUXT_DB_URL 与 NUXT_PUBLIC_APP_ENV 再启动同一产物
[e2e:ch3] 进程自行退出 (code=1) → 非 0 退出码 PASS
[e2e:ch3] 输出含清单且一次列出全部问题键 → PASS
[e2e:ch3] 端口 4173 从未被服务且已释放 → PASS
[e2e:ch3] 全部断言通过 (7/7)
```

六条门槛依次跑完（typecheck、test、build、e2e:ch1、e2e:ch2、e2e:ch3）全部退出码 0。老门槛一行断言未改，照常全绿。

## 验证：先猜，再跑

实验一：换环境，零重建。先构建，然后同一份产物连跑两种环境名（两个终端，一个起进程一个 curl；起进程前先把预测写下：第二次的 HTML 里环境名是什么？要不要重新 pnpm build？三选一：要 / 不要 / 看情况）。

```bash
# 用法示例 · Git Bash，companion 目录内
NUXT_DB_URL='postgres://ship_log:ship_log@127.0.0.1:5432/ship_log' NUXT_PUBLIC_APP_ENV=local PORT=4181 node .output/server/index.mjs
curl -s http://127.0.0.1:4181/ | grep -o '当前环境：<code>.*</code>'
# Ctrl+C 停掉，换 production 再起一次，重发同一条 curl
```

对照：第一次是 local，第二次是 production，全程零重建——差异活在进程环境里，产物一字未动。再加一刀「值不在产物里」：`grep -r 'ship_log@127' .output/` 无命中。连接串只存在于你敲命令的那行 shell 与进程内存里，产物文件干干净净——开篇「连接串写死」在这里被反向证明。查完把进程 Ctrl+C 收尾。

实验二：清空一个必需变量。先猜三件事再跑：退出码是 0 还是非 0？清单报几项？指认哪个键？

```bash
# 用法示例 · Git Bash
NUXT_DB_URL= NUXT_PUBLIC_APP_ENV=local PORT=4182 node .output/server/index.mjs
echo $?
```

对照：非 0（实测 1）；恰好 1 项；指认 NUXT_DB_URL，原因是「不能为空，且必须以 postgres:// 或 postgresql:// 开头…」——空串是「设置了但值不对」，与「缺失（未设置）」分开说。变量补回值再跑，进程正常监听：这就是「补回后正常启动」。变体追问：把 NUXT_PUBLIC_APP_ENV 也清空再跑，清单报几项？（2 项，一次报全——缺几个列几个。）

实验三（定向破坏）：拆掉 exit(1)。把 server/plugins/config.ts 里这一行注释掉，只改这一行：

```ts
      process.exit(1)
```

先猜两件事再动手：进程还会退出吗？退出码是多少？然后 pnpm build，用实验二的命令启动。对照：进程仍然退出、退出码仍非 0——ConfigError 落到 catch 块末尾的 throw，Node 对未捕获异常的处理会终结进程；但输出变成了清单打印两遍、后面拖着一屏堆栈。哪条没变、哪条变了，恰好说明 process.exit(1) 守的是什么。它守的不是「退不退」（Node 会退），是失败的确定性形态——两行可 grep 的清单加确定的退出码，给守护进程和值班的人看；堆栈是给改代码的人看的。复原：去掉注释，pnpm build，重跑实验二确认回到两行清单。

实验四：.env 与 dev 模式。把 .env 里 NUXT_PUBLIC_APP_ENV=local 改成 NUXT_PUBLIC_APP_ENV=dev（只改这个值），先猜 pnpm dev 的结局再跑。对照：dev 服务器起不来，错误正是校验清单的那一项——「NUXT_PUBLIC_APP_ENV: 只允许 local、staging 或 production」。两条结论同时落地：.env 是 dev 模式的注入载体（Nuxt CLI 自动读取）；非法值在 dev 与生产同罪。改回 local 后 dev 恢复正常。注意 dev 的报错后包装进程不会自己退出，Ctrl+C 收尾。

## 收束：换环境前的一分钟

事故的根子一句话钉死：连接串写死，是把运行期配置焊进了构建期；「换个环境连不上」只是最先疼的症状，密钥进产物才是最贵的代价。本章之后，这类值你有一个固定的判定术，拿到任何一个配置值问三句：换环境会不会变？不会，走构建期写进代码；会，缺了还能不能跑？能，runtimeConfig 给安全默认；不能或是密钥，必需键——空默认加启动校验，密钥永远私有。

新机器、新环境上线的操作清单也缩成了一分钟。

```text
1. cp .env.example .env，照模板填两个必需变量
2. 不构建（或拷来既有 .output），直接 node .output/server/index.mjs
3. 看到两行即上岗：[config] 必需配置校验通过（appEnv=…） + Listening on …
4. 起不来就看清单：缺什么补什么，一轮报全，再跑一次
```

本章的组装式一句话：Nitro 启动插件（挂点）+ runtimeConfig 注入（通道）+ zod schema（守门，沿用第 2 章的依赖）。三者组装出的新能力是——同一份产物跑任何环境，缺配置的进程在第一时刻死掉。五块新积木的接口：构建期与运行期配置——判定口诀「换环境会不会变」；runtimeConfig——nuxt.config 登记键、useRuntimeConfig 读取；环境变量注入——NUXT_ 前缀映射，只有登记过的键可覆盖；fail-fast 配置校验——loadAppConfig 抛 ConfigError 一次报全、绝不部分返回；.env 与密钥管理——仓库只有模板，值经环境注入。dbUrl 的第一个真实消费者已在路上：PostgreSQL 连接串即将派上用场（第 4 章）。

## 自查

四道题都换了情境。先在心里答定，再点开对照；答案都不在正文原句里。

<details>
<summary>1. 要新增一个必需变量 NUXT_SMTP_URL（第 9 章的部署通知要用），最少动哪几个文件、各加什么？</summary>

四处各一行：server/utils/config.ts 的 schema 加 NUXT_SMTP_URL 键；.env.example 加一行带注释的模板；.env 照模板填本机值；若有代码要读它，再在 nuxt.config.ts 的 runtimeConfig 登记键名（没登记的键不会暴露给 useRuntimeConfig）。校验、清单、fail-fast 全部自动跟上。回查「fail-fast 配置校验」与「.env 与密钥管理」。
</details>

<details>
<summary>2. 同事说：「我在构建机上 export 了 NUXT_DB_URL 再构建，服务器上就不用设这个变量了。」他错在哪一步？服务器上的实际结局是什么？</summary>

错在以为构建时的环境变量会进产物：实测构建机器上 export 的 NUXT_ 值在 .output 里 grep 不到，官方口径也是运行时替换。服务器上若不设变量，产物进程启动即退出码 1，清单指认 NUXT_DB_URL 缺失。回查「一条分界线」与红二。
</details>

<details>
<summary>3. 两个新配置：「站点公告文案」（页面要显示、非敏感）和「对象存储密钥」（仅服务端上传用）。各放 runtimeConfig 哪一段？哪个会出现在浏览器里？</summary>

公告进 public 段（页面渲染需要，浏览器可见，所以前提是非敏感）；存储密钥放私有段（与 dbUrl 同类，浏览器永远拿不到）。判据不是「重不重要」，是「浏览器该不该看见」。回查「runtimeConfig」一节两种可见性的论证。
</details>

<details>
<summary>4. 生产服务器上根本没有 .env 文件，应用凭什么能拿到这两个变量？loadAppConfig 校验的 process.env，值是从哪汇合来的？</summary>

.env 只是开发期 CLI 的便利；生产值由进程管理器、容器编排或 CI 写进进程环境。loadAppConfig 读的 process.env 正是所有渠道注入后的最终汇合点——所以门口一次校验，守住的就是运行时的真实配置。回查「环境变量注入」一节最后一段。
</details>
