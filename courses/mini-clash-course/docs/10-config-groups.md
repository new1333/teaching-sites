---
title: 配置与代理组：从硬编码到声明式
---

# 配置与代理组：从硬编码到声明式

## 10.1 前情：零件齐全，但每颗螺丝都拧在代码里

不用问新问题，旧零件自己会告状——三条状纸摆在这里：

- 入口、加密隧道、规则引擎、fake-ip、报文解析——零件都在 `src/` 里躺着，可端口写在 `startSocks5Server({ port })` 的参数里，密码写在 `connectViaRelay` 的调用参数里，规则表写在测试与 demo 的变量里。硬编码遍地：换台机器、换个节点，你要动的是源码，不是配置文件。
- 第 6 章末尾立过一条承诺：密码目前写在调用参数里，一份配置迟早要接管端口、密码与规则。这一章就是来兑现它的。
- 第 7 章的出站只有两条线：DIRECT 与 PROXY。可「PROXY」到底是哪台远端？世上只有一个远端时这个问题不存在——现在该让它存在了。

## 10.2 换个节点要改代码，换条规则也要

你想把 mini-clash 在另一台机器上跑起来：端口要换、密码要换、规则表要按那台机器的网络环境重写——每一样都得打开 `src/` 改代码，改完还要重新构建。而真实 Clash 的用户只是改一份配置文件里的几行文本、重启，全部行为跟着变。更让你眼熟的是面板里那一幕：url-test 组旁边有个自己会跳动的延迟数字，节点一慢，出站就自动跳到更快的那台。你大概见过「自动选优」这个现象，但没想过它凭什么成立——测速测的是什么？谁在测？测完怎么变成一个决定？

这一章把两件事一起写出来。先让一份声明式配置——只写「要什么」、不写「怎么做」的配置文件——接管端口、密码、节点与规则。再把节点打包成代理组（proxy group），即把若干节点打包成一个可切换出口的虚拟节点。组先做两种策略：select 手动选择；url-test 是自动测速组，对组内节点发探测请求，谁延迟低选谁。做完之后，「换节点」是改一行文本，「换规则」也是改一行文本，程序一个字不动。

## 10.3 原理：菜单、名册与成绩单

### 10.3.1 声明式配置：把「要什么」从「怎么做」里拆出来

先立词。声明式配置（declarative config）——只写「要什么」不写「怎么做」的配置文件：端口几号、节点在哪、规则怎么判，全是数据；怎么监听、怎么加密、怎么按序匹配，仍留在代码里。锚点用点菜 vs 炒菜：配置文件是菜单，程序是厨师——想换道菜，改菜单就好，不必把厨师回炉重造。真实 Clash 的配置是 YAML——另一种用缩进表示层次的配置格式；本课用 JSON 教同构语义（proxies 与 rules 两段同名同义，组段真名 `proxy-groups`、教学版段名缩作 `groups`），解析器因此一个 yaml 依赖都不用引。

为什么值得这么折腾？反事实摆出来：数据与逻辑不分家时，「换一个节点」就是一次代码变更——改源码、过类型检查、重新构建、把新程序搬去那台机器；「换一条规则」也是一次代码变更。可这些东西恰恰是全书里最常变的：端口因机器而异，密码因远端而异，规则因网络环境而异。**把会变的从不变的里拆出来，会变的就只是文本**。这份拆分还附赠一道防线：配置是数据，进运行时之前可以整体校验——错误带路径报出，`$.proxies[1].port` 直指出错的那一格，错在加载时暴露，不留给每条连接去撞。

菜单一共四段，每段都能对上此前某处硬编码。

| 段 | 装什么 | 接管了此前哪处硬编码 |
| --- | --- | --- |
| `inbound` | 入口监听端口 | 第 3 章 `startSocks5Server({ port })` 的 port |
| `proxies` | 节点名册：name / host / port / password | 第 6 章起散在调用参数里的远端地址与密码 |
| `groups` | 组定义：select / url-test 与组员名单 | 本章新面孔 |
| `rules` | 规则行数组（字符串） | 第 7 章测试与 demo 变量里的规则表 |

### 10.3.2 代理组：出站名字的间接层

第二张新面孔。代理组的定义上面给过了，这里看它买了什么。锚点：组是菜单上「这道菜指定哪位厨师做」的那一行——换人不动菜牌。组先做两种：select——手动选择组，默认出名单第一个，任何时候可以换人；url-test——自动测速组，对每台组员发探测，谁延迟低谁上。

