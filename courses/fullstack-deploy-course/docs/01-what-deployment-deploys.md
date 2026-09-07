---
title: 部署到底部署什么：从 nuxt dev 到生产进程
---

# 部署到底部署什么：从 nuxt dev 到生产进程

项目在本地跑得好好的：nuxt dev 一敲，localhost:3000 出页面，改代码热更新，一切正常。于是你租了台云服务器，把代码 clone 过去，装好依赖，然后照着本地的习惯敲 npm run dev——端口 3000 真能访问。你以为部署完了，合上电脑睡觉。第二天打开网站：连接被拒。SSH 一断就挂，这是很多人第一次「部署」撞上的墙。

这堵墙只是表象。它背后是这门课要回答的第一个问题：部署到底部署了什么？把源代码拷到服务器算不算部署？本地这套启动方式到了服务器为什么就成了事故源？这一章从一个最小的 Nuxt 工程出发，把它构建成真正能交付、能被机器验证的东西。等你看完，「部署」这个词在你手里就有了准确的含义。

## 为什么 npm run dev 不能当生产服务

先替「拷源代码 + npm run dev」这个方案说句公道话：它在本地从来没出过错，而且确实「能访问」。从这两条经验出发，它看起来就是部署的自然延伸。问题出在三个看不见的地方。

第一，进程挂在你的登录会话上。npm run dev 启动的是前台进程，属于你 SSH 登录产生的那个终端会话。SSH 一断，Linux 内核向会话里的前台进程发送挂断信号（SIGHUP），进程随之退出，网站自然就没了。这跟代码质量无关，是 Unix 里进程与终端会话的绑定关系决定的。（Windows 本机复现不出断开 SSH 这一幕，但你要部署的服务器几乎都是 Linux；本章末尾你会亲手杀掉一次进程，看到同一件事的另一面。）

第二，它是为写代码服务的，不是为服务用户服务的。nuxt dev 背后是 Vite 开发服务器：请求来了按需编译，后台常驻热更新监听器，把未压缩的模块一个个发给浏览器。开发时这是恩惠——改一行立刻可见；生产时这是浪费——用户不该替你付编译的等待，源码也不该以未加工的形态暴露出去。

第三，它依赖完整的开发环境。dev 模式要读整个源码树和全部依赖：本课工程的开发安装目录下躺着六百多个包（第 1 章实测 640，后续章节加依赖还会涨）。服务器于是变成了另一台开发机：每次上线都要同步源码、重装依赖，任何一点环境差异都可能把部署变成排障。

做个反事实检验，把三条拧成一句：如果它真适合生产，就该不依赖终端会话、不需要源码、不碰开发依赖——可它三样都要。**生产要的是另一种东西：一个不依赖开发服务器、拷走就能运行的产物。**

## 生产构建：把工程编译成一个可搬运的整体

生产构建（production build）——把 Nuxt 工程编译成不依赖开发服务器、可独立运行的产物，一切装进 .output 目录。使用方式就两条：pnpm build 负责产出，node .output/server/index.mjs 负责启动。可以把它想成「把源码编译成一个拷走就能运行的程序包」。

在 companion 目录里跑一次（依赖已装好；本课锁定 Nuxt 4.5，版本以仓库的 pnpm-lock.yaml 为准，不必与你读到本文时的最新版一致）：

```bash
# 用法示例 · companion 目录内
pnpm build
```

```text
# pnpm build 输出（节选）
├─ .output/server/chunks/routes/renderer.mjs (16.2 kB) (5.56 kB gzip)
├─ .output/server/index.mjs (1.67 kB) (737 B gzip)
├─ .output/server/package.json (678 B) (302 B gzip)
Σ Total size: 2 MB (502 kB gzip)
[nitro] ✔ You can preview this build using node .output/server/index.mjs
✨ Build complete!
```

构建完看产物里有什么（真实目录树，只展开两层）：

```text
# pnpm build 之后的 .output
.output
├─ nitro.json         ← 构建元数据：preset、框架版本、预览命令
├─ public/
│  └─ _nuxt/          ← 浏览器要下载的 JS/CSS，文件名带内容指纹
└─ server/
   ├─ index.mjs       ← 生产入口：node 直接运行它
   ├─ chunks/         ← 服务端代码分块，含上面的 renderer.mjs
   ├─ node_modules/   ← 追踪出来的运行期依赖
   └─ package.json    ← 产物自己的依赖清单
```

三件事值得盯住。

