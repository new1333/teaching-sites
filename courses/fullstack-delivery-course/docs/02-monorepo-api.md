---
title: 工程骨架：monorepo 与第一个 HTTP API
---

# 工程骨架：monorepo 与第一个 HTTP API

打开你手边任何一个前端项目，全局搜一下 fetch，多半能搜出几十处。每一处的姿势高度一致：给一个 URL、给一个 body，等一个 JSON 回来。

Network 面板把这条交互压成了一行：请求成功了，201。你看得出它是绿的，却看不出 201 是谁回的。请求钻进端口之后：是谁在读 body？是谁在校验参数？又是谁决定这次回 302、下次回 404？

这些问题在前端视角里没有答案，因为服务器那边一直是黑盒：一个 baseURL，一个会吐 JSON 的东西。本书的载体是短链服务——用户提交一个长网址，服务生成七位短码；任何人访问短链，服务回 302 把浏览器送去原网址。这一章你来当接电话的人：从空目录搭出工程骨架，让「会吐 JSON 的东西」变成你亲手写的几百行 TypeScript。

接完这通电话，fetch 的两端你就都站过了。

## 原理：四个名字，各守一道门

本章代码量不大，但四个名字要先立住：端点、请求校验、共享契约、CORS——它们分别回答四个问题：请求由谁接、输入信不信、类型谁说了算、浏览器放不放行。载体是同一个：一个 pnpm workspace 的 monorepo（一个 git 仓库里装多个包的工程形态），三个包分别叫 shared、api、web。

### 端点：前后端之间的函数签名

先定位：本章写的代码全部住在应用进程里——请求旅程第三站那个常驻内存、监听端口的进程（[第 1 章](./01-request-journey)）。以前你隔着 Network 面板看它，现在要进去写它。

端点（endpoint）是服务端暴露的一个「URL + HTTP 方法」组合——HTTP API 的最小交互单元，规定这一次调用允许给什么输入、会回什么输出。它就是前后端之间的函数签名：你写 fetch 时填的 URL 与方法，正是在点名要哪个端点接电话。

本章要立起三个端点：

| 端点 | 输入 | 输出 |
| --- | --- | --- |
| GET /healthz | 无 | 200，`{status:"ok"}` |
| POST /api/links | body `{url}` | 201 `{slug,url,createdAt}`；不合法 422 `{error:{field,message}}` |
| GET /:slug | 路径里的短码 | 命中 302，Location 为原网址；未命中 404 |

反过来看：不立这层约定，每个调用者都只能靠猜——猜拼写、猜方法、猜 body 字段。猜错的样子，就是你在 Network 面板里偶尔看到的 404 与 400。端点把「猜」变成「查」。

### 请求校验：门口的第一道检查

先替一个流行的直觉说句公道话：「校验是前端表单的事，后端拿到 body 直接用」。这个直觉有来处：表单校验确实该在前端做——即时反馈、省一次请求，体验上完全正确；而且日常项目里后端多半是同事写的，你从不需要关心它信不信你。

边界出在「谁能发请求」。前端校验只挡得住经过你页面的调用，挡不住 curl、脚本、任何人写的另一个页面——它们绕过表单，把任意 JSON 直接扔到你的端口上。端口暴露在网络上，请求天然不可信。

不可信的请求直接进业务逻辑，坏法很具体。设想 url 字段存进了 `not-a-url`：创建照样成功，短链照样生成；直到第一个用户点它，302 的 Location 是一串垃圾，浏览器报「无效地址」。**脏数据不在进来的那一刻爆炸，而在被使用的每一次爆炸**——校验的价值就是把爆炸提前到门口。

请求校验（request validation）就是在业务逻辑之前，用一份 schema 声明请求体该长什么样——字段、类型、格式——不合法当场拒绝，回 422 与出错字段。本章用 zod 写 schema：一次声明，机器执行。状态码选 422 而不是 400，是因为请求在语法上是合法 JSON、只是语义过不了约束——这是社区常见的细分习惯，不是规范强制。

### 共享契约：一份 schema，两侧使用

再看第二个直觉：「前后端各写一份一样的 interface，就叫共享类型」。复制粘贴的那天它们确实一模一样，小项目靠这个也能过很久——这个直觉在「没有变更」的世界里完全成立。