为什么要隔这一层？反事实：没有组时，规则行只能直写节点名。换节点，规则表里每一处引用都要改；同一台节点被五条规则引用，就改五处。有组之后，规则行写「这一族域名走 choose」，choose 此刻出 node-fast 还是 node-slow，是组内一次切换的事，规则行纹丝不动。**组把「谁走这条策略」与「这条策略此刻用谁」拆成两个能独立变化的问题**——应用只见组，组内选谁由策略定。

于是第 7 章的出站语义在本章加宽：出站从一个只有两个成员的类型，变成「DIRECT、PROXY，或名册里任一名字」。

```ts
// src/rules.ts · Outbound（第 10 章的加宽）
// 出站：DIRECT = 本机直连目标；PROXY = 第 6 章的加密两跳（远端由调用参数指定）。
// 第 10 章起还可以是配置名册里的组名/节点名（「string & {}」交集写法：保留这两条的自动补全，又不拒收别的名字）
export type Outbound = 'DIRECT' | 'PROXY' | (string & {})
```

加宽的方式是给 `parseRules` 加一个可选的名册参数，不报名册时行为与从前一字不差——第 7 章的旧用例、旧正文因此一个都不用改。

```ts
// src/rules.ts · parseRules 的名册参数（拼版：全貌见第 7 章 7.4.1，此处只看加宽的三行）
export function parseRules(lines: string[], knownOutbounds?: readonly string[]): Rule[] {
    const outbound = (s: string): Outbound => {
      if (s !== 'DIRECT' && s !== 'PROXY' && !(knownOutbounds ?? []).includes(s))
        throw new Error(`${where}：出站只认 DIRECT 或 PROXY，看不懂「${s}」`)
      return s
    }
```

有个名字要在此退役：「PROXY」。它是世上只有一个远端时的写法——那时「走代理」天然指那台唯一的中继。配置世界里远端不止一台，「PROXY」指谁只能靠猜，所以 `loadConfig` 见到它在规则行里出现，会带着路径拒绝它，请你直呼组名或节点名。解析器本身仍然认它（第 7 章独立使用 `parseRules` 的调用方还靠它），退役只发生在配置这一层。

### 10.3.3 url-test：延迟探测测的是什么

第三张新面孔最容易被当成黑盒。延迟探测（latency probe）——给节点发一个小请求并掐表，衡量节点「快不快」的标准动作。拆开是三问。

**测什么 URL？** 组里配置的那条测速 URL。真实 Clash 面板里常见的延迟数，就是对这条 URL 经由节点发一次 HTTP 请求量出来的；大家爱用各家运营商的 generate_204 端点——它永远回一封没有正文的 204 应答，正合适做探测。测速 URL 是配置项而不是常量，原因在度量本身：延迟永远是「到某个目标的延迟」，换一个测速目标，量出来的就是另一条路。

**延迟算到哪一段？** 从「开始拨节点」起表，到「测速目标的应答首字节回来」停表——拨节点、CONNECT 请节点代连、HTTP 应答首字节，整段往返计一次。对照 Clash 公开文档的行为：url-test 组对配置的测速 URL 经由节点发请求、取应答往返；面板里的延迟数字就是它。教学版同款。

```text
起表 ──①拨节点──②CONNECT 请节点代连──③测速目标回 204 首字节──► 停表
      ├── 第一跳：本机 → 节点 ──┤├──── 节点 → 测速目标 → 回来 ────┤
      └──────────────── 整段往返 = 这条线的延迟 ────────────────┘
```

**为什么停在首字节，不等全部到齐？** 因为测的是「链路通多快」，不是「带宽有多大」。首字节一到，说明本机到节点到目标整条线都走了一个来回；之后的正文下载量的是带宽，节点再快、测速目标正文再大，数字也会被正文拖着走——那不是「快不快」，是「粗不粗」。这就是探测请求用 HEAD（只要应答头、不要正文的请求方法）、测速端点用 204 的原因：没有正文可等，首字节就是全部。

不进实验场也能亲手量出这段差别。一个自包含的小脚本。

```js
// 用法示例：存成 ttfb.mjs，node ttfb.mjs —— 首字节与「全部到齐」差的正是探测要避开的那段
import net from 'node:net'

const server = net.createServer((s) => {
  s.on('data', () => {
    s.write('HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\n') // 应答头立刻回
    setTimeout(() => s.end('12345678'), 150) // 正文 150ms 后才到——模拟「首字节快、正文慢」
  })
})
server.listen(0, '127.0.0.1', () => {
  const c = net.connect((server.address()).port, '127.0.0.1')
  const t0 = performance.now()
  c.write('GET / HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n') // 客户端先开口，服务端才会应
  c.once('data', () => console.log('首字节   ', Math.round(performance.now() - t0), 'ms')) // 个位数：链路通得快
  c.once('close', () => {
    console.log('全部到齐 ', Math.round(performance.now() - t0), 'ms') // 150+：正文占了大头
    server.close()
  })
})
```

