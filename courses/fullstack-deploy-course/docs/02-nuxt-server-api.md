---
title: server/ 目录：把 TS 后端写进同一个工程
---

# server/ 目录：把 TS 后端写进同一个工程

「部署日志能不能开个接口？CI 脚本和手机端都想读。」需求很合理：数据以三行字面量躺在首页组件里，第二个消费者一出现，就得把它搬进一个 HTTP 接口。真正动手写第一个 /api 时，三种死法排着队等你：body 手拼 JSON 字符串，一个引号拼错，前端一调 /api/deploys 直接 500；POST 缺了字段，接口不报错，脏数据照单全收；为了「对齐」，前端再抄一份 interface，后端改了字段前端毫无感知，any 从接口返回一路传染到组件——any 满天飞的项目，多半就是从第一个凑合的接口开始的。

这三种死法不是笨，是缺结构：接口的形状没有单一的事实源，系统边界没有守门人，业务逻辑和 HTTP 细节搅在一起没法测。本章在同一个 Nuxt 工程里把后端立起来，落成三块积木：server API（文件路径即路由的内置后端）、共享类型（一份定义两侧对账）、请求校验（边界上的守门人）。收尾时门槛全绿——其中包括两条老门槛（第 1 章登记），它们一行未改。

## 工具箱

本章调用一块旧积木。

**Nitro**——Nuxt 的服务端引擎兼编译器：页面渲染与 server/ 目录的后端代码都由它承载，开发时托管、生产时编译进同一个自包含产物（第 1 章）。此前它出力的是页面这一半；本章往它的引擎舱里装第一批后端路由。

## server API：文件路径即路由

server API——server/api/ 目录下的事件处理器，即 Nuxt 工程内置的 TS 后端：一个文件导出一个处理函数，文件路径自动成为 HTTP 路由，开发与生产编译同一套代码。

路由约定一张表说清（文件都在 server/api/ 下，自动挂到 /api 前缀）：

| 文件 | 路由 |
|---|---|
| deploys.get.ts | GET /api/deploys |
| deploys.post.ts | POST /api/deploys |
| deploys/[id].get.ts | GET /api/deploys/:id（方括号是动态段） |
| health/live.get.ts | GET /api/health/live（目录层级即路径层级） |

文件名末尾的 .get/.post 后缀限定 HTTP 方法；不写后缀（如 deploys.ts）则该路由接受所有方法。处理器统一长成 `export default defineEventHandler(...)`——defineEventHandler 这类工具函数由 Nitro 在 server/ 目录里自动引入，不必手写 import。

为什么用这套约定，而不是「后端另起一个 Express 项目」？做个反事实：另起项目意味着两个进程、两个端口、跨域（CORS）配置、接口形状两份定义、两套依赖、部署单元翻倍——每一条都是新的失败面。而在 Nuxt 工程里，server/ 下的代码与页面由同一个 Nitro 编译进同一个 .output。部署单元还是那一个（「一次交付、整体替换」的语义见第 1 章）；接口与页面共享类型也顺理成章。写后端不再产生第二个要部署的东西。

## 共享类型：接口的形状只写一次

共享类型——前端与 server/ 复用同一份 TS 类型定义：接口的形状只写一次，两侧在编译期同时对账。

先做反事实：如果靠「前端各抄一份 interface 对齐」会怎样？两份定义之间没有任何机器可查的关联，漂移只在运行时暴露。后端把字段 summary 改成 note，前端那份 interface 一声不吭；页面上这个位置渲染出空——不是报错，是安静的 undefined。等测试或用户撞上它时，两份定义早就各自漂出去很远了。

载体是 Nuxt 4 的 shared/ 目录：放在这里的类型，页面（app/）与后端（server/）都用 `#shared` 别名 import，例如 `#shared/types`。测试进程（vitest）同样解析得到，不需要额外配置。本章的定义全文 20 行：

```ts
// companion/shared/types.ts · 前后端共享的接口形状：页面与 server/ import 同一份定义
export type DeployEnv = 'production' | 'staging'
export type DeployStatus = 'success' | 'failed'

// 一条部署日志：GET /api/deploys 返回数组的元素形状
export interface DeployRecord {
  id: number
  env: DeployEnv
  status: DeployStatus
  commit: string
  summary: string
}

// 新建部署日志的输入：POST /api/deploys 的请求体形状（id 由服务端分配，不在其中）
export interface CreateDeployInput {
  env: DeployEnv
  status: DeployStatus
  commit: string
  summary: string
}
```