第一，一次构建同时产出「两端」：public/ 是给浏览器的静态资源，server/ 是在服务器上运行的代码。第二，server/node_modules 不是你装的那几百个开发依赖，而是构建器从实际代码里追踪（trace）出来的最小集合。到底多小：本工程此刻顶层 12 个条目（含 @babel、@vue 两个 scope 目录），展开共 19 个包，.output/server/package.json 里登记的依赖与之恰好对账，版本个个精确，一个 ^ 都没有。这个数不是常量：server/ 引入新库它就涨（第 2 章用上 zod 后就是 20）。按需追踪，正是这个数的成因。第三，入口 index.mjs 的第一行 import 的是 node:http：它不需要 Vite、不需要任何命令行工具，就是一段「在 Node 里创建 HTTP 服务器」的普通代码。

这份产物是自包含的：把它整个拷到工程之外、只装有 Node 的目录，直接 node server/index.mjs，照常监听、照常出页面。这一点不用我担保，验证一节你会亲手拷一次。**部署交付的是 .output 这个整体，不是源代码仓库。**

## 一次请求穿过哪几层：Nitro 与 SSR

页面是谁渲染的？先认识两个词。

Nitro——Nuxt 的服务端引擎兼编译器：开发时它托管页面渲染与 server/ 目录的代码；生产时它把这一切编译成上面那个自包含的 Node 服务器（构建元数据里记着 nitro 2.13.4、preset 为 node-server）。你不直接调用它，只需要知道一件事：无论 dev 还是 prod，服务端那一侧都是它在干活。

SSR（server-side rendering，服务端渲染）——页面 HTML 由服务器上的 Vue 组件渲染成完整标记后发给浏览器。浏览器拿到能直接看的页面，再执行 JS 接管交互（这一步叫水合，hydration）。反过来说也成立：没有服务端进程，就没有 HTML。这正是「部署 Nuxt 应用必须有一个常驻 Node 进程」的原因。

证据用产物进程看。启动它（不指定端口时默认 3000）：

```bash
# 用法示例 · companion 目录内
node .output/server/index.mjs
# Listening on http://[::]:3000
```

另开一个终端，用 curl 取页面。curl 不执行任何 JS，拿到的就是服务端发出的原始字节。

```text
# curl -s -D - http://127.0.0.1:3000/ 的响应头
HTTP/1.1 200 OK
content-type: text/html;charset=utf-8
x-powered-by: Nuxt
Date: Mon, 07 Sep 2026 06:39:41 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Content-Length: 1794
```

body 里直接躺着完整表格（原样摘录，三行记录都在）。

```html
<!-- curl 结果节选：表格原样，未执行任何 JS -->
<tr><td>3</td><td>production</td><td><code>77aa01f</code></td><td>成功</td><td>备份脚本改用 pg_dump 归档格式</td></tr>
<tr><td>2</td><td>production</td><td><code>d41e8c7</code></td><td>成功</td><td>健康检查超时从 3s 调到 10s</td></tr>
<tr><td>1</td><td>staging</td><td><code>9f3c2ab</code></td><td>失败</td><td>首次部署：迁移失败，已回滚</td></tr>
```

现在能把一次请求的完整路径画出来了：

```text
浏览器
  │  GET /（HTTP 请求）
  ▼
Node 进程（node .output/server/index.mjs 创建的 http 服务器）
  │  收到请求，交给 Nitro 路由
  ▼
Nitro（判定这是页面请求，交给 SSR 渲染器，即 chunks 里的 renderer.mjs）
  │  在服务器上执行页面组件，产出完整 HTML
  ▼
HTML 回给浏览器（含表格数据），浏览器执行 JS 水合成可交互页面
```

顺带拆一个流传很广的误会：「Nuxt 只是前端框架，后端得另起一个项目」。看这张图：接收 HTTP 的是同一个 Node 进程，渲染页面的是它；而 Nuxt 工程里 server/ 目录下的后端代码，同样由 Nitro 编译进同一个产物。这个工程眼下还没有 server/ 目录，但它就是这门课后半程的主战场。

## 部署单元：换个词说「部署了什么」

部署单元——一次部署交付的最小整体：代码、依赖与运行时打包在一起，换版本就是整体替换。对这个工程而言，它此刻就是那个自包含的 .output；等它被装进容器镜像，镜像就是部署单元。形式会升级，「一次交付、整体替换」的语义不变。

为什么强调「整体」？因为页面代码、渲染器、依赖版本在同一秒被一起替换，不存在「新页面配旧依赖」的半新半旧状态；出问题要退回，也是整体退回上一个完整的部署单元。这个「快照」性质验证一节会让你亲手撞一次。

## 演练：从两条红到全绿