两行输出一对比，首字节与全部到齐差的那 150ms 就是正文——探测要量的是前者。真实 Clash 的 url-test 还有几样配套机制。按 interval 周期重测；tolerance 切换容差——新节点要快过当前节点一个门槛才换，避免来回抖动；lazy——没被选中的组不测；expected-status——应答码不对算失败。教学版全部不做，建组时测一轮定胜负，超时算没成绩——差异逐条登记附录。

## 10.4 演练：loadConfig 与 createRouter

实验场开工。`src/config.ts` 是本章主件：`loadConfig` 管加载与校验，`createRouter` 按配置建路由器。测试 `tests/config-groups.test.ts` 照旧先写、先跑出红（模块不存在，加载即失败），再写实现转绿，7 条用例。门槛命令照旧是 `cd companion && npm run typecheck && npm test`，全绿应为 68 条（旧 61 + 本章 7）——旧用例一字未动还全绿，就是「加宽不破坏」的机械证据：`src/rules.ts` 只增了一个可选参数，第 7 章的判决语义一行没改。

测试的桩值得一提：探测走回环。测速目标是回环上一个「来字节就回 204」的应答器；两台假节点是两台中继——快桩前面立一台透明转发的探针，慢桩前面立一台每批字节都压 120ms 再转发的转发器。快慢差造在节点路径上，测速目标同一个：这样量出来的差距，只能来自节点。

### 10.4.1 loadConfig：错误带路径报出

配置的形状先立起来。

```ts
// src/config.ts · ProxyNode 与两种组
export interface ProxyNode {
  name: string // 节点名：规则行与组都拿它当出站名，全配置唯一
  host: string // 节点（中继）的门牌
  port: number // 节点（中继）的房间号
  password: string // 这条线的门锁钥匙（第 6 章的 password 原样搬进数据）
}

export interface SelectGroupDef {
  name: string
  type: 'select' // 手动选择：默认出名单第一个，随时可切
  proxies: string[] // 组员名单（教学版只认节点名，组套组不做）
}

export interface UrlTestGroupDef {
  name: string
  type: 'url-test' // 自动测速：对每台组员发探测，谁延迟低谁上
  proxies: string[]
  url: string // 测速 URL：探测经由节点对它发 HTTP 请求、掐表到应答首字节
  timeoutMs?: number // 单次探测的超时（缺省 2000ms）——超时算没成绩
}

export type GroupDef = SelectGroupDef | UrlTestGroupDef

export interface Config {
  inbound: { port: number } // SOCKS5 入口监听哪个端口（0 = 请系统随手分一个空闲端口）
  proxies: ProxyNode[] // 节点名册
  groups: GroupDef[] // 组：把若干节点打包成一个可切换/可测速的虚拟出口
  rules: Rule[] // 规则表（已按名册解析）：出站可写 DIRECT、组名或节点名
}
```

`loadConfig` 的骨架只有一条纪律：每一处校验失败，错误消息都以 JSON 路径开头。小工具先立起来，再逐段校验。