两个名字，两个用途：DeployRecord 是一条完整记录（id 在内）；CreateDeployInput 是新建的输入（没有 id——id 轮不到客户端说了算）。区分它们不是为了多背术语，而是让「客户端能送什么」和「系统里存在什么」在类型上就分开，POST 的守门规则写在下一段。

## 三层分工：瘦 handler、纯函数域、边界校验

接口会越写越多，全堆在 handler 里很快变成一团。本章立一个三层规矩，每层一句职责。

```text
HTTP 路由层（server/api/）   只做适配：读请求 → 调下层 → 设状态码 → 返回
请求校验（handler 门口）     把 unknown 的外部输入收窄成可信类型，不合法即 400
域逻辑层（server/domain/）  纯函数：不 import 任何 HTTP 概念，行为只依赖入参
```

请求校验——在系统边界用 schema 验证外部输入：不合法的请求在进业务逻辑之前就遭到拒绝（本课用 readValidatedBody 配 zod，失败自动 400）。

为什么域逻辑要刻意「不碰 HTTP」？反着推：如果创建记录的逻辑写在 handler 里、直接读 event，想测它就得先有一个 HTTP 请求——要么起真服务器，要么 mock 一堆事件对象。而不 import h3 的纯函数，测试就是普通函数调用：vitest 进程里 import、传对象、断言返回。本章 4 条域逻辑单测的真实耗时是 5 毫秒。域逻辑可独立测试，靠的不是自觉，是依赖方向的约束。

「输入校验是前端的事」——这个直觉先说句公道话：前端的即时校验确实该做，它给用户最快的反馈，体验上无可替代。它不成立的地方在范围：前端校验只约束你自己的页面，而网络那一端谁都能来。curl 一行命令就绕过任何表单；本章 e2e 脚本对 /api/deploys 发的每个 POST，都是「绕过前端」的活例子。所以校验必须在系统边界再做一次——这一次才是权威的一次。

还有一层容易漏：TS 类型为什么救不了边界？类型是编译期契约，运行时就蒸发了——验证一节的实验二会让你亲眼看到，把共享类型改得面目全非，build 照样通过、e2e 照样全绿。请求体到达 handler 时，它的类型是 unknown：不是「还没标注」，是「无从谈起」——对面可能是浏览器、可能是 curl、可能是一段写错的脚本。把它变成可信数据的唯一机会，就是边界上的运行时校验。

## 演练：从三条红到全绿

本章门槛五条命令（都在 companion 目录执行，跨平台）：pnpm typecheck、pnpm test、pnpm build、pnpm e2e:ch1、pnpm e2e:ch2。前三条是静态检查与单测，后两条起真实生产进程断言行为。动手前先交代两件工具链的事，它们让 typecheck 与 test 从「名义存在」变成「真的能跑」。

第一，typecheck 需要工程根有一个 solution 式 tsconfig.json。它把 Nuxt 生成的四个项目配置（app、server、shared、node）用 references 串起来。

```jsonc
// companion/tsconfig.json · solution 式根配置：四个生成项目各管一摊
{
  "files": [],
  "references": [
    { "path": "./.nuxt/tsconfig.server.json" },
    { "path": "./.nuxt/tsconfig.shared.json" },
    { "path": "./.nuxt/tsconfig.node.json" },
    { "path": "./.nuxt/tsconfig.app.json" }
  ]
}
```

再配 5 行 golar.config.ts（typescript-go 原生检查器加 Vue 插件）。为什么是它：本课锁定的 TypeScript 7 是原生编译器，不再暴露 JS API，老的 vue-tsc 驱动不了它；Nuxt CLI 的原生检查器 golar 接手（package.json 新增 devDependency golar 与 @golar/vue）。缺这两个文件时 pnpm typecheck 的第一句报错就是 Cannot find matching tsconfig.json。