每个能力章都是同一个节奏：先看到真实失败，再做最小实现，最后跑门槛。本章门槛是两条命令：pnpm build 与 pnpm e2e:ch1。命令都在 companion 目录下执行，全部是跨平台的 node/pnpm 命令——Windows 用 Git Bash，macOS/Linux 用任意终端，行为一致。

红一：产物不存在。新克隆的仓库里没有 .output（它在 .gitignore 里，本就不该进版本库）。此刻直接按「node .output/server/index.mjs」的口诀启动：

```text
# .output 不存在时的真实输出（路径为你机器上的绝对路径）
$ node .output/server/index.mjs
Error: Cannot find module '...companion\.output\server\index.mjs'
  code: 'MODULE_NOT_FOUND'
Node.js v22.22.2
```

退出码 1。node 只是个程序运行器：交给它一个文件路径，它加载执行；路径不存在时它不会替你构建工程，只报 MODULE_NOT_FOUND。这条红守住的直觉是：部署前得先有「可部署的东西」，而它不是源代码。

红二：产物存在，内容不对。这个工程配了一个 e2e 脚本（scripts/e2e-ch1.mjs，马上看它），package.json 里登记为门槛命令。首页还是占位页时的第一次运行，就红在这条内容断言上——内容断言失败时的真实输出如下（实验三会复现同款红）：

```text
# e2e 内容断言亮红时的真实输出
$ pnpm e2e:ch1
[e2e:ch1] 启动生产进程: node .output/server/index.mjs (PORT=4171)
[e2e:ch1] 进程就绪 (耗时 368ms)
[e2e:ch1] GET / → 200
[e2e:ch1] HTML 含 SSR 数据文本 "9f3c2ab" → FAIL
[e2e:ch1] FAIL: 裸 HTML（未执行任何 JS）中找不到 "9f3c2ab" —— 页面数据不是服务端渲染出来的。
[e2e:ch1] 生产进程已退出 (pid 25796, code=null, signal=SIGTERM)
[e2e:ch1] 端口 4171 不再监听 → PASS
 ELIFECYCLE  Command failed with exit code 1.
```

注意它红的方式：进程起得来，GET / 拿到 200，服务是活的；红在内容断言——裸 HTML 里找不到页面本该有的数据。这种安静的红比崩溃危险得多：没有这条断言，你会拿着一个返回 200 的空壳宣布部署成功。脚本把它变成响亮的退出码 1。还有两行值得盯：断言亮红之后，「生产进程已退出」「端口 4171 不再监听」照样打印——失败的运行也把收尾走完，不留一个占着端口的孤儿进程。这是怎么做到的，马上看脚本的控制流。

最小实现：一页真实数据。Nuxt 的页面放在 app/pages/ 下，文件名对应路由，把首页从占位换成一张部署日志表。

```vue
// companion/app/pages/index.vue · 第 1 章形态（教学示意）：数据内联在本页；
// 第 2 章起首页改由 GET /api/deploys 提供数据（终态见 docs/02-nuxt-server-api.md）
<script setup lang="ts">
interface DeployRecord {
  id: number
  env: 'production' | 'staging'
  status: 'success' | 'failed'
  commit: string
  summary: string
}

const deploys: DeployRecord[] = [
  { id: 3, env: 'production', status: 'success', commit: '77aa01f', summary: '备份脚本改用 pg_dump 归档格式' },
  { id: 2, env: 'production', status: 'success', commit: 'd41e8c7', summary: '健康检查超时从 3s 调到 10s' },
  { id: 1, env: 'staging', status: 'failed', commit: '9f3c2ab', summary: '首次部署：迁移失败，已回滚' },
]
</script>

<template>
  <section>
    <p>ship-log 记录每一次部署。此刻数据内联在本页，由服务端渲染成完整 HTML 再发给浏览器。</p>
    <table>
      <thead>
        <tr><th>#</th><th>环境</th><th>commit</th><th>结果</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr v-for="d in deploys" :key="d.id">
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

三行数据此刻内联在组件里：先让「页面有数据、且由服务端渲染」成立。数据从哪来（API、数据库）是后面的事——每一步都停在可验证的状态。

再配 e2e 脚本。它的职责一句话：起产物进程，断言，收尾退出。三个关键片段：

```js
// companion/scripts/e2e-ch1.mjs · 片段一：用 node 起产物进程，端口写进环境变量
  child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