```ts
// src/config.ts · loadConfig（全文）
// 校验失败即抛：where 是 JSON 路径（$.proxies[1].port 这类），消息里能直接翻到出错的那一格
function fail(where: string, msg: string): never {
  throw new Error(`${where}：${msg}`)
}

const RESERVED = new Set(['DIRECT', 'PROXY']) // 保留出站名：不能拿来当节点名/组名（DIRECT 是语义不是名字）

export function loadConfig(text: string): Config {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    fail('$', `看不懂这份 JSON——${(e as Error).message}`) // V8 的报错自带出错位置，原样带出
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('$', '应为对象，装 inbound / proxies / groups / rules 四段')
  const o = raw as Record<string, unknown>

  // inbound 段：端口由配置接管
  const inboundRaw = o.inbound
  if (typeof inboundRaw !== 'object' || inboundRaw === null) fail('$.inbound', '应为对象 { port }')
  const port = (inboundRaw as Record<string, unknown>).port
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535)
    fail('$.inbound.port', '应为 0..65535 的整数（0 = 请系统随手分一个空闲端口）')

  // proxies 段：节点名册
  if (!Array.isArray(o.proxies)) fail('$.proxies', '应为节点数组')
  const proxies: ProxyNode[] = []
  const nodeNames = new Set<string>() // 节点名册：组员只认这里面的名字
  const allNames = new Set<string>() // 全配置名字总册（节点名 + 组名）：出站名必须一伙里唯一
  o.proxies.forEach((p, i) => {
    const where = `$.proxies[${i}]`
    if (typeof p !== 'object' || p === null) fail(where, '应为对象 { name, host, port, password }')
    const r = p as Record<string, unknown>
    const name = r.name
    if (typeof name !== 'string' || name === '') fail(`${where}.name`, '应为非空字符串')
    if (RESERVED.has(name)) fail(`${where}.name`, `「${name}」是保留出站名，不能拿来当节点名`)
    if (allNames.has(name)) fail(`${where}.name`, `「${name}」与前面的名字撞了——配置里的名字就是出站名，一伙里必须唯一`)
    const host = r.host
    if (typeof host !== 'string' || host === '') fail(`${where}.host`, '应为非空字符串')
    const nodePort = r.port
    if (typeof nodePort !== 'number' || !Number.isInteger(nodePort) || nodePort < 1 || nodePort > 65535)
      fail(`${where}.port`, '应为 1..65535 的整数')
    const password = r.password
    if (typeof password !== 'string' || password === '') fail(`${where}.password`, '应为非空字符串（节点的门锁钥匙，省不得）')
    proxies.push({ name, host, port: nodePort, password })
    nodeNames.add(name)
    allNames.add(name)
  })

  // groups 段：组名也是出站名，同样入总册
  if (!Array.isArray(o.groups)) fail('$.groups', '应为组数组')
  const groups: GroupDef[] = []
  o.groups.forEach((g, i) => {
    const where = `$.groups[${i}]`
    if (typeof g !== 'object' || g === null) fail(where, '应为对象 { name, type, proxies }')
    const r = g as Record<string, unknown>
    const name = r.name
    if (typeof name !== 'string' || name === '') fail(`${where}.name`, '应为非空字符串')
    if (RESERVED.has(name)) fail(`${where}.name`, `「${name}」是保留出站名，不能拿来当组名`)
    if (allNames.has(name)) fail(`${where}.name`, `「${name}」与前面的名字撞了——配置里的名字就是出站名，一伙里必须唯一`)
    if (!Array.isArray(r.proxies) || r.proxies.length === 0) fail(`${where}.proxies`, '应为非空的节点名数组')
    const members: string[] = []
    r.proxies.forEach((m, j) => {
      if (typeof m !== 'string') fail(`${where}.proxies[${j}]`, '应为节点名（字符串）')
      if (RESERVED.has(m)) fail(`${where}.proxies[${j}]`, `「${m}」不能当组员——教学版组员只认节点名`)
      if (!nodeNames.has(m)) fail(`${where}.proxies[${j}]`, `「${m}」不在节点名册里（教学版组员只能是节点，组套组不做）`)
      members.push(m)
    })
    if (r.type === 'select') {
      groups.push({ name, type: 'select', proxies: members })
    } else if (r.type === 'url-test') {
      const url = r.url
      if (typeof url !== 'string' || url === '') fail(`${where}.url`, 'url-test 组必须指明测速 URL（探测经由节点对它发请求）')
      const u = parseProbeUrl(url)
      if (u === null) fail(`${where}.url`, `应为 http:// 开头、带主机的合法地址，看不懂「${url}」`)
      const timeoutMs = r.timeoutMs
      if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1))
        fail(`${where}.timeoutMs`, '应为正整数毫秒')
      groups.push({ name, type: 'url-test', proxies: members, url, ...(timeoutMs === undefined ? {} : { timeoutMs }) })
    } else {
      fail(`${where}.type`, `只认 select 或 url-test，看不懂「${String(r.type)}」`)
    }
    allNames.add(name)
  })

  // rules 段：规则行解析交给第 7 章的解析器，名册（组名 + 节点名）一并带进去
  if (!Array.isArray(o.rules)) fail('$.rules', '应为规则行数组（字符串）')
  const lines: string[] = []
  o.rules.forEach((l, i) => {
    if (typeof l !== 'string') fail(`$.rules[${i}]`, '应为字符串规则行')
    lines.push(l)
  })
  try {
    const rules = parseRules(lines, [...allNames]) // 名册进判决：组名与节点名从此是合法出站
    // 「PROXY」是单远端时代的旧出站：解析器认它（独立用 parseRules 的旧调用方还靠它），
    // 但配置世界里远端不止一台——直呼组名或节点名，别让「PROXY」指谁靠猜
    lines.forEach((l, i) => {
      const seg = l.trim().split(',')
      const outbound = seg[seg[0] === 'MATCH' ? 1 : 2]
      if (outbound === 'PROXY') fail(`$.rules[${i}]`, '「PROXY」是世上只有一个远端时的旧出站——配置里请直呼组名或节点名')
    })
    return { inbound: { port }, proxies, groups, rules }
  } catch (e) {
    fail('$.rules', (e as Error).message) // 坏行带行号（在 rules 数组内数），前面钉上配置路径
  }
}
```

三个读点。名册有两本：`nodeNames` 只装节点名（组员只认它），`allNames` 节点名加组名（规则出站认它）——撞名的检查都落在这本总册上，因为配置里的名字就是出站名。规则段的解析整体包在 try 里：第 7 章解析器抛的错自带行号，前面钉一个 `$.rules` 路径再抛出来，两层信息拼成「配置里第几段、规则表里第几行」。`PROXY` 的拒绝放在解析之后——解析器仍认它是给旧调用方留的兼容，配置这层把它拦下，10.3.2 说的退役就在这三行里。

### 10.4.2 probeNode：掐表到首字节

探测本体就是 10.3.3 那张图的代码形态。

```ts
// src/config.ts · probeNode
// —— 延迟探测：经由节点向测速 URL 发一个 HTTP 请求，掐表到「应答首字节回来」为止 ——