问题出在第一次变更。后端把 slug 改名成 id：后端那份 interface 同步改了、编译绿了；前端那份纹丝不动——也编译绿了。两份类型之间没有任何机器强制同步，同步靠人记，人记会漏。漏掉的那次就是上线后才炸的那次：类型说没有这个字段，运行时的数据里全是。

共享契约（shared contract）是把前后端共用的形状收进一个独立的包——本章的 `packages/shared`——schema 用 zod 写一遍，再用 z.infer 推导出 TypeScript 类型。后端 import 它校验请求；前端 import 同一个推导类型，并用同一个 schema 在运行时校验响应。字段改名时，编译器同时抓住两边。**单一事实源的意思，是「改」这个动作只剩一个可改的地方**。

装下第三个包，就需要 monorepo。pnpm workspace 用 `pnpm-workspace.yaml` 声明包的位置，包之间用 `workspace:*` 协议互相引用——不是从 npm 下载，而是直接链接本地目录。你天天用的包管理器，换了个形态而已。

三个包的关系值得点破：创建短链的能力 = shared 定型（schema 管形状）+ api 执行（端点管行为）+ web 消费（页面管交互）——三个包各拿走一层，谁也不兼职别人的活。

### CORS：浏览器保安与通行证

第四个名字要提前打招呼：本章你会亲手撞上一次 CORS 报错，原文长得吓人。先讲清它是谁、为谁工作，撞上时你才知道自己在看什么。

浏览器是个大杂居的环境：任何网站的 JavaScript 都跑在同一个浏览器里，而 Cookie、localStorage 这些凭据按网站存放。如果毫无限制，你开着网银标签页时打开一个恶意页面，它的脚本就能静默向网银发请求、读走响应。所以浏览器内置一条保安纪律——同源策略：页面里的脚本默认只能读取同源（same origin，即协议、域名、端口三者完全一致）的响应。开发时页面开在 5174 端口、API 开在 4510 端口，端口不同，就是跨源。

CORS（Cross-Origin Resource Sharing，跨源资源共享）是这套纪律的放行通道。服务端在响应头里写 `Access-Control-Allow-Origin` 等字段，显式授权某个源可以读自己的响应——保安是浏览器雇的，通行证由服务端签发，两边缺一不可。

放行前还有一道手续。带 `content-type: application/json` 的 POST 不属于浏览器眼里的「简单请求」：浏览器先发一个 OPTIONS 请求做预检（preflight），问服务器「这个方法、这些头你允许吗」。服务器要在 OPTIONS 的响应头里给出授权，真正的 POST 才会发出。本章的 API 没配任何 CORS 头，预检拿不到授权，POST 根本发不出去。

两条边界钉死。其一，CORS 只约束浏览器：curl、Node 脚本、服务端之间的调用完全不受同源策略管——同一个请求，curl 是 201，浏览器拦。其二，它管的是「页面脚本读响应」，不管导航：地址栏输入、点链接跳转，跨源照样走——所以短链放在另一个端口上也点得开，但页面里的 fetch 读不到它的响应。

开发期的解法不是补通行证，而是让请求根本不跨源：Vite 的 `server.proxy` 把 `/api` 前缀的请求由开发服务器转发给 API。浏览器眼里全程同源；转发发生在两个服务进程之间，Node 对 Node，没有保安。生产期有两条路：后端按白名单回 CORS 头（Hono 有现成的 cors 中间件），或前后端同域部署、从根上消灭跨源——本课走后者，统一入口见（[第 9 章](./09-deploy-https)）。

### 两个刻意的小决定

先说破两个简化，免得留疑。

其一，短链存在进程内存的一个 Map 里。拿无状态服务的判断口径自查（[第 1 章](./01-request-journey)）：进程重启后短链该不该还在？该在。所以 Map 是权宜，重启即丢——本章先把端点与契约立稳，存储换成活得比进程久的形态是下一站（[第 3 章](./03-persistence)）。

其二，`GET /healthz` 只答 `{status:"ok"}`，是浅检查：它证明进程活着，不证明数据库、缓存这些依赖可用。「活着」与「可用」是两种健康，本章只需要回答前者。

## 演练：从红到绿搭起来