```

```js
// companion/scripts/e2e-ch1.mjs · 片段二：断言分两层——服务活着，页面也对
    const html = await res.text()
    for (const marker of SSR_MARKERS) {
      const hit = html.includes(marker)
      console.log(`[e2e:ch1] HTML 含 SSR 数据文本 "${marker}" → ${hit ? 'PASS' : 'FAIL'}`)
      if (!hit) {
        fail(`裸 HTML（未执行任何 JS）中找不到 "${marker}" —— 页面数据不是服务端渲染出来的。`)
      }
      passed++
    }
```

```js
// companion/scripts/e2e-ch1.mjs · 片段三：统一收尾——进程必杀、端口必查
  } finally {
    // 统一收尾：无论断言成败，都杀掉进程、等退出事件落地，并确认端口不再监听
    killChild()
    const gone = await exited
    console.log(`[e2e:ch1] 生产进程已退出 (pid ${child.pid}, code=${gone.code}, signal=${gone.signal ?? '无'})`)
    if (await portReleased(10_000)) {
      console.log(`[e2e:ch1] 端口 ${PORT} 不再监听 → PASS`)
    } else {
      console.error(`[e2e:ch1] FAIL: 进程退出后 ${BASE} 仍可访问 —— 端口未释放`)
      process.exitCode = 1
      failed = true
    }
  }