// 延迟算的是整段往返：拨节点 + CONNECT 代连 + 测速目标应答首字节——「走这条线要多久」的问题本身。
// 与 Clash 公开文档同款语义（对配置的测速 URL 经由节点发请求、取应答往返，面板里的延迟数就是它）；
// 教学简化：不按 interval 周期测、不设 tolerance 容差、不做 lazy（差异登记附录）。
// 返回 null = 超时或失败：没成绩就不参赛
async function probeNode(node: ProxyNode, url: string, timeoutMs: number): Promise<number | null> {
  const u = parseProbeUrl(url)
  if (u === null) return null // loadConfig 已拦过坏 URL，这里只是兜底
  const started = performance.now() // 从「开始拨节点」起表：隧道建立也算这条线的延迟
  return new Promise((resolve) => {
    let settled = false
    let pipe: Duplex | null = null
    const done = (v: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => {
      pipe?.destroy()
      done(null) // 超时：这条题答不上来，按失败记
    }, timeoutMs)
    connectViaRelay({ host: node.host, port: node.port }, { host: u.host, port: u.port }, node.password).then(
      (t) => {
        pipe = t
        t.once('data', () => done(Math.round(performance.now() - started))) // 首字节到达：停表
        t.once('close', () => done(null)) // 没等到应答就收线：失败
        t.once('error', () => done(null))
        t.write(`HEAD /generate_204 HTTP/1.1\r\nHost: ${u.host}\r\nConnection: close\r\n\r\n`) // HEAD：只要应答头，不下载正文
      },
      () => done(null), // 拨不通或代连失败
    )
  })
}
```

探测走的是 `connectViaRelay`——第 4 章的两跳、第 6 章的加密，一条不缺：探测本身就是一次走节点的真实连接，socket 从本机一路打到测速目标再回来。三个收尾路径各归各：首字节到、停表；没等到应答就收线、记失败；整段超过 timeoutMs、销线记超时。`settled` 那面小旗保证三条路径只走一条。

### 10.4.3 createRouter：判决 → 组 → 节点 → 建线

路由器把三样东西接成一条流水线：规则引擎判出出站名，组策略把出站名落到节点，建线按节点走加密两跳或直连。对外的面有四个。

```ts
// src/config.ts · Router 的对外形状
export interface RouteVerdict {
  outbound: string // 判决出的出站名：DIRECT、组名或节点名
  node: ProxyNode | null // 这个出站此刻会用的节点；DIRECT（与落空）为 null
  rule: Rule | null // 命中的规则行；表尾没兜 MATCH 落空时为 null
  index: number // 命中第几行（从 0 数）；落空为 -1
}

export interface ProbeScore {
  name: string
  delayMs: number | null // null = 超时或失败
}

export interface GroupDecision {
  group: string
  type: 'select' | 'url-test'
  chosen: string // 此刻会出的节点名
  scores?: ProbeScore[] // url-test 的成绩单（select 没有这张单）
}