本课的代码住在伴生仓 companion——你跟着敲，也跟着跑同一条测试门槛；每段代码首行标注它在伴生仓里的真实路径。环境要求：Node 22 与 pnpm 10（本课验证环境 2026-09 时点为 Node 22.22.2）。命令在 Windows 的 Git Bash 与 PowerShell 里都能跑；PowerShell 里请用 `curl.exe` 而非 `curl`——那个 `curl` 是 Invoke-WebRequest 的别名，参数不通用。

依赖版本如下（2026-09 时点安装结果，以伴生仓 pnpm-lock.yaml 固定为准；依赖会过期，lockfile 不会）：

| 依赖 | 版本 | 角色 |
| --- | --- | --- |
| typescript | 7.0.2 | 编译期检查（tsc --noEmit） |
| vitest | 5.0.0 | 测试运行器 |
| zod | 4.5.4 | schema 声明与校验 |
| hono | 4.13.7 | HTTP 框架 |
| @hono/node-server | 2.1.1 | 把 Hono 接到 Node 的 http 模块 |
| nanoid | 6.0.1 | 生成七位短码 |
| vue | 3.5.42 | 页面框架 |
| vite | 8.2.2 | 开发服务器、代理与构建 |
| tsx | 4.23.13 | 直跑 TS，开发期免预编译 |
| concurrently | 10.0.5 | 一条命令同屏起 api 与 web |

### 第一步：根骨架三件套

新建目录，先放三个文件。根 package.json：

```jsonc
// companion: package.json（根）
{
  "name": "shortlink",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -n api,web -c blue,green \"pnpm --filter @shortlink/api dev\" \"pnpm --filter @shortlink/web dev\"",
    "build": "pnpm -r --if-present build",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck"
  },
  "devDependencies": {
    "concurrently": "^10.0.5",
    "tsx": "^4.23.13",
    "typescript": "^7.0.2",
    "vitest": "^5.0.0"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild"]
  }
}
```

四条脚本就是全仓的门面：dev 同屏起两个进程，test 与 typecheck 递归跑进每个包。`pnpm.onlyBuiltDependencies` 是说给 pnpm 听的：它默认禁止依赖执行安装脚本（安全默认），而 esbuild 要靠脚本装平台二进制——不放行它，vitest 与 tsx 起不来。

```yaml
# companion: pnpm-workspace.yaml
packages:
  - packages/*
  - apps/*
```