第二，pnpm test 此前一直空转：vitest 找不到任何测试文件，按 1 退出（真实输出：No test files found, exiting with code 1）。本章 tests/ 目录建立后，这条门槛才真正生效。

### 红一：接口不存在

先构建并启动生产进程。端口用 4172（本课约定应用测试统一用 4100 段端口）。

```bash
# 用法示例 · companion 目录内，两个终端
pnpm build
PORT=4172 HOST=127.0.0.1 node .output/server/index.mjs
```

对它发一个 GET /api/deploys，响应如下。

```text
# curl -s http://127.0.0.1:4172/api/deploys 的响应体
{
  "error": true,
  "url": "http://127.0.0.1:4172/api/deploys",
  "statusCode": 404,
  "statusMessage": "Page not found: /api/deploys",
  "message": "Page not found: /api/deploys",
  "data": { "path": "/api/deploys" }
}
```

404 是 Nitro 路由表在说话：server/api/ 下没有任何文件映射到这条路径，请求落在兜底的 404 处理器上。注意返回的还是结构化 JSON——/api/* 的消费者是程序不是人，报错也要可解析。此刻工程确实还没有后端，这就是起点。

### 红二：域逻辑不存在（测试先写）

测试先行。tests/deploys.test.ts 断言三件事：种子数据可读、创建时 id 服务端自增、读取返回副本。

```ts
// companion/tests/deploys.test.ts · 第 2 章形态（教学示意）：内存数组数据源 + resetDeploys 测试缝
// 第 4 章起数据源改为注入式仓库，隔离缝换成 new InMemoryDeploysRepo(seed)（终态见 docs/04-database-layer.md）
import { beforeEach, describe, expect, it } from 'vitest'
import { createDeploy, listDeploys, resetDeploys } from '../server/domain/deploys'

// 与首页展示一致的种子数据形状：3 条记录，id 从大到小
const seedCommits = ['77aa01f', 'd41e8c7', '9f3c2ab']

beforeEach(() => {
  resetDeploys()
})

describe('listDeploys', () => {
  it('返回全部种子数据，新记录在前（id 从大到小）', () => {
    const all = listDeploys()
    expect(all).toHaveLength(3)
    expect(all.map((d) => d.commit)).toEqual(seedCommits)
    expect(all[0]?.id).toBe(3)
  })

  it('返回的是副本：改动结果不影响下一次读取', () => {
    const all = listDeploys()
    all.pop()
    expect(listDeploys()).toHaveLength(3)
  })
})

describe('createDeploy', () => {
  it('为合法输入分配下一个 id，并把新记录放在最前', () => {
    const created = createDeploy({
      env: 'staging',
      status: 'success',
      commit: 'a1b2c3d',
      summary: '域逻辑测试：新增一条部署记录',
    })
    expect(created).toMatchObject({ id: 4, env: 'staging', commit: 'a1b2c3d' })
    expect(listDeploys()[0]?.id).toBe(4)
    expect(listDeploys()).toHaveLength(4)
  })

  it('连续创建时 id 依次递增', () => {
    createDeploy({ env: 'production', status: 'success', commit: 'aaaaaaa', summary: '第一条' })
    const second = createDeploy({ env: 'production', status: 'failed', commit: 'bbbbbbb', summary: '第二条' })
    expect(second.id).toBe(5)
  })
})
```

跑 pnpm test：

```text
# pnpm test 红跑（节选）
Error: Cannot find module '../server/domain/deploys' imported from
D:/.../companion/tests/deploys.test.ts
Test Files  1 failed (1)
```

红得其所：测试要的是「域逻辑存在且行为正确」，而它还不存在——不是路径拼错，不是环境问题。

最小实现两步。第一步 shared/types.ts（上一节已全文给出）。第二步 server/domain/deploys.ts：

```ts
// companion/server/domain/deploys.ts · 第 2 章形态（教学示意）：纯函数 + 内存数据源
// 第 4 章起数据源成为显式入参（DeploysRepo 接口），终态见 docs/04-database-layer.md
// 刻意不 import 任何 HTTP 概念（h3 的事件、请求、响应都不进这一层）——因此无需起服务器即可单测
import type { CreateDeployInput, DeployRecord } from '#shared/types'

// 数据源暂为模块级内存数组：进程启动时是种子数据，重启即归零（后续章节换成数据库）
const seed: DeployRecord[] = [
  { id: 3, env: 'production', status: 'success', commit: '77aa01f', summary: '备份脚本改用 pg_dump 归档格式' },
  { id: 2, env: 'production', status: 'success', commit: 'd41e8c7', summary: '健康检查超时从 3s 调到 10s' },
  { id: 1, env: 'staging', status: 'failed', commit: '9f3c2ab', summary: '首次部署：迁移失败，已回滚' },
]

let records: DeployRecord[] = [...seed]

// 测试隔离缝：重置回种子状态（内存数据源时期的测试专用入口）
export function resetDeploys(): void {
  records = [...seed]
}

export function listDeploys(): DeployRecord[] {
  return [...records]
}

export function createDeploy(input: CreateDeployInput): DeployRecord {
  const nextId = records.reduce((max, r) => Math.max(max, r.id), 0) + 1
  const record: DeployRecord = { id: nextId, ...input }
  records = [record, ...records]
  return record
}
```

注意 import 的是 `#shared/types`——域逻辑的输入输出形状来自共享定义，这就是「形状只写一次」落到代码里的样子。再跑 pnpm test：

```text
# pnpm test 转绿
 ✓ tests/deploys.test.ts (4 tests) 5ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

### GET 上桌：handler 六行，首页换数据源

路由层薄到只剩适配：

```ts
// companion/server/api/deploys.get.ts · 第 2 章形态（教学示意）：第 4 章起入参变为 useDeploysRepo()（终态见 docs/04-database-layer.md）
import { listDeploys } from '../domain/deploys'

export default defineEventHandler(() => {
  return listDeploys()
})
```

server/domain 不在任何自动导入名单里，import 显式写出——这一层的每个依赖都摆在明面上。首页从内联数据换成 useFetch：

```vue
<script setup lang="ts">
// companion/app/pages/index.vue · 首页：部署日志，数据来自 GET /api/deploys（SSR 期间在服务端完成请求）
import type { DeployRecord } from '#shared/types'

const { data: deploys } = await useFetch<DeployRecord[]>('/api/deploys')
</script>

<template>
  <section>
    <p>ship-log 记录每一次部署。数据来自 GET /api/deploys，SSR 期间由同一个 Node 进程里的 server/ 代码提供。</p>
    <table>
      <thead>
        <tr><th>#</th><th>环境</th><th>commit</th><th>结果</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr v-for="d in deploys ?? []" :key="d.id">
          <td>{{ d.id }}</td>
          <td>{{ d.env }}</td>
          <td><code>{{ d.commit }}</code></td>
          <td>{{ d.status === 'success' ? '成功' : '失败' }}</td>
          <td>{{ d.summary }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
```

SSR 期间 useFetch 在服务端执行，而且不出网卡：Nitro 在进程内直接调用 server/ 的 handler，拿到数据再渲染 HTML。构建后跑老门槛验证：

```text
# pnpm build && pnpm e2e:ch1 终态输出
[e2e:ch1] GET / → 200
[e2e:ch1] HTML 含 SSR 数据文本 "9f3c2ab" → PASS
[e2e:ch1] HTML 含 SSR 数据文本 "77aa01f" → PASS
[e2e:ch1] 全部断言通过 (4/4)
```

组装证据：e2e:ch1 一行未改，断言的是裸 HTML 含那两个 commit——数据从内联搬进了 API，SSR 承诺分毫未动。只换数据源，不动门面。

### 红三：POST 不设防

第一版 POST 凭手感写（失败样本，已被本章终版替换）：

```ts
// companion/server/api/deploys.post.ts · 第一版：无校验——用于观察失败行为（已被终版替换）
import { createDeploy } from '../domain/deploys'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const created = createDeploy(body)
  setResponseStatus(event, 201)
  return created
})
```

先猜：对它 POST 一个缺 summary 的请求，状态码是多少？三选一写下预测（400、500、201），构建后对生产进程实际发一次：

```text
# 缺 summary 的 POST（真实输出）
status: 201
{"id":4,"env":"production","status":"success","commit":"a1b2c3d"}

# commit 不是哈希的 POST（真实输出）
status: 201
{"id":5,"env":"production","status":"success","commit":"不是哈希","summary":"坏数据测试"}
```

201。脏数据照单全收：summary 缺了没人管，commit 是不是哈希也没人管。第二条脏记录随后就出现在首页的裸 HTML 里——fetch 不执行 JS，出现即服务端渲染，脏数据一路流到了用户眼前。更扎心的是另一行事实：pnpm typecheck 对这一版是绿的——readBody 的返回类型是 any，编译器对它失明。开篇的第二种死法（脏数据）与第三种死法（any 传染）在这一版里同时上演。

修复：门口装上 schema。本章终版全文（教学示意：第 4 章起 createDeploy 多一个仓库入参，终态见 docs/04-database-layer.md）：

```ts
// companion/server/api/deploys.post.ts · 第 2 章终版：请求校验在边界完成（readValidatedBody + zod）
import { z } from 'zod'
import { createDeploy } from '../domain/deploys'

// 系统边界的守门 schema：把 unknown 的请求体收窄成可信的 CreateDeployInput
// （枚举值与 shared/types.ts 保持一致；commit 是 7-40 位十六进制短哈希）
const createDeploySchema = z.object({
  env: z.enum(['production', 'staging']),
  status: z.enum(['success', 'failed']),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/, 'commit 必须是 7-40 位十六进制哈希'),
  summary: z.string().min(1).max(200),
})

export default defineEventHandler(async (event) => {
  // 校验失败（缺字段、格式不对）时 readValidatedBody 抛 400，进不了 createDeploy
  const input = await readValidatedBody(event, createDeploySchema.parse)
  const created = createDeploy(input)
  setResponseStatus(event, 201)
  return created
})
```

三处变化。schema 在一处声明形状与格式：枚举值、commit 的 7-40 位十六进制、summary 非空且不超 200 字。readValidatedBody 把读体与校验合成一步：解析失败或 schema 不通过时，h3（Nitro 用的 HTTP 工具库，本课锁定 1.15）自动抛 400。parse 之后的 input 类型自动收窄为 schema 的输出，喂给 createDeploy 时与 CreateDeployInput 严丝合缝。构建后对照三连（真实输出，均对生产进程）：

```text
# POST 合法输入 → 201，id 由服务端分配
{"id":4,"env":"staging","status":"success","commit":"a1b2c3d","summary":"验证后的第一条"}

# POST 缺 summary → 400，message 是结构化的 zod 问题清单（节选）
"statusCode": 400, "statusMessage": "Validation Error"
"message": "[{ \"code\": \"invalid_type\", \"path\": [\"summary\"],
  \"message\": \"Invalid input: expected string, received undefined\" }]"

# POST commit 非十六进制 → 400，带上 schema 里写的人话提示
"message": "... \"path\": [\"commit\"], \"message\": \"commit 必须是 7-40 位十六进制哈希\" ..."
```

400 的响应体不是一句「出错了」：message 里的清单逐字段给出 path 与原因，调用方能程序化地知道错在哪。body 连 JSON 都不是时也得到干净的 400（Invalid JSON body）。数据源这回干净了：三个非法请求一个都没进店，GET 仍是 3 条种子加 1 条合法新记录。

### e2e:ch2：把行为钉进门槛

手工验证会烂掉，门槛不会。新增 scripts/e2e-ch2.mjs。控制流与 e2e-ch1 同款：断言失败抛专用错误——直接 process.exit 会跳过收尾；catch 记录并置退出码；finally 杀进程、验端口；exit 事件再兜底杀一次。断言六件事，两个关键片段如下。

```js
// companion/scripts/e2e-ch2.mjs · 片段一：合法 POST 必须拿到服务端分配的 id
    res = await post({ env: 'staging', status: 'success', commit: POSTED_COMMIT, summary: 'e2e 第 2 章：新增一条部署记录' })
    if (res.status !== 201) fail(`期望 201，实际 ${res.status}`)
    const created = await res.json()
    if (created.id !== 4 || created.commit !== POSTED_COMMIT) {
      fail(`期望 {id: 4, commit: "${POSTED_COMMIT}"}，实际：${JSON.stringify(created)}`)
    }
```

```js
// companion/scripts/e2e-ch2.mjs · 片段二：缺字段 POST 必须 400，且错误指向缺失字段
    res = await post({ env: 'production', status: 'success', commit: POSTED_COMMIT })
    if (res.status !== 400) fail(`期望 400，实际 ${res.status} —— 非法输入没有在边界被拦截。`)
    const errBody = await res.json()
    const pointsToField = errBody?.error === true && JSON.stringify(errBody).includes('summary')
```

package.json 登记 e2e:ch2，跑门槛，输出如下。

```text
# companion 门槛 pnpm build && pnpm e2e:ch2 终态输出（第 4 章起首行多一步库重置）
[e2e:ch2] 开发库已重置为 3 条种子记录
[e2e:ch2] GET /api/deploys → 200
[e2e:ch2] 种子记录含 "9f3c2ab" → PASS
[e2e:ch2] 种子记录含 "77aa01f" → PASS
[e2e:ch2] POST 合法输入 → 201
[e2e:ch2] POST 后 GET 读回新记录 (共 4 条) → PASS
[e2e:ch2] 首页裸 HTML 含新记录 "a1b2c3d" → PASS
[e2e:ch2] POST 缺 summary → 400
[e2e:ch2] 400 响应体指向缺失字段 summary → PASS
[e2e:ch2] 生产进程已退出 (pid 32492, code=null, signal=SIGTERM)
[e2e:ch2] 端口 4172 不再监听 → PASS
[e2e:ch2] 全部断言通过 (6/6)
```

留一个断言单独说：a1b2c3d 是 POST 刚写进数据源的记录，它出现在 fetch 到的裸 HTML 里——写接口与页面渲染，读的是同一个进程里的同一份数据。**这就是「server/ 即 TS 后端」的机械化证据：不是两个服务在配合，是一个 Nitro 进程的两只手。**

## 验证：先猜，再跑

实验一：三种请求与数据源的一生。起生产进程（红一的启动命令），先把三个预测写在纸上——合法 POST、缺 summary 的 POST、commit 为 zzzzzzz 的 POST，状态码各是多少？再逐个发：

```bash
# 用法示例 · 第二个终端（Git Bash）
curl -s -w '\n%{http_code}\n' -X POST http://127.0.0.1:4172/api/deploys \
  -H 'content-type: application/json' \
  -d '{"env":"production","status":"success","commit":"a1b2c3d","summary":"手工验证"}'
```

对照：201（响应体带 id: 4）、400、400。把第三个请求的 commit 换成 zzzzzzz 再发一次，观察 400 响应体里 path 指向 commit、message 是 schema 里写的那句人话。接着做两件小事：pnpm dev 起开发服务器，curl http://localhost:3000/api/deploys——同样的 JSON，开发与生产同一套代码的口径当场兑现；把生产进程 Ctrl+C 杀掉再启动，GET /api/deploys——先猜新记录还在不在。本章内存数据源时点的对照是只剩 3 条种子：数组随进程生死，它守的是「域逻辑可测」，不守「数据持久」（教学示意；数据源换成 PostgreSQL 后这道题的答案翻转——新记录活过进程死亡，终态见 docs/04-database-layer.md）。

实验二（定向破坏 A）：共享类型的双向哨。把 shared/types.ts 里两处 `summary: string`（DeployRecord 与 CreateDeployInput 各一处）都改成 `note: string`。先写两个预测：pnpm typecheck 会在几个文件报错？pnpm build 与两条 e2e 各是什么结局？

对照：typecheck 红在恰好 3 个文件。server/domain/deploys.ts——三条种子记录的字段对不上新形状；server/api/deploys.post.ts——schema 的输出喂不进新的输入类型；app/pages/index.vue——模板里的 d.summary 不存在了。一个文件的改动，后端与前端同时亮红，这就是「形状只写一次」的机器对账。而 build 与两条 e2e 全绿：类型只在编译期存在，运行时无人检查。这个对照同时给两个结论——typecheck 这道哨不能拆（漂移全靠它拦）；数据在运行时是否可信与它无关（那是校验层的活）。复原：改回 summary，确认 typecheck 回绿。

实验三（定向破坏 B）：拆掉边界。把 server/api/deploys.post.ts 里的这一行：

```ts
  const input = await readValidatedBody(event, createDeploySchema.parse)
```

换成 `const input = await readBody(event)`（只改这一行）。先猜两件事：pnpm typecheck 绿还是红？pnpm build && pnpm e2e:ch2 停在第几条断言？

对照：typecheck 绿——readBody 是 any，编译器照旧失明。e2e:ch2 一路绿到「POST 缺 summary → 201」才红：期望 400，实际 201，恰好一条断言亮红——它守的是边界；「POST 合法输入 → 201」那条照样绿，它守的是正常写入。红在哪一行，问题就在哪一层，这是分层断言的回报。亮红之后的收尾两行（进程已退出、端口不再监听）照样走完。复原后重跑，6/6。

## 收束：一个进程的两只手

开篇的三种死法现在能整段对症了。500 的病根是手拼字符串：server API 的 handler 里你只声明形状，序列化交给框架。脏数据的病根是边界无守门人：请求校验在外部输入进业务逻辑之前把它拦下，400 带着逐字段的结构化清单。any 满天飞的病根是形状没有单一事实源：共享类型让两侧在同一份定义上对账，改一处、前后端同时红。三块积木的组装式：**server API（路由与序列化）+ 共享类型（编译期对账）+ 请求校验（运行时守门）⇒ 同一个 Nitro 进程里类型安全的 TS 后端**。它没有产生第二个要部署的东西——生产构建出的那个自包含 .output（第 1 章）现在装下的是整个应用，页面与后端一体交付、整体替换。

本章拿到的积木，后面每一章都在用：

- server API——server/api/ 下文件路径即路由，defineEventHandler 导出处理器；
- 共享类型——shared/ 一份定义、两侧 import，改一处两侧同时亮红；
- 请求校验——readValidatedBody 加 zod 在边界拦截，非法输入 400。

两条去向，各一行：数据源从内存数组换成 PostgreSQL（第 4 章）；运行时配置与环境变量如何注入同一个产物（第 3 章）。

## 自查

先自己写下答案，再展开对照；答不上来就按提示回查。

<details>
<summary>1. 要新增 GET /api/deploys/stats（返回成功与失败的部署数），需要动哪几个文件？要在哪里「注册路由」吗？</summary>

两个文件：server/api/deploys/stats.get.ts 新增处理器（目录层级即路径层级）；server/domain/deploys.ts 加一个纯函数算汇总。不需要任何注册：文件路径即路由，这是 server API 约定的核心。回查「server API：文件路径即路由」。
</details>

<details>
<summary>2. 前端表单已经用 zod 做了即时校验，用户不可能从页面提交缺 summary 的请求。服务端的 readValidatedBody 还要不要？给出一个能绕过前端校验的具体发法。</summary>

要。前端校验只约束自己的页面；curl 或任何脚本都能直接对 /api/deploys 发 POST——本章 e2e 与验证实验一的每个请求都是这么发的。校验的权威位置在系统边界，也就是服务端入口。回查「三层分工」一节关于校验范围的论证。
</details>

<details>
<summary>3. 域逻辑层的单测为什么不需要起服务器、也不需要 mock？如果把创建逻辑直接写进 handler（用 readBody 拿 any 再拼对象），测试要多付出什么？</summary>

域逻辑是不 import HTTP 概念的纯函数，行为只依赖入参，测试就是普通函数调用。写进 handler 后，逻辑依赖 event 与 Nitro 运行时，测试要么起真实服务器走 HTTP，要么 mock 整个事件对象——而且 any 入口让拼错字段也测不出来。回查「三层分工」。
</details>

<details>
<summary>4. POST 成功后重启生产进程，新记录消失了。这是 bug 吗？哪一层负责这件事，换实现时其余层要改吗？</summary>

不是 bug，是内存数据源的生命周期：随进程生死（教学示意：数据源换成 PostgreSQL 后，重启不再丢记录——数据活过进程死亡，终态见 docs/04-database-layer.md）。数据怎么存、存多久是数据源层的职责；域逻辑与 handler 依赖的是它的接口行为，换实现时这两层不动。回查「演练」红二一节与验证实验一。
</details>