export interface Router {
  route(target: ProxyTarget): RouteVerdict // 只判决不建线：demo 打印组决策用
  connect(target: ProxyTarget): Promise<ProxyTarget | Duplex> // 直接可作 onConnect 钩子：判决、选节点、建线一气呵成
  select(group: string, choice: string): void // select 组手动换人：规则行不动
  decisions(): GroupDecision[] // 各组此刻的决策快照
}
```

本体一处不藏。

```ts
// src/config.ts · createRouter —— 判决（规则引擎）→ 出站（组策略）→ 建线（直连或节点的加密两跳）
export async function createRouter(config: Config): Promise<Router> {
  const nodes = new Map(config.proxies.map((p) => [p.name, p] as const))
  const groupByName = new Map(config.groups.map((g) => [g.name, g] as const))
  const current = new Map<string, string>() // 每组「此刻出谁」：select 是当前选择，url-test 是当前赢家
  const scoresByGroup = new Map<string, ProbeScore[]>()

  for (const g of config.groups) {
    if (g.type !== 'url-test') {
      current.set(g.name, g.proxies[0]) // select 默认出名单第一个
      continue
    }
    // url-test：建路由器时现场测一轮——经由每台组员向测速 URL 发请求，谁的首字节先回来谁快
    const scores: ProbeScore[] = []
    for (const name of g.proxies) {
      const delayMs = await probeNode(nodes.get(name)!, g.url, g.timeoutMs ?? 2000)
      scores.push({ name, delayMs })
    }
    scoresByGroup.set(g.name, scores)
    const alive = scores.filter((s) => s.delayMs !== null)
    // 并列与全灭都按先来后到：名单第一个——测不出差距时，位置就是规则
    const best = alive.length === 0 ? g.proxies[0] : alive.reduce((a, b) => ((a.delayMs as number) <= (b.delayMs as number) ? a : b)).name
    current.set(g.name, best)
  }

  // 出站名 → 此刻的节点：DIRECT 不是名字是语义（null）；组名问 current；节点名直呼直应
  const nodeOf = (outbound: string): ProxyNode | null => {
    if (outbound === 'DIRECT') return null
    const chosen = current.get(outbound)
    return chosen === undefined ? nodes.get(outbound)! : nodes.get(chosen)!
  }

  const route = (target: ProxyTarget): RouteVerdict => {
    const hit = matchTarget(config.rules, target)
    const outbound = hit === null ? 'DIRECT' : hit.rule.outbound // 落空按 DIRECT 收场：引擎只管判决，兜法由路由器定
    return { outbound, node: nodeOf(outbound), rule: hit === null ? null : hit.rule, index: hit === null ? -1 : hit.index }
  }

  const connect = async (target: ProxyTarget): Promise<ProxyTarget | Duplex> => {
    const { node } = route(target)
    // DIRECT / 落空：把原目标交回，入口照直连（与第 7 章接线同款）；否则经选中的节点走加密两跳
    return node === null ? target : connectViaRelay({ host: node.host, port: node.port }, target, node.password)
  }

  const select = (group: string, choice: string): void => {
    const g = groupByName.get(group)
    if (g === undefined) throw new Error(`没有叫「${group}」的组`)
    if (g.type !== 'select') throw new Error(`select 只管 select 组：「${group}」是 url-test，谁快谁上，不收手动指定`)
    if (!g.proxies.includes(choice)) throw new Error(`「${choice}」不在组「${group}」的名单里`)
    current.set(group, choice)
  }

  const decisions = (): GroupDecision[] =>
    config.groups.map((g) => {
      const chosen = current.get(g.name)!
      return g.type === 'select' ? { group: g.name, type: 'select', chosen } : { group: g.name, type: 'url-test', chosen, scores: scoresByGroup.get(g.name)! }
    })

  return { route, connect, select, decisions }
}
```

三个读点。`current` 这张小表是全部组状态的落点：select 存「当前选择」，url-test 存「当前赢家」，`nodeOf` 只需要问它——判决侧完全不关心组的类型。url-test 的胜负只在建路由器时测一轮：`alive` 过滤掉没成绩的，`reduce` 选最小；并列（以及全灭）都按名单先来后到——测不出差距时，位置就是规则。`connect` 与 `route` 分开留：demo 与测试打印判决用 `route`，真要建线才 `connect`；而 `connect` 的签名恰好就是第 3 章那个 `onConnect` 钩子的形状，入口接线从此一行。

```ts
// tests/config-groups.test.ts · 钩子直接交给路由器（节选）
    const entry = await startSocks5Server({ port: 0, onConnect: router.connect }) // 钩子直接交给路由器：判决、选节点、建线一气呵成