```jsonc
// companion: tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

各包的 tsconfig 只做两件事：`"extends": "../../tsconfig.base.json"`，再按需微调——api 加 `"types": ["node"]`（要用 process.env），web 把 lib 换成 DOM 一套（页面代码）。顺手放一个 `.gitignore`，忽略 `node_modules/`、`dist/`、`coverage/`。然后在目录里执行 `pnpm install`。

### 第二步：shared 包，先让测试红

```jsonc
// companion: packages/shared/package.json
{
  "name": "@shortlink/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "zod": "^4.5.4"
  },
  "exports": {
    ".": "./src/index.ts"
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

exports 直接指向 TS 源文件——内部包（internal package）模式：shared 不发布、不编译，api、web、vitest、tsc 都直接吃源码。省掉一条构建链，换来「改 schema 立刻全仓生效」。

先给 `src/index.ts` 立个空占位 `export {}`，再写测试。为什么空着：这一章的方法是先立判据、后写实现——测试要红，且红的原因必须是「能力还不存在」，而不是语法错、路径错。

```ts
// companion: packages/shared/src/schema.test.ts · createLinkSchema 四条
import { describe, expect, it } from 'vitest'
import { createLinkSchema, linkResponseSchema, validationErrorSchema } from './index'

describe('createLinkSchema', () => {
  it('接受 https 网址', () => {
    const result = createLinkSchema.safeParse({ url: 'https://example.com/a?b=1' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.url).toBe('https://example.com/a?b=1')
    }
  })

  it('缺 url 拒绝，错误定位在 url 字段', () => {
    const result = createLinkSchema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path[0]).toBe('url')
    }
  })

  it('http 网址拒绝（必须 https）', () => {
    const result = createLinkSchema.safeParse({ url: 'http://example.com' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path[0]).toBe('url')
    }
  })

  it('非 URL 字符串拒绝', () => {
    expect(createLinkSchema.safeParse({ url: 'not-a-url' }).success).toBe(false)
  })
})
```

断言的重点在 `issues[0]?.path[0]`：出错的不是笼统的「整个请求」，而是能点名到字段。文件里另有 linkResponseSchema 与 validationErrorSchema 的四条同构断言（形状通过、缺字段拒绝），见伴生仓同一文件。

跑 `pnpm --filter @shortlink/shared test`：

```text
FAIL  src/schema.test.ts > createLinkSchema > 接受 https 网址
TypeError: Cannot read properties of undefined (reading 'safeParse')
Tests  8 failed (8)
```

八条全红，红因单一：schema 还没写。

### 第三步：写 schema，转绿

```ts
// companion: packages/shared/src/index.ts
import { z } from 'zod'

/** 创建短链的请求体：url 必须是 https 协议的合法网址 */
export const createLinkSchema = z.object({
  url: z.url({ protocol: /^https$/ }),
})

/** POST /api/links 的成功响应：一条短链记录 */
export const linkResponseSchema = z.object({
  slug: z.string(),
  url: z.string(),
  createdAt: z.string(),
})

/** 校验失败（422）的响应：第一个出错字段的定位与原因 */
export const validationErrorSchema = z.object({
  error: z.object({
    field: z.string(),
    message: z.string(),
  }),
})

export type CreateLinkInput = z.infer<typeof createLinkSchema>
export type LinkResponse = z.infer<typeof linkResponseSchema>
export type ValidationError = z.infer<typeof validationErrorSchema>
```

`z.url({ protocol: /^https$/ })` 一行表达两件事：是合法 URL，且协议必须是 https。底下的 z.infer 是共享契约的枢纽：类型从 schema 推导——类型成了 schema 的影子，影子不会跟本体吵架。再跑测试：8 passed。从红到绿，shared 侧完工。

### 第四步：api 包，让 404 说话

```jsonc
// companion: apps/api/package.json
{
  "name": "@shortlink/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@hono/node-server": "^2.1.1",
    "@shortlink/shared": "workspace:*",
    "hono": "^4.13.7",
    "nanoid": "^6.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0"
  }
}
```

`"@shortlink/shared": "workspace:*"` 就是上一节说的链接本地目录——shared 的源码进了 api 的依赖树，改一处、两边立刻看得见。

e2e 测试不走 mock：用 @hono/node-server 起一个真实 HTTP 服务，端口给 0（由操作系统分配临时端口），fetch 全程走网络栈。这是测试隔离的惯例：不占固定端口，与你正在跑的 dev 服务互不打扰。

```ts
// companion: apps/api/src/app.test.ts · 起服务与收尾
import { afterAll, describe, expect, it } from 'vitest'
import { serve } from '@hono/node-server'
import { createApp } from './app'

const server = serve({ fetch: createApp().fetch, port: 0 })
const address = server.address()
if (!address || typeof address === 'string') {
  throw new Error('expected the test server to listen on an ephemeral port')
}
const base = `http://127.0.0.1:${address.port}`

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// res.json() 的类型是 unknown，测试里按需收窄成宽松的 JSON 形状
const json = (res: Response) => res.json() as Promise<Record<string, any>>
```

断言侧挑最承重的一组看（healthz、302 与 404 的断言同构，见伴生仓同一文件）：

```ts
// companion: apps/api/src/app.test.ts · POST /api/links 的三条断言
describe('POST /api/links', () => {
  const postLink = (body: unknown) =>
    fetch(`${base}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('合法请求返回 201，body 含 slug/url/createdAt', async () => {
    const res = await postLink({ url: 'https://example.com/very-long-path' })
    expect(res.status).toBe(201)
    const body = await json(res)
    expect(body.url).toBe('https://example.com/very-long-path')
    expect(typeof body.slug).toBe('string')
    expect(body.slug).toHaveLength(7)
    expect(typeof body.createdAt).toBe('string')
  })

  it('缺 url 返回 422 且 error.field 为 "url"', async () => {
    const res = await postLink({})
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error?.field).toBe('url')
    expect(typeof body.error?.message).toBe('string')
    expect(body.error?.message.length).toBeGreaterThan(0)
  })

  it('http 网址（非 https）返回 422', async () => {
    const res = await postLink({ url: 'http://example.com' })
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error?.field).toBe('url')
  })
})
```

此刻 `src/app.ts` 里只有一个空壳：createApp 返回一个没注册任何路由的 Hono 实例。跑 `pnpm --filter @shortlink/api test`，同一次运行整理后：

```text
× 返回 200 与 {status:"ok"}        expected 404 to be 200
× 合法请求返回 201                 expected 404 to be 201
× 缺 url 返回 422                  expected 404 to be 422
× http 网址（非 https）返回 422    expected 404 to be 422
× 命中返回 302 且 Location 指向原网址    SyntaxError: Unexpected non-whitespace character after JSON at position 4
✓ 未知 slug 返回 404
Tests  5 failed | 1 passed (6)
```

五条红全是同一个原因：端点不存在，Hono 对未匹配的路径回默认 404。最后一条红的报错看起来最吓人（SyntaxError），其实根因相同：这条测试先 `await json(res)` 再断言 302，而 404 的响应体是一段纯文本，JSON 解析先炸了——错误身份不同，病灶仍是端点缺失。有一条居然绿了——「未知 slug 返回 404」：空应用对一切路径都 404，恰好喂饱它。这不是测试写错，而是提醒：绿要有绿的理由。实现补上之后，这条断言守的才是「查过表、确实没有」的 404。

### 第五步：实现三个端点

```ts
// companion: apps/api/src/app.ts · createApp
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { createLinkSchema, type LinkResponse } from '@shortlink/shared'
import { createMemoryStore, type LinkStore } from './store'

export function createApp(store: LinkStore = createMemoryStore()) {
  const app = new Hono()

  // 浅检查：进程活着就答 ok
  app.get('/healthz', (c) => c.json({ status: 'ok' }))

  app.post('/api/links', async (c) => {
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
    const link: LinkResponse = {
      slug: nanoid(7),
      url: parsed.data.url,
      createdAt: new Date().toISOString(),
    }
    await store.put(link)
    return c.json(link, 201)
  })
```

逐处看关键行。`c.req.json().catch(() => null)`：body 不是合法 JSON 时也得走校验，而不是抛 500。safeParse 失败时取第一个 issue，`path`（出错位置，如 `['url']`）拼成字段名，`message` 原样透传——这就是 422 里 `error.field` 的出处。`const link: LinkResponse` 的类型标注是契约在 api 侧的落点：shared 改名，这一行立刻编译红。nanoid(7) 生成七位短码（大小写字母、数字，外加 `-` 和 `_`，共 64 个候选字符）。

```ts
// companion: apps/api/src/app.ts · createApp（续）
  app.get('/:slug', async (c) => {
    const link = await store.get(c.req.param('slug'))
    if (!link) {
      return c.json({ error: 'not found' }, 404)
    }
    return c.redirect(link.url, 302)
  })

  return app
}
```

注册顺序在这里是承重细节：`/healthz` 必须先注册——`/:slug` 是单段通配，写在前面会把 healthz 当短码吃掉。`c.redirect(url, 302)` 回跳转响应，Location 头指向原网址。

```ts
// companion: apps/api/src/store.ts · LinkStore 与 createMemoryStore
import type { LinkResponse } from '@shortlink/shared'

/**
 * 注入缝：端点只依赖这两个方法。
 * 返回值同时放行同步值与 Promise——存储住在进程内时同步（内存 Map），
 * 搬到进程外时异步（数据库）。await 一个普通值会原样通过，两种实现共用同一份端点代码。
 */
export interface LinkStore {
  put(link: LinkResponse): LinkResponse | Promise<LinkResponse>
  get(slug: string): LinkResponse | undefined | Promise<LinkResponse | undefined>
}

export interface MemoryStore {
  put(link: LinkResponse): LinkResponse
  get(slug: string): LinkResponse | undefined
}

export function createMemoryStore(): MemoryStore {
  const links = new Map<string, LinkResponse>()
  return {
    put(link) {
      links.set(link.slug, link)
      return link
    },
    get(slug) {
      return links.get(slug)
    },
  }
}
```

存储收窄成 put 与 get 两个方法、由 createApp 的参数注入，接口就是上面那道 LinkStore 缝。它的返回值同时放行同步与 Promise，端点处一个 await 通吃。将来把 Map 换成数据库时，端点的行为契约一行不改，换的只是这个工厂（[第 3 章](./03-persistence)）。跑 `pnpm test`：shared 8 条、api 6 条，全绿。

### 第六步：起服务，curl 打一遍

```ts
// companion: apps/api/src/main.ts · 启动入口（本章形态：内存版——教学示意；
// 第 3 章接入 PostgreSQL 后，此处改为注入 PgStore，终态见彼章演练）
import { serve } from '@hono/node-server'
import { createApp } from './app'

const port = Number.parseInt(process.env.PORT ?? '4510', 10)

serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
})
```

`pnpm --filter @shortlink/api dev`（tsx watch 直跑 TS，存盘即重启），另开一个终端：

```text
$ curl http://localhost:4510/healthz
{"status":"ok"}
```

```text
$ curl -X POST http://localhost:4510/api/links \
    -H "content-type: application/json" \
    -d '{"url":"https://example.com/dev-smoke"}'
{"slug":"zME9vk7","url":"https://example.com/dev-smoke","createdAt":"2026-09-09T02:15:35.446Z"}
```

```text
$ curl -i http://localhost:4510/zME9vk7
HTTP/1.1 302 Found
location: https://example.com/dev-smoke
```

第三个命令的 `-i` 让你亲眼看到 `HTTP/1.1 302 Found` 与 location 头——浏览器跳转时收到的就是这两行。

### 第七步：web 页面，把两端连起来

```ts
// companion: apps/web/vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:4510',
    },
  },
})
```

proxy 一行就是 CORS 一节说的「开发期回同源」：页面只跟 5174 说话，`/api` 的转发在服务端发生。

```ts
// companion: apps/web/src/api.ts
import {
  linkResponseSchema,
  validationErrorSchema,
  type LinkResponse,
} from '@shortlink/shared'

const apiOrigin = 'http://localhost:4510'

/** 短链的完整 URL：导航跨源不受 CORS 限制，可以直接点开 */
export function shortUrlOf(link: LinkResponse): string {
  return `${apiOrigin}/${link.slug}`
}

export async function createLink(url: string): Promise<LinkResponse> {
  const res = await fetch('/api/links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (res.status === 422) {
    const body = validationErrorSchema.parse(await res.json())
    throw new Error(`${body.error.field}：${body.error.message}`)
  }
  if (!res.ok) {
    throw new Error(`创建失败（HTTP ${res.status}）`)
  }
  return linkResponseSchema.parse(await res.json())
}
```

注意前端不只是「发契约」，也「验契约」：422 的 body 用 validationErrorSchema 解析，成功响应用 linkResponseSchema 再校验一遍。后端哪天手滑回了个坏形状，页面在 parse 处当场抛错，而不是渲染出幽灵数据。shortUrlOf 与 createLink 的返回类型都压在 LinkResponse 上——web 侧的编译期防线落在这两行。

```vue
<script setup lang="ts">
// companion: apps/web/src/App.vue
import { ref } from 'vue'
import type { LinkResponse } from '@shortlink/shared'
import { createLink, shortUrlOf } from './api'

const url = ref('')
const links = ref<LinkResponse[]>([])
const error = ref('')

async function submit() {
  error.value = ''
  try {
    const link = await createLink(url.value)
    links.value = [link, ...links.value]
    url.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <main>
    <h1>shortlink 短链工作台</h1>
    <form @submit.prevent="submit">
      <input v-model="url" placeholder="https://example.com/very-long-url" size="40" />
      <button type="submit">创建短链</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
    <ul>
      <li v-for="link in links" :key="link.slug">
        <a :href="shortUrlOf(link)" target="_blank" rel="noopener">{{ shortUrlOf(link) }}</a>
        → {{ link.url }}
        <small>（创建于 {{ link.createdAt }}）</small>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.error {
  color: #c0392b;
}
</style>
```

一个组件、三份状态：输入框、列表、错误文案——教学页面的最小形态。根目录跑 `pnpm dev`：

```text
$ pnpm dev
[web]   VITE v8.2.2  ready in 431 ms
[web]   ➜  Local:   http://localhost:5174/
[api] api listening on http://localhost:4510
```

打开 http://localhost:5174，输入 `https://example.com/very-long-article`，点「创建短链」——列表里出现一条 localhost:4510 开头的短链。点它：新标签的地址栏先经过短链、最终停在原网址；DevTools 的 Network 里第一条响应就是 302。这一跳，是全书地图第三站的端到端实弹。

### 第八步：契约的编译期闸门

```ts
// companion: apps/api/src/contract.test-d.ts
import { expectTypeOf } from 'vitest'
import type { CreateLinkInput, LinkResponse } from '@shortlink/shared'
import { linkResponseSchema } from '@shortlink/shared'
import { createMemoryStore } from './store'

// 编译期断言（pnpm typecheck 执行，不产生运行时测试）：
// shared 的推导类型就是前后端共用的唯一契约形状。
expectTypeOf<CreateLinkInput>().toEqualTypeOf<{ url: string }>()
expectTypeOf<LinkResponse>().toEqualTypeOf<{
  slug: string
  url: string
  createdAt: string
}>()

// api 侧消费：存入与取出的每条短链都按 LinkResponse 定型。
const store = createMemoryStore()
expectTypeOf(store.get('a1b2c3d')).toEqualTypeOf<LinkResponse | undefined>()

// schema 与类型来自同一个源：parse 的返回值就是 LinkResponse 本身。
expectTypeOf(linkResponseSchema.parse).returns.toEqualTypeOf<LinkResponse>()
```

文件名带 `.test-d.`，vitest 不会把它当运行时测试收走；tsc 会检查它。expectTypeOf 断言「推导类型与这个名字完全同形」——api 侧与 web 侧各有一条编译期防线，验证槽里你会亲手看到它们同时亮红灯。

### 门槛

在 companion 目录里：

```text
$ pnpm typecheck
packages/shared typecheck: Done
apps/api typecheck: Done
apps/web typecheck: Done
$ pnpm test
packages/shared  Tests  8 passed (8)
apps/api         Tests  6 passed (6)
```

退出码 0，14 条测试。这两个命令会陪你走到全书结尾——后面每一章的新能力，都以「先看到它红、再看到它绿」的方式长在这 14 条之上。

## 验证：亲手撞一次

以下都在 `pnpm dev` 起着两个服务的前提下做。每一步先把预测写下来，再执行对照。

### 一、缺 url 的 POST

先猜：向 5174 的页面端口发一个空 body 的 POST，状态码是多少——201、422、404 三选一；`error.field` 会是什么值？写下来再跑：

```bash
curl -X POST http://localhost:5174/api/links -H "content-type: application/json" -d '{}'
```

（走 5174 端口顺便验证了代理；PowerShell 记得用 curl.exe。）应看到：

```text
{"error":{"field":"url","message":"Invalid input: expected string, received undefined"}}
```

对照：422，field 是 url。zod 第一个 issue 的 path 指到了 url 字段，api 把它拼进了响应。message 是 zod 的默认英文文案——文案不重要，字段定位才重要：前端拿到 field，就知道该把红框画在哪个输入框上。

### 二、跨源直连：亲眼看浏览器拦

在 5174 页面的 DevTools Console 里贴这段（它故意绕过代理，直连 4510）：

```js
// 用法示例
await fetch('http://localhost:4510/api/links', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: 'https://example.com' }),
})
```

先猜三选一：正常 201；报网络错误；拿到响应但读不出 body。执行后你会看到 `TypeError: Failed to fetch`，Console 里另有一行红字。Chrome 的措辞大意是：

```text
Access to fetch at 'http://localhost:4510/api/links' from origin 'http://localhost:5174'
has been blocked by CORS policy: Response to preflight request doesn't pass access
control check: No 'Access-Control-Allow-Origin' header is present on the requested
resource.
```

Network 面板里能看到一个红色的 OPTIONS——预检发出去了、没拿到授权。再用 curl 发一模一样的请求到 4510：201。同一请求两种结局，结论只有一个：服务器没坏（它甚至收到了 OPTIONS 并回了 404），拦你的是浏览器的同源策略。Firefox 的报错措辞不同，事实相同。

### 三、定向破坏：把校验换成「信我」

指一处精确改动。apps/api/src/app.ts 的 POST 处理里，把 `const parsed = createLinkSchema.safeParse(body)` 连同整个 `if (!parsed.success)` 块删掉，换成：

```ts
// 用法示例（破坏版：核对后改回）
const data = body as CreateLinkInput
```

import 行补上 `type CreateLinkInput`，后面的 `parsed.data.url` 改成 `data.url`。先写预测：POST `{"url":"http://example.com"}` 会拿到什么状态码——422 还是 201？slug 还生成吗？

执行 `pnpm test`。应看到恰好 2 条红：api 的两条 422 断言，断言详情都是「expected 201 to be 422」——非 https 的 body 畅通无阻地变成 201、生成短链，GET 它甚至能 302 到 http://example.com。`pnpm typecheck` 呢？照样绿——as 是对编译器说「信我」，它就不吭声了。再看哪条没红：302、404、healthz 照绿，它们守的是查表跳转与存活，本来就不经过校验，各守各的门。

改回 safeParse 版本，再跑 `pnpm test`，14 条全绿复原。带走一句话：**校验是运行时的门卫，as 是给编译器的谎言**——门卫下岗的那天，谎言还在值班。

### 四、变体一笔：改契约，看两边同时红

把 packages/shared/src/index.ts 里 linkResponseSchema 的 `slug` 改名为 `id`（只改这一处），跑 `pnpm typecheck`。先猜：几个包会红？执行后应看到 api 与 web 两个包同时红、共四处报错——api 的 store 存取、app.ts 的字面量、contract.test-d 的形状断言，web 的 shortUrlOf。改回，全绿。这就是共享契约的机械证据：类型漂移死在编译期，而不是上线后。

### 五、页面上走完最后一厘米

在 5174 页面输入 `https://example.com/some-long-article` 创建，点开列表里的短链：地址栏最终停在原网址，Network 第一条是 302。再输入 `http://example.com` 提交：页面显示 `url：Invalid URL`——同一份 schema，在服务端拒绝了请求，又在页面端解释了拒绝。

## 收束：接电话的原来是我

开篇的问题现在可以原样问回去：fetch 的另一头，是谁在读 body、在校验、在决定 302？答案是 createApp 里注册的那三个端点。读 body 的手是 `c.req.json()`，门口的门卫是 safeParse，发 302 的嘴是 `c.redirect`。Network 面板里那行 201 的对面，从一个 baseURL 变成了你亲手写的几百行 TypeScript——而且每一行都有测试看着。

带走四块积木：

- 端点——前后端之间的函数签名，URL 加方法加输入输出约定；
- 请求校验——schema 在业务逻辑之前挡不可信输入，422 点名出错字段；
- 共享契约——一份 zod schema 两侧使用，字段改名两侧同时编译红；
- CORS——浏览器同源策略加服务端授权头，开发期用代理回同源。

边界也照实说：存储还住在进程内存里，重启即丢；服务还没有「谁」的概念，任何人都能建链。前者是下一站的起点（[第 3 章](./03-persistence)），后者要等身份进来才有意义。

自查一遍（先答再看）：

1. 产品改需求：短链目标允许 http。从契约出发，第一个该改哪里？改完哪两条测试会红——为什么这是好事而不是麻烦？
2. 后端要交给 Python 团队维护，packages/shared 用不上了。共享契约这个思路还能落地吗？怎么落？
3. 页面 Console 报 CORS 错，curl 同一 URL 却返回 200。服务端有 bug 吗？第一步排查什么？
4. e2e 断言 302 时为什么必须 `redirect: 'manual'`？不写这条，测试实际在断言什么？
5. 测试里 serve 用 `port: 0` 而不是 4510，除了避免端口冲突，还有什么好处？

<details>
<summary>展开参考答案</summary>

1. 先改 packages/shared 的 createLinkSchema（放宽 protocol 约束）。红的应是 shared 的「http 网址拒绝」与 api 的「http 网址返回 422」——需求变更先动契约，测试替你枚举出哪些既有行为跟着变，改没改全一目了然。
2. 能。「单一契约源」是思路，zod 只是 TypeScript 的载体；语言无关的落地是 JSON Schema 或 OpenAPI 这类接口描述，两端各自从描述生成校验代码与类型。
3. 服务端没坏——curl 不受同源策略约束，它能 200 恰说明端点正常。第一步核对页面的源与请求目标在协议、域名、端口上差哪一项，再决定走代理、同源部署，还是让服务端回授权头。
4. fetch 默认跟随重定向。不写 manual，拿到的是最终目标页的响应（比如目标站的 200），断言的不再是跳转端点自己的行为。
5. 测试不依赖固定环境端口：本机 4510 被占用（比如你自己的 dev 服务开着）时照跑不误；临时端口由操作系统分配、测完即还，也让测试并行互不干扰。

</details>

下一站处理那个本章埋下的边界：重启之后，Map 里的短链全部变成 404——数据要活得比进程久（[第 3 章](./03-persistence)）。