```

片段一用 node 直接运行产物入口，PORT 指到 4171（本课约定：应用测试统一用 4100 段端口，用完释放），HOST 绑回环地址，不打扰局域网。片段二的两层断言：GET / 必须 200；且 fetch（与 curl 同款，不执行 JS）拿到的裸 HTML 里必须出现数据文本 9f3c2ab 与 77aa01f——文本在，SSR 渲染的证据就在。片段三的 finally 是统一收尾：杀进程、等退出事件落地、再探一次端口，断言成败都走这一段。它能「必然执行」，靠的是失败路径的设计。断言失败时 fail() 不直接 process.exit——那样会跳过 finally，留下占着 4171 的孤儿进程。下次再跑，4171 还被孤儿进程占着，直接 EADDRINUSE。失败改走另一条路：抛出专用错误，由 catch 打印并把 process.exitCode 置 1，进程带着失败码走完收尾再自然结束。spawn 之后脚本还挂了一个进程退出兜底钩子（process.on('exit') 里再杀一次子进程），从任何路径离开都不留孤儿。package.json 里新增的门槛命令就一行：

```jsonc
// companion/package.json · scripts 节选
"build": "nuxt build",
"test": "vitest run",
"e2e:ch1": "node scripts/e2e-ch1.mjs"
```

转绿。先构建，再跑门槛：

```bash
pnpm build && pnpm e2e:ch1
```

```text
# pnpm e2e:ch1 终态输出
[e2e:ch1] 启动生产进程: node .output/server/index.mjs (PORT=4171)
[e2e:ch1] 进程就绪 (耗时 361ms)
[e2e:ch1] GET / → 200
[e2e:ch1] HTML 含 SSR 数据文本 "9f3c2ab" → PASS
[e2e:ch1] HTML 含 SSR 数据文本 "77aa01f" → PASS
[e2e:ch1] 生产进程已退出 (pid 20348, code=null, signal=SIGTERM)
[e2e:ch1] 端口 4171 不再监听 → PASS
[e2e:ch1] 全部断言通过 (4/4)
```

从红到绿，没有一行代码是为迁就测试而写：构建产出真实产物，e2e 断言真实页面。这两条命令从此是工程的回归底线，后面每一章动过工程，收尾都要让它们保持全绿。

## 验证：先猜，再跑

下面的实验都是你亲手做。每一步先把预测写在纸上——离散的、能判对错的预测，再执行对照。

实验一：默认端口与「杀进程」。启动 node .output/server/index.mjs，另开终端执行下面的命令，然后把服务进程 Ctrl+C 杀掉，再执行一次：

```bash
# 用法示例 · 第二个终端
curl -s -D - -o /dev/null http://127.0.0.1:3000/
curl -s http://127.0.0.1:3000/ | grep -c 9f3c2ab
```

先猜三件事：响应状态码是多少？grep 的计数是 1 还是 0？杀掉进程后 curl 的结局是「正常返回」还是「连接被拒」，二选一。对照：200；计数 1（整个 HTML 一行，命中一次）；连接被拒。第三条就是开篇那堵墙的同族现象——SSH 断开时是内核替你按下了「杀进程」，这里是你自己按的。机理相同：没有进程，就没有渲染，网站就什么都不是。

实验二：PORT 环境变量。先猜两件事再跑：日志行里的数字会不会变？3000 还通不通？

```bash
# 用法示例 · Git Bash
PORT=4171 node .output/server/index.mjs
# Listening on http://[::]:4171
```

对照：日志变成 [::]:4171，3000 不再有人监听。端口是进程启动时读取的环境变量——同一份产物，零重建，换端口。日志里的 [::] 表示绑定所有网卡，回环地址与局域网 IP 都能到达。

实验三：定向破坏——产物是冻结的快照。把 app/pages/index.vue 里 commit: '9f3c2ab' 那一行的 sha 改成 deadbee（只改这一个词）。先写下两个预测，再动手：

1. 不重新构建，重启产物进程后 curl——HTML 里的 sha 是 9f3c2ab 还是 deadbee？二选一。
2. 跑 pnpm build && pnpm e2e:ch1——退出码是 0 还是 1？

对照：第一问，仍是 9f3c2ab。源码的改动进不了已经构建出来的产物：**.output 是构建那一刻的冻结快照**，这也是部署单元「整体替换」的另一面——改了源码不重新构建、不重新部署，线上跑的就还是旧版本。第二问，退出码 1：e2e 在 HTML 里找不到 9f3c2ab，断言亮红；亮红之后收尾两行（进程已退出、端口不再监听）照样出现，失败的运行也把端口还了回去。注意此时 GET / → 200 依然通过，它守「服务活着」，内容断言守「页面对不对」，两层守卫各管各的。复原：把 sha 改回 9f3c2ab，pnpm build && pnpm e2e:ch1，确认全绿如初。

顺手加一个自包含实验：把 .output 整个目录拷到工程外的临时目录，在那里执行 node server/index.mjs（默认 3000 被占用就带上 PORT=4179）。先猜能不能起来，再对照——它能起来，页面分毫不变。产物不认识你的工程目录，它只认识自己肚子里的东西。

## 收束：那堵墙的名字

开篇的问题现在可以整段回答。SSH 一断网站就没了，直接原因是 npm run dev 起的进程绑定在登录会话上，会话结束，内核发出挂断信号，进程随之退出。更深一层：dev 服务器本来就是开发工具——按需编译、热更新、依赖完整源码树，三样都不是为服务用户准备的。部署交付的从来不是源代码，而是生产构建出的部署单元：一个自包含的 .output，在任何装了 Node 的机器上一条命令启动。页面由常驻的 Nitro 进程做 SSR 渲染——curl 拿到的 HTML 里，就躺着渲染好的数据。

这一章拿到的积木，后面每一章都在用：

- 生产构建——pnpm build 产出 .output，node .output/server/index.mjs 启动生产服务；
- Nitro——Nuxt 的服务端引擎，页面渲染与后端代码都由它承载；
- SSR——HTML 由服务端进程渲染，「curl 不执行 JS，HTML 里有什么，服务端就渲染了什么」；
- 部署单元——一次部署交付的整体，整体替换、整体回滚。

最后一行只做导航：Nitro 装的不止页面渲染，server/ 目录就是这个工程的后端，同一份产物里会长出 API（第 2 章）；进程由谁守护、入口由谁把关，交给容器与反向代理（第 6 章）。

## 自查

先自己写下答案，再展开对照；答不上来就按提示回查。

<details>
<summary>1. 把 companion 目录（不含 node_modules）拷到只装 Node 的服务器，执行 node .output/server/index.mjs。能起来吗，依据是什么？删掉 .output 只留源码再跑同一条命令呢？</summary>

能起来：.output/server/node_modules 自带追踪出的运行期依赖，产物自包含，既不需要工程的 node_modules，也不需要源码。删掉 .output 后再跑，会得到 MODULE_NOT_FOUND：node 只运行交给它的文件，不会替你构建。回查「生产构建」一节。
</details>

<details>
<summary>2. 某个页面，curl 拿到的 HTML 里搜不到商品列表的数据，浏览器打开却能看到。列表是谁渲染的？「这份数据是 SSR 渲染出来的」这句话对不对？</summary>

列表是浏览器执行 JS 之后渲染的。curl 不执行 JS，数据不在 curl 到的 HTML 里，它就不是服务端渲染出来的——这句话不对。判定工具就是本章的：不执行 JS 的客户端拿到什么，服务端就只渲染了什么。回查「一次请求穿过哪几层」。
</details>

<details>
<summary>3. 不改任何代码，让同一个 .output 从监听 3000 改成监听 4171。这个事实说明端口是构建时定死的，还是启动时读取的？依据是什么？</summary>

启动时读取：PORT=4171 node .output/server/index.mjs 即可，同一份产物没有重建就换了端口。若端口在构建时定死，换端口必须重新构建——实验二已经排除了这种可能。回查「验证」实验二。
</details>