```

第 7 章测试里那段 `routeByRules` 接线，至此升级成一个对象方法——判决、选节点、建线搬进了路由器，入口的 SOCKS5 状态机照旧一行没动。

### 10.4.4 钉边界的用例

7 条用例挑三组承重的说。第一组钉里程碑：同一份代码、同一个目标，只改配置文本里的一行，判决翻转。

```ts
// tests/config-groups.test.ts · 只改配置 JSON 的一行（节选）
    const toChoose = await createRouter(loadConfig(configText(world, ['DOMAIN-SUFFIX,example.com,choose', 'MATCH,DIRECT'])))
    const toDirect = await createRouter(loadConfig(configText(world, ['DOMAIN-SUFFIX,example.com,DIRECT', 'MATCH,DIRECT'])))
    const a = toChoose.route(target)
    const b = toDirect.route(target)
    expect(a.outbound).toBe('choose')
    expect(a.node?.name).toBe('node-fast')
    expect(b.outbound).toBe('DIRECT')
    expect(b.node).toBeNull() // 同一份代码、同一个目标：配置文本里改了一行，出站换了人
```

第二组钉 url-test：慢桩故意排在名单前面——先来后到的兜底压不住它，成绩说话。

```ts
// tests/config-groups.test.ts · url-test 成绩单（节选）
    const auto = router.decisions().find((g) => g.group === 'auto')
    expect(auto?.type).toBe('url-test')
    expect(auto?.chosen).toBe('node-fast') // 名单里慢桩在前——并列时先来后到，但这里不并列：成绩说话
    const scores = new Map(auto?.scores?.map((s) => [s.name, s.delayMs]))
    expect(scores.get('node-fast')!).toBeLessThan(100) // 快桩：本机直来直回
    expect(scores.get('node-slow')!).toBeGreaterThan(120) // 慢桩：每批字节压了 120ms
```

第三组是集成用例的下半场：`select` 换人之后，同一条规则表再拜访一次，连接跟着搬家。

```ts
// tests/config-groups.test.ts · 集成用例的切换（节选）
    await speak('before-switch') // choose 默认 node-fast：连接到快桩
    expect(world.fast.connections()).toBe(baseFast + 1)
    expect(world.slow.connections()).toBe(baseSlow)

    router.select('choose', 'node-slow') // 切组不切规则：第 0 行还是 choose，出的节点换了人
    await speak('after-switch')
    expect(world.fast.connections()).toBe(baseFast + 1)
    expect(world.slow.connections()).toBe(baseSlow + 1) // 这次连接到了慢桩——组内选谁由策略定，规则行纹丝没动
```

两台节点各带各的密码（pw-fast 与 pw-slow），货能送到就证明路由器没拿错钥匙。剩下的一组校验用例把 `$.inbound.port`、撞名、组员不在册、`PROXY` 旧出站这些报错逐一钉死——错误消息里的路径本身就是被断言的行为。

## 10.5 验证：亲手开机，看组决策

**开机。** 进 `companion/` 跑 `npm run demo:config-groups`。它拉起六个角色：回环测速应答器、两台各带锁的中继、快桩前的透明探针、慢桩前压 120ms 的转发器，再加上行协议目标站——照旧全住回环地址，不出机器。四幕应看到（端口与延迟数字每次略有出入）。

```text
# companion 的 demo:config-groups 输出节录
—— 第一幕：配置错在加载时——带路径报出，进不了运行时 ——
  loadConfig 抛错：$.groups[0].proxies[2]：「node-ghost」不在节点名册里（教学版组员只能是节点，组套组不做）

—— 第二幕：createRouter 现场测速，组决策亮出来 ——
  组 choose（select）  此刻出: node-fast（默认名单第一个，随时可切）
  组 auto（url-test） 探测 node-slow 506ms，node-fast 3ms
  组 auto（url-test） 此刻出: node-fast ← 成绩说话，慢桩排在名单前面也选不出它

—— 第三幕：只改配置 JSON 的第 0 行（choose → DIRECT），同一目标判决翻转 ——
  mail.example.com:443
    配置 A  判决 → 命中第 0 行 → 出站 choose → 此刻出节点 node-fast
    配置 B  判决 → 命中第 0 行 → 出站 DIRECT（直连，无节点）

—— 第四幕：入口接上路由器——select 切节点，规则行不动，连接搬家 ——
  第 1 次拜访 localhost → 回声 BEFORE（货送到）→ 快桩连接 1，慢桩连接 0
  router.select('choose', 'node-slow')：组内换人，规则行一字未动
  第 2 次拜访同一目标 → 回声 AFTER（货送到）→ 快桩连接 1，慢桩连接 1
```

第一幕的报错值得盯着看一眼：路径直指 `$.groups[0].proxies[2]`，翻都不用翻。第二幕的成绩单里慢桩 506ms——两跳握手加上每批 120ms 的转发延迟，四批字节叠出来就是这个量级；快桩 3ms 是本机直来直回的行情。第三幕两行判决只差在出站：同一份代码、同一个目标，配置文本里改了一行。第四幕是间接层的链路实证：select 换人之后，连接从快桩搬到慢桩，规则行与入口状态机都没动。顺手跑 `npm test`，68 条全绿。

**先猜后跑（指认破坏）。** 打开 `demo/config-groups-demo.ts`，把 auto 组 `url` 里的端口改成一个没人监听的端口（比如原端口加 1000）。跑之前写下预言：第二幕成绩单里两个数字各是多少？auto 此刻出谁？第三、四幕受不受影响？跑 `npm run demo:config-groups` 验证（会多等几秒——每台节点都要等满 2 秒超时）。答案：两个数字都变成 null（测速目标不可达，探测失败），auto 此刻出 node-slow——全灭时按名单先来后到，慢桩排在名单第一个，就这么上了位。第三、四幕不受影响：它们走的是 choose 组，select 不探测。改回原样再跑，成绩单恢复。这一跑把「全灭回退名单第一个」从一句注释变成你亲眼见过的事。

**自包含复算。** 10.3.3 的 `ttfb.mjs` 拿 node 一个文件就能跑，「首字节」与「全部到齐」差的那段就是探测要避开的正文；探测在实验场里的对应实现见 10.4.2 的 `probeNode`（停表挂在 `t.once('data', ...)` 那行）。

## 10.6 收束：菜单接管厨房

回到开篇那两处别扭。换个节点为什么要改代码——因为节点曾是代码里的常量；现在节点是 `$.proxies` 里的一行文本，换台机器改的是菜单不是厨师。面板里那个自动跳到的最低延迟凭什么成立——它是一次真实的探测：经由节点向测速 URL 发一个 HEAD 请求，从拨号到应答首字节的整段往返计一次成绩，url-test 组拿成绩单选人；你现在能从起表那一行读到停表那一行，说出这个数字量的是哪一段路。

第 6 章末的承诺在这章清账：端口、密码、节点、组、规则全部搬进配置文本，`loadConfig` 带路径校验，错误进不了运行时。你手里多了第八块零件：`src/config.ts` 的 `loadConfig` 与 `createRouter`，加上 `src/rules.ts` 出站语义的名册加宽——判决、组策略、建线从此是一条流水线，`connect` 直接就是入口钩子的形状。可迁移的解法两件：数据与逻辑分离——把「会变的」从「不变的」里拆出来，会变的降级为可整体校验的文本；间接层——让引用方依赖一个稳定的名字，把「此刻用谁」的决定权收进名字背后。

概念去向地图：

- 配置已经能驱动一切零件，但它们还各自为政——第 11 章总装把入口、fake-ip DNS、规则、组、隧道、远端串成 `startMiniClash(config)`，一条命令拉起整机；
- url-test 的周期重测、容差与 lazy 等真实机制，以及组套组、更多组类型，登记在差异清单，第 12 章差异地图统一对账。

### 自查

1. 预测：把 auto 组的名单改成 `["node-fast", "node-slow"]`（快桩在前），再把测速 URL 指到没人监听的端口——auto 此刻出谁？为什么与名单顺序有关？
2. 判断：`router.select('choose', 'node-slow')` 之后，`matchTarget` 对同一个目标的判决结果变了吗？`route` 返回的 `outbound` 变了吗？`node` 呢？
3. 动手：把 `probeNode` 里的停表从「首字节」挪到「收线」（`t.once('close', ...)` 里停表）。跑之前预言：demo 第二幕的成绩单数字会变吗？变化大不大？为什么？

::: details 参考答案与锚点
1. 出 node-fast。两台节点都探测失败（全灭），回退名单第一个——快桩此刻排在第一（回查 10.4.3 的「并列与全灭都按先来后到」与 10.5 的指认破坏）。
2. 都不变：`matchTarget` 读的是规则表，判决出的出站仍是 choose；`route` 的 `outbound` 还是 choose。变的只有 `node`——组的当前选择换了人，这正是间接层拆开的两件事（回查 10.3.2 与 10.4.3 的 `nodeOf`）。
3. 几乎不变。测速应答是 204、没有正文，首字节到达与收线几乎同刻——这也正是真实测速端点用 generate_204 的原因：没有正文可等，停表点选在哪都不影响度量（回查 10.3.3 与 `ttfb.mjs` 的对照）。
:::
