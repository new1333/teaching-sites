---
title: 规则引擎：流量的调度台
---

# 规则引擎：流量的调度台

## 7.1 前情：锁装好了，可它见谁锁谁

三个问题，接上第 6 章的尾巴：

- 加密两跳是装好了——入口到远端的每一帧都上了认证加密的锁，可入口现在对每个目标都走这条两跳链路。访问就在本机回环地址上的实验站，也要先出趟远门去远端中继再折回来。谁该直连、谁该走隧道，这个判决由谁来做？
- 第 3 章埋的 `onConnect` 钩子，至今只在测试里被写死成「一律交给远端」——分流的那一格一直空着。
- 判决要的原料，入口手里其实早就有：SOCKS5 的 CONNECT 报文带着完整目标，域名或 IP 两种形态（ATYP 那一格）都收。

这一章把这些接起来：把一张规则表变成一台会判决的规则引擎，再让入口按判决选线。

## 7.2 全走代理的代价

你大概已经试过了：把全部流量都丢给代理节点，访问那些就近可达的站点，也要先送到远端节点转一大圈——明明隔壁就是目的地，数据却像绕地球一圈才到。看视频的时候这件事最疼：画面卡成幻灯片，因为每一秒的画面都在替你多跑几万公里。

于是你改回全直连。这回轮到另一头疼：那些只有经由远端才可达的站点，连接全部超时。一刀切怎么切都有人受伤——你真正想要的是一张名单：这些目标走直连，那些目标走隧道，剩下的按默认来。

你抄来一张 Clash 规则表，五行就够意思了：域名行、后缀行、关键字行、网段行，末尾一行 MATCH 兜底。可抄的时候手一滑，把 MATCH 那行放到了最前面。表面上一切正常——表能读、行行都合法——分流却整体失灵：本该走隧道的全按兜底行直连了。你能想到原因吗？

「MATCH 放最前」这个手滑，与一刀切的两种疼，是同一件事的三个侧面：分流不是一个「查不查得到」的问题，而是一个「按什么顺序、凭什么判」的问题。这一章就把这台调度台写出来——给这台正向代理装上分流的大脑，并让你亲眼看到兜底行抢跑时都发生了什么。

## 7.3 原理：一行一行判，判中即停

### 7.3.1 规则行：五种形态与两条出站

先立词。规则引擎（rule engine）——拿着目标（域名或 IP）在规则表里逐行对号、判出「走哪条出站」的部件，Clash 的分流大脑。它读的不是代码，是一行一行的规则；每行最后一段写着出站。出站此刻只有两条线：直连（DIRECT）——不走任何节点，本机直接连目标；PROXY——交给第 6 章的加密两跳，由远端代连。本章五种规则行的写法沿用 Clash 的公开语义，形如 `DOMAIN-SUFFIX,google.com,DIRECT` 这样的逗号分段（解析器是我们自写的教学版）。

| 规则行写法 | 本章叫法 | 命中条件 |
| --- | --- | --- |
| `DOMAIN,example.com,PROXY` | 域名全等 | 目标域名与参数一字不差 |
| `DOMAIN-SUFFIX,google.com,DIRECT` | 域名后缀规则（DOMAIN-SUFFIX） | 目标是参数本尊或其子域——按点边界，不是子串 |
| `DOMAIN-KEYWORD,ads,DIRECT` | 域名关键字 | 目标域名的字串里含参数——这回才是子串 |
| `IP-CIDR,203.0.113.0/24,DIRECT` | 网段规则（IP-CIDR） | 目标 IP 落在参数网段内 |
| `MATCH,DIRECT` | 兜底规则（MATCH） | 其余全部，永远命中 |

两个规矩先说破。其一，规则行只看目标的主机名（域名或 IP），不看端口——端口是房间号，判决只管「去哪栋楼、走哪条路」。其二，前四行都是「类型,参数,出站」三段，MATCH 没有参数，只有「MATCH,出站」两段——它是兜底，不需要条件。

IP-CIDR 那行里的 `203.0.113.0/24` 是这一章最陌生的符号，值得单独一节从二进制位讲清。域名的三种行也要专门钉边界。顺序的语义放第三。最后合起来是一棵决策树。

### 7.3.2 IP 地址与 CIDR：32 个格子与一条分界线

先补地基。IP 地址与 CIDR 是一对词：IP 地址——IPv4 里标识一台主机的 32 位编号，点分的四段（如 `203.0.113.7`）只是这 32 个格子的方便写法，每 8 位一段写成十进制；CIDR——把「前多少位算网段」写在斜杠后面的记法，`/24` 就是「前 24 位是网段部分」。锚点还是第 1 章那句：门牌与整条街——`203.0.113.0/24` 是「203.0.113 这条街上 0～255 号全部门牌」。顺带一提，`203.0.113.x`、`192.0.2.x`、`198.51.100.x` 是 RFC 5737 划出的文档示例网段，专门印在教程与文档里，不会分给真实主机——本章示例全用它们，不会误伤谁。

为什么需要 CIDR 这把刀？IPv4 的 32 位结构出自 RFC 791，最早的分法是按开头几位的模式把地址切成固定的类：A 类刀口在 /8，B 类在 /16，C 类在 /24——三把固定的刀，刀口只能落在字节边界上。反事实摆出来就看出问题：一个有 300 台主机的机构，领一个 B 类要占用 65,534 个门牌，绝大多数睡大觉；领两个 C 类，外层路由表就要多背两条零散的路由。1993 年的 CIDR（RFC 1519，现行整理为 RFC 4632）把刀口放开：前缀长度可以是 0 到 32 的任何数，刀口想落在哪个 bit 都行。网段因此可以聚大（一条 /20 顶 16 条 /24），也可以切细（一个 /32 恰好是一个门牌）。

刀怎么用？三样东西：掩码、按位与、网号。掩码（mask）——与地址同长的 32 位串：前 N 位全 1（N 由前缀说了算），其余全 0，`/24` 的掩码就是 `255.255.255.0`。按位与——两串位对齐了逐位相乘的运算：两位都是 1 才得 1，否则得 0；它与 0 相与会「抹零」、与 1 相与会「保留」，正好拿来把门牌部分抹掉、把网段部分留下。留下的结果叫网号——这条街的名字。

跟着算一遍真实字节。目标 `203.0.113.7`，规则 `IP-CIDR,203.0.113.0/24`。

```text
段:            第 1 段       第 2 段      第 3 段      第 4 段
203.0.113.7 =  11001011      00000000    01110001    00000111
/24 掩码    =  11111111      11111111    11111111    00000000
按位与      =  11001011      00000000    01110001    00000000   → 203.0.113.0
```

前三段与全 1 相与原样保留，末段与全 0 相与整段抹零——网号 `203.0.113.0`，与规则里的网段起点一字不差：同一条街，命中。换成 `203.0.114.7`，第三段保留下来是 114，网号成了 `203.0.114.0`，对不上起点：隔街，不命中。

刀口落在字节中间才见真章。`192.0.0.0/22` 的掩码是 `255.255.252.0`——252 的二进制是 `11111100`，刀口切在第三段第 6 位之后。

```text
192.0.3.77 =  11000000      00000000    00000011    01001101
/22 掩码   =  11111111      11111111    11111100    00000000
                                             ↑ 刀口：前 22 位是网段，后 10 位是门牌
按位与     =  11000000      00000000    00000000    00000000   → 192.0.0.0，对上起点：同街
```

第三段的 3（`00000011`）与 `11111100` 相与得 0——门牌部分被抹掉，网号仍是起点 `192.0.0.0`，命中。而 `192.0.4.1` 的第三段是 4（`00000100`），相与得 4，网号 `192.0.4.0` 对不上：出了街。这个 /22 圈住的是第三段为 0、1、2、3 的四条 /24 街——刀口不在字节边界上，切割照样精确到每一户。

不进实验场也能复算。三行 node 就够。

```js
// 用法示例：存成 cidr.mjs，node cidr.mjs —— 掩码按位与，亲手跟一遍
const ip = (s) => s.split('.').reduce((n, o) => (n << 8) | Number(o), 0) >>> 0
const mask = (bits) => (bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0) // /0 全零掩码要单列：JS 移位量按 32 取模，1 << 32 会原样回到 1
const inCidr = (addr, cidr) => {
  const [net, bits] = cidr.split('/')
  return ((ip(addr) & mask(Number(bits))) >>> 0) === ip(net) // 与出网号，对上网段起点就是同街
}
console.log(inCidr('192.0.3.77', '192.0.0.0/22')) // true：刀口在第三段中间，3 仍在这条街上
console.log(inCidr('192.0.4.1', '192.0.0.0/22')) // false：4 出了街
console.log(inCidr('203.0.113.7', '203.0.113.0/24')) // true：整字节对齐只是特例
```

末尾那个 `>>> 0` 是 JavaScript 的一处工程暗坑，值得单独点名。JS 的位运算按有符号 32 位进行，`203.0.113.7` 折成的整数超过 2 的 31 次方，在位运算里成了负数。比较前要用 `>>> 0` 转回无符号——实验场里同一行注释会再出现一次。

### 7.3.3 域名三种行：全等、后缀与关键字

域名的三种行好在结构直观：域名是分层的，一个点分一级，像一棵倒挂的树。`DOMAIN-SUFFIX,google.com` 圈住的是 `google.com` 这个节点连同它的整棵子树。

```text
com
 └─ google.com                 ← DOMAIN-SUFFIX,google.com 圈住这棵子树（本尊在内）
     ├─ mail.google.com        ← 命中：一个点分一级，还挂在树上
     └─ maps.google.com        ← 命中
art
 └─ google.art                 ← 不命中：另一棵树，撞名不算
com
 └─ agoogle.com                ← 不命中：前一段整体不同，按点边界对不齐
```

边界就一条：目标要么与参数一字不差（本尊），要么以 `.参数` 结尾（子域）——多一个字母、少一个点都不行。`mail.google.com` 命中，`google.art` 不命中，`agoogle.com` 不命中。后缀看的是树的归属，不是字串的包含。

`DOMAIN-KEYWORD` 正相反，它看的就是字串包含：`DOMAIN-KEYWORD,google` 对 `google.art` 与 `agoogle.com` 都命中。两种行语义不同、用途互补——后缀行管「这一家及其子域」，关键字行管「名字里带这个词的」（常用来拦广告域名）。`DOMAIN` 全等则是最严的一档，本尊命中、子域不认。三者都在 7.4 的用例里钉了边界。另有一个工程细节：域名大小写不敏感，`MAIL.Google.COM` 与 `mail.google.com` 是同一个名字，引擎比较前先统一小写。

### 7.3.4 顺序就是优先级：「找得到就命中」不成立

现在回答 7.2 的手滑。你可能带着这样一个直觉：规则表是一张查找表，目标「在表里找得到」就命中，跟写在哪行没关系。这个直觉有它的来路——查表确实常常与顺序无关，而且规则表长得就很像数据库。但分流的规则表不是这样工作的：**它是从上往下逐行问过去的，第一条命中的行说了算，问完即停**。顺序不是排版，顺序就是优先级本身。

两张表做个对照就能证伪直觉。表 A 与表 B 内容完全相同——`DOMAIN-SUFFIX,example.com,PROXY` 与 `MATCH,DIRECT`——只是两行的位置对调。目标都是 `www.example.com`，两张表里都「找得到」它，判决却相反：表 A 判 PROXY（后缀行在前，先问到它），表 B 判 DIRECT（MATCH 在前，兜底先行，后缀行根本没被问到）。目标没变、规则没变，只换顺序就翻案——「找得到就命中」在这里不成立。7.2 那次手滑是同一个原理的极端版：MATCH 永远命中，它抢到最前面，后面所有专线全部作废，分流整体失灵。

这翻案不是坏事，是可以利用的语义。正因为顺序即优先级，规则表才能写出「例外优先、通例殿后」的安排：把 `DOMAIN,ads.example.com,DIRECT` 写在 `DOMAIN-SUFFIX,example.com,PROXY` 前面，这家站点的广告子域就单独直连，其余照旧走隧道——先问到的算数，后问到的没意见。

### 7.3.5 决策树：有域名先不解析

还剩一个组织问题：域名行与 IP 行在一张表里混着，域名目标没有 IP，怎么试 IP 行？反过来，IP 目标没有名字，域名行对它意味着什么？

答案是各有各的失明，而且是有原因的。目标手里只有域名时，要试 `IP-CIDR` 得先把域名解析成 IP——那就是一次 DNS 查询。反事实摆出来：如果引擎见行就试，每条连接在判决前都要先做一次 DNS 查询——访问就在隔壁的目标也要先查一遍电话簿；更要紧的是，查询会把「你要去哪」提前告诉查询链路上的每个中转。所以真实 Clash 的做法是域名行先试、试到 IP 行且确实是域名目标时才考虑解析（还提供 `no-resolve` 选项明说不解析）。教学版走得更干脆：**有域名先不做 DNS 解析**——域名目标的命运只由域名行与 MATCH 决定，IP 行一律跳过。名字这一关怎么在本地接管，第 8 章展开。

反方向的失明是结构性的：目标是一串 IP 字面量（如 `203.0.113.7`）时，它没有「名字」，三种域名行对它无从谈起——哪怕字面里恰好含着关键字也不认。所以决策树整理出来只有三句话：目标是域名，按序试三种域名行，IP 行跳过；目标是 IP 字面量，按序试 IP 行，域名行跳过；MATCH 对谁都开门。走序不变，只是每类行各有各的适用对象——「顺序即优先级」的原语义一点没动。

## 7.4 演练：把调度台写出来

实验场开工。`src/rules.ts` 是本章主件——纯函数模块，不碰网络、不碰 socket，判决的全部依据是传进来的目标。测试 `tests/rule-engine.test.ts` 照旧先写、先跑出红（模块不存在，加载即失败），再写实现转绿，11 条用例。门槛命令照旧是 `cd companion && npm run typecheck && npm test`，全绿应为 41 条（旧 30 + 本章 11）——旧用例一字未动还全绿，就是「规则引擎不碰既有链路」的机械证据：`src/socks5.ts` 与 `src/relay.ts` 本章一个字符没改，判决接在钩子上，不接在链路里。

### 7.4.1 parseRules：解析一次，错在加载时

两个数字小件先立起来：IP 字面量转 32 位整数，前缀转掩码。

```ts
// src/rules.ts · parseIpv4 / maskOf
// '203.0.113.7' → 一个 32 位无符号整数（0xCB007100 + 低位）；不像 IPv4 字面量则返回 null。
// IPv4 地址在 RFC 791 里就是 32 位，点分的四段只是「每 8 位写成一格十进制」的方便记法
function parseIpv4(host: string): number | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null // 只认 1..3 位数字，'1e2'、'-1'、空段都不认
    const v = Number(p)
    if (v > 255) return null // 每段 8 位，封顶 255
    n = n * 256 + v // 四段从左到右就是 32 位的高位到低位：逐段左移拼进一个整数
  }
  return n >>> 0 // JS 位运算按有符号 32 位算，>>> 0 转回无符号
}

// 前缀长度 → 掩码：前 bits 位全 1、其余全 0（/24 → 0xFFFFFF00）。
// bits=0 要单列：JS 的移位量按 32 取模，1 << 32 原样回到 1，「全零掩码」反而做不出来
function maskOf(bits: number): number {
  return bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
}
```

`parseIpv4` 就是 7.3.2 那张 32 格图的代码形态；`maskOf` 的注释把 REPL 片段里那行 `>>> 0` 的坑又钉了一遍。规则对象先看形状。

```ts
// src/rules.ts · Outbound 与 Rule
// 出站：DIRECT = 本机直连目标；PROXY = 第 6 章的加密两跳（远端由调用参数指定）。
// 第 10 章起还可以是配置名册里的组名/节点名（「string & {}」交集写法：保留这两条的自动补全，又不拒收别的名字）
export type Outbound = 'DIRECT' | 'PROXY' | (string & {})

export type Rule =
  | { type: 'DOMAIN'; value: string; outbound: Outbound } // 域名全等：一字不差才算
  | { type: 'DOMAIN-SUFFIX'; value: string; outbound: Outbound } // 域名后缀：本尊与其子域（按点边界，不是子串）
  | { type: 'DOMAIN-KEYWORD'; value: string; outbound: Outbound } // 域名关键字：串里含这个词就算
  | { type: 'IP-CIDR'; value: string; net: number; mask: number; outbound: Outbound } // 网段：解析一次存成整数对，匹配只做按位与
  | { type: 'MATCH'; outbound: Outbound } // 兜底：其余全部
```

IP-CIDR 行多出的 `net` 与 `mask` 两格是「解析一次，匹配多次」的落点：规则表在启动时解析一遍，每条连接判决时只做一次按位与，不再反复切字符串。

解析器本体。纪律只有一条：坏行带着行号尽早抛错——规则表是配置，错在加载时暴露，不留给每条连接去撞。

```ts
// src/rules.ts · parseRules
// 解析规则表。坏行带着行号尽早抛错——规则表是配置，错在加载时暴露，不留给每条连接去撞。
// knownOutbounds（可选名册）：第 10 章的配置把「已声明的组名与节点名」带进来，出站从此可以是名册里的名字；
// 不报名册时行为与从前一字不差——只认 DIRECT 与 PROXY 两条线
export function parseRules(lines: string[], knownOutbounds?: readonly string[]): Rule[] {
  const out: Rule[] = []
  lines.forEach((raw, i) => {
    const line = raw.trim()
    const seg = line.split(',')
    const where = `第 ${i + 1} 行「${line}」`
    const outbound = (s: string): Outbound => {
      if (s !== 'DIRECT' && s !== 'PROXY' && !(knownOutbounds ?? []).includes(s))
        throw new Error(`${where}：出站只认 DIRECT 或 PROXY，看不懂「${s}」`)
      return s
    }
    if (seg[0] === 'MATCH') {
      if (seg.length !== 2) throw new Error(`${where}：MATCH 没有参数，只有「MATCH,出站」两段`)
      out.push({ type: 'MATCH', outbound: outbound(seg[1]) })
      return
    }
    if (seg.length !== 3) throw new Error(`${where}：应为「类型,参数,出站」三段，实得 ${seg.length} 段`)
    const value = seg[1]
    if (value === '') throw new Error(`${where}：参数是空的`)
    if (seg[0] === 'DOMAIN' || seg[0] === 'DOMAIN-KEYWORD') {
      out.push({ type: seg[0], value: value.toLowerCase(), outbound: outbound(seg[2]) }) // 域名大小写不敏感，入库先统一小写
    } else if (seg[0] === 'DOMAIN-SUFFIX') {
      out.push({ type: 'DOMAIN-SUFFIX', value: value.toLowerCase(), outbound: outbound(seg[2]) })
    } else if (seg[0] === 'IP-CIDR') {
      const [addr, prefix] = value.split('/')
      const net = parseIpv4(addr ?? '')
      const bits = prefix === undefined ? NaN : Number(prefix)
      if (net === null || !/^\d{1,2}$/.test(prefix ?? '') || bits > 32)
        throw new Error(`${where}：IP-CIDR 的参数应为「IPv4 地址/前缀长度(0..32)」，看不懂「${value}」`)
      out.push({ type: 'IP-CIDR', value, net, mask: maskOf(bits), outbound: outbound(seg[2]) }) // 解析一次，匹配多次
    } else {
      throw new Error(`${where}：不认识的规则类型「${seg[0]}」（教学版只做 DOMAIN / DOMAIN-SUFFIX / DOMAIN-KEYWORD / IP-CIDR / MATCH）`)
    }
  })
  return out
}
```

三个读点。`outbound` 检查默认收紧在两条线上——不报名册时，`MY-NODE` 这类名字在解析期就被拒绝；名册由配置一章带进来，届时代理组名成为合法出站（真实 Clash 的出站本就是任意代理组名）。MATCH 的段数单独校验，堵住「MATCH,DIRECT,EXTRA」这类手滑。IP-CIDR 分支里 `net` 与 `bits` 的双重检查，把 `203.0.113.0/33` 与 `abc/24` 都拦在加载时。

### 7.4.2 matchTarget：一行一行问，问中即回

判决器本体——7.3.4 与 7.3.5 的全部语义都在这一个函数里。

```ts
// src/rules.ts · matchTarget
export function matchTarget(rules: Rule[], target: ProxyTarget): MatchOutcome | null {
  const host = target.host.toLowerCase()
  const asIp = parseIpv4(target.host) // 是 IP 字面量则拿到 32 位整数；是域名则是 null
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i]
    const hit =
      r.type === 'MATCH'
        ? true
        : r.type === 'IP-CIDR'
          ? asIp !== null && ((asIp & r.mask) >>> 0) === r.net // 按位与出网号：与网段起点对上就是同街（>>> 0 转回无符号再比）
          : asIp === null && // 域名行只对域名目标开门
            (r.type === 'DOMAIN'
              ? host === r.value
              : r.type === 'DOMAIN-SUFFIX'
                ? host === r.value || host.endsWith('.' + r.value) // 本尊或子域：按点边界，不是子串
                : host.includes(r.value)) // DOMAIN-KEYWORD：子串语义
    if (hit) return { rule: r, index: i }
  }
  return null // 一行都没命中（表尾没兜 MATCH 才会走到这）：怎么收场由调用方定
}
```

结构是「一个 for、一条三元链」。for 循环从上到下走序——第一条命中即 `return`，后面的行再想管也轮不到，这就是「顺序即优先级」的全部实现。三元链按 7.3.5 的决策树展开：MATCH 永远开门；IP-CIDR 行要求目标手里真有 IP（`asIp !== null`），命中条件就是 7.3.2 算过的按位与；三种域名行要求目标是域名（`asIp === null`），其中后缀行的 `host.endsWith('.' + r.value)` 把点边界写死在表达式里——那个 `.` 前缀就是 `google.art` 与 `agoogle.com` 都进不来的原因。落空返回 `null`，怎么收场由调用方定——引擎只管判决，不替入口做主。

### 7.4.3 接线：onConnect 先问判决，再选线

第 3 章的钩子在此上岗。`SocksConnectHook` 的回话三选一（没装钩子照直连 / 回地址直连 / 交回流当上游线），正好够把两条出站接上：判 PROXY 就交回 `connectViaRelay` 的流（第 6 章的加密两跳），否则把原目标原样交回（照它直连）。接线长在测试里，一台入口一台判决。

```ts
// tests/rule-engine.test.ts · routeByRules —— 入口接线：先问判决，再选线
function routeByRules(rules: Rule[], relayPort: number, password = PASSWORD) {
  return (t: { host: string; port: number }) => {
    const hit = matchTarget(rules, t)
    return hit !== null && hit.rule.outbound === 'PROXY'
      ? connectViaRelay({ host: '127.0.0.1', port: relayPort }, t, password)
      : t
  }
}
```

这段接线值得看清的是它与链路的解耦。`src/socks5.ts` 的状态机一行没动。钩子交回来的可能是直连的 socket，也可能是加密两跳的转接头。对入口的中继逻辑而言，两者都是一根能读能写的管子（`Duplex`），字节流照搬。整机把入口、判决、隧道、远端串成一条命令的总装，是本书最后一部分的功课；本章到「判决真实改变连接走法」为止。

判没判对，连接数说话。集成用例在远端门前立了一台计数探针（透明转发、只数连接），同一目标、同样两行规则，只换顺序。

```ts
// tests/rule-engine.test.ts · 集成用例的两台入口（序一与序二）
    // 序一：127.0.0.1/32 在前 → 直连；远端一个连接都没来
    const directFirst = await startSocks5Server({
      port: 0,
      onConnect: routeByRules(parseRules(['IP-CIDR,127.0.0.1/32,DIRECT', 'MATCH,PROXY']), tap.port),
    })
```

```ts
    // 序二：同样两行倒过来 → 同一目标改走加密两跳；连接这次到了远端
    const relayFirst = await startSocks5Server({
      port: 0,
      onConnect: routeByRules(parseRules(['IP-CIDR,127.0.0.1/32,PROXY', 'MATCH,DIRECT']), tap.port),
    })
```

两台入口各收一次同样的 CONNECT，两次都拿到响应——货都送到了。但序一之后探针计数是 0、序二之后是 1。7.3.4 那场翻案就此从单元断言落到了真实链路上：判决变了，socket 实际走的线跟着变。

### 7.4.4 钉边界的用例

11 条用例里挑四组承重的说。第一组钉后缀边界，把 7.3.3 的树画进断言。

```ts
// tests/rule-engine.test.ts · 后缀边界（节选）
    expect(verdict('mail.google.com')).toBe('PROXY') // 子域：一个点分一级，仍在这棵树上
    expect(verdict('google.com')).toBe('PROXY') // 本尊也命中
    expect(verdict('google.art')).toBe('DIRECT') // 同名不同尾巴：差一个字母都不行
    expect(verdict('agoogle.com')).toBe('DIRECT') // 子串撞名：前缀多一个字母都不行——按点边界，不是按子串
```

第二组钉顺序——就是 7.3.4 那场翻案的机械化。第三组钉决策树：`0.0.0.0/0` 罩得住一切 IP，却对域名目标无效（不做解析就没有 IP 可试，整行跳过落兜底）；IP 目标则对域名行失明（字面里含 `203` 也不认关键字）。第四组是集成用例「同一张规则表」：规则表里 `DOMAIN,localhost,DIRECT` 在前、`IP-CIDR,127.0.0.0/8,PROXY` 在后——域名目标（ATYP=3 的 `localhost`）判直连，探针计数 0；IP 目标（ATYP=1 的 `127.0.0.1`）判加密两跳，计数 1。同一张表、同一个目标站，两类目标各走各的线——这正是里程碑要的「不同目标实际走不同出站」。

## 7.5 验证：亲手开机，看判决台

**开机。** 进 `companion/` 跑 `npm run demo:rule-engine`。这个 demo 拉起四个角色：双栈目标站（IPv4 与 IPv6 的来客都接）、上锁的远端中继、立在远端门前的计数探针、接了规则引擎的 SOCKS5 入口——照旧全住回环地址，不出机器。它替你走三幕，应看到（端口每次随机）。

```text
# companion 的 demo:rule-engine 输出节录
—— 第一幕：一张规则表，一组目标，逐行判决 ——
  第 0 行  DOMAIN,localhost,DIRECT
  第 1 行  DOMAIN-SUFFIX,example.com,PROXY
  第 2 行  DOMAIN-KEYWORD,ads,DIRECT
  第 3 行  IP-CIDR,203.0.113.0/24,DIRECT
  第 4 行  MATCH,PROXY

  mail.example.com:443  → PROXY  命中第 1 行 DOMAIN-SUFFIX,example.com,PROXY
  example.com.art:443  → PROXY  命中第 4 行 MATCH,PROXY
  ads.tracker.example:80  → DIRECT 命中第 2 行 DOMAIN-KEYWORD,ads,DIRECT
  203.0.113.7:80  → DIRECT 命中第 3 行 IP-CIDR,203.0.113.0/24,DIRECT
  203.0.114.7:80  → PROXY  命中第 4 行 MATCH,PROXY
  192.0.2.1:443  → PROXY  命中第 4 行 MATCH,PROXY

—— 第二幕：入口按判决分流——同一个目标站，两条线各走一遍 ——
  域名目标 localhost    收到回声 BY-NAME（货送到了）→ 此刻远端侧连接数: 0
  IP 目标 127.0.0.1     收到回声 BY-IP（货送到了）→ 此刻远端侧连接数: 1

—— 第三幕：把 MATCH 兜底行搬到最前——开篇那个手滑的复现 ——
  域名目标 localhost    收到回声 HOIST-NAME → 此刻远端侧连接数: 1
  IP 目标 127.0.0.1     收到回声 HOIST-IP → 此刻远端侧连接数: 1
```

第一幕每一行都值得对读：`example.com.art` 落到 MATCH 而不是后缀行——点边界不放行；`203.0.114.7` 落到 MATCH——隔了一条 /24 街。第二幕是同一目标站的两次拜访：浏览器只认字节流有没有回来（两次都有回声），但远端侧的连接数 0 与 1 说明两次走的是不同的线。第三幕把 MATCH 搬到第 0 行再跑一遍：两个目标都直连，专线全部作废——连接数停在 1 没再涨，7.2 那场「分流整体失灵」就在眼前。顺手跑 `npm test`，41 条全绿。

**先猜后跑（指认破坏）。** 打开 `src/rules.ts`，把 `matchTarget` 里那行 `host.endsWith('.' + r.value)` 改成 `host.endsWith(r.value)`——点边界不要了，后缀退化成子串。跑之前写下预言：11 条用例哪几条会红？demo 第一幕会有几行判决变？跑 `npm test` 与 `npm run demo:rule-engine` 验证。答案里藏着个陷阱：变红的只有后缀边界用例里的 `agoogle.com` 一条断言——点边界挡的是「前面多几个字母」型撞名，而 `google.art` 本来就不以 `google.com` 结尾，去不去点前缀都进不来。demo 第一幕一行都不变：探针目标里没有 `aexample.com` 这类子串撞名，何况 `example.com.art` 改判了出站也还是 PROXY——「命中行变了但出站没变」与「什么都不变」，都得靠跑过才知道。改回原样，41 条应全绿。

**自包含复算。** 7.3.2 的 `cidr.mjs` 拿 node 一个文件就能跑，`/22` 切在第三段中间的两次判决不进实验场也可亲手复算；实验场里的版本见 `tests/rule-engine.test.ts` 的 CIDR 用例（/24 与 /22 同一张表、/32 单门牌、隔街落兜底）。

## 7.6 收束：调度台亮灯

回到开篇那三处疼。全走代理为什么卡成幻灯片——每条连接都被一刀切送去了远端；全直连为什么有人超时——一刀切切到了另一边；MATCH 抢跑为什么整体失灵——第一条命中即停，兜底行抢到最前面，专线全部没被问到。现在你能亲口讲清这台调度台的三个承重件：规则行的五种形态各凭什么命中（点边界、按位与、全等），顺序就是优先级（翻案实验为证），决策树让域名信息留在本地（有域名先不解析）。

你手里多了第五块零件：`src/rules.ts` 的 `parseRules`（坏行带行号抛错）与 `matchTarget`（按序首中即停），加上入口 `onConnect` 的判决接线。可迁移的解法两件：「顺序即优先级」的决策表——例外优先、通例殿后，全部优先级语义压进一个数组下标；「掩码按位与」的区间判断——把「在不在一段范围里」变成一次与运算和一次比较，路由表、防火墙、ACL 里都是同一招。

概念去向地图：

- 域名目标不做 DNS 解析，IP 网段行对域名目标永远失明——下一章的 fake-ip 把「名字→IP」这一关搬进本地接管，顺带算清解析被动手脚的账；
- 规则表此刻写在测试与 demo 的参数里，出站只有两条线——第 10 章的声明式配置接管规则与端口密码，并让组名成为合法出站；
- 入口的判决接线长在测试里——第 11 章总装把入口、规则、隧道、远端串成一条命令可跑的整机。

### 自查

1. 计算：`198.18.5.9` 在不在 `198.18.4.0/22` 里？这个网段覆盖哪些地址？
2. 判断：规则表自上而下是 `IP-CIDR,10.0.0.0/8,DIRECT`、`DOMAIN-SUFFIX,internal.example,PROXY`、`MATCH,DIRECT`。目标 `db.internal.example` 判给谁？若它解析出的 IP 恰好落在 10.0.0.0/8 里，判决会因此改变吗？
3. 动手：把 demo 里 `LINES` 的第 0 行 `DOMAIN,localhost,DIRECT` 删掉再跑 `npm run demo:rule-engine`。第二幕两次连接后的远端侧连接数各是多少？第三幕结束呢？

::: details 参考答案与锚点
1. 在。第三段 5（`00000101`）与 /22 掩码第三段（`11111100`）相与得 4，网号 `198.18.4.0` 对上起点；网段覆盖第三段为 4、5、6、7 的四条 /24 街，即 `198.18.4.0`～`198.18.7.255` 共 1024 个门牌（回查 7.3.2 的跟算与 REPL 片段）。
2. 判给 PROXY。目标是域名，第 0 行 IP 行失明跳过，第 1 行后缀命中即停；判决不会改变——即使解析后在 10/8 里也轮不到那行，何况引擎压根不做这次解析（回查 7.3.5 与 7.3.4）。
3. `localhost` 失去专线后落到 MATCH,PROXY：第二幕第一次连接后计数 1、第二次后 2（原本是 0 与 1）；第三幕 MATCH,DIRECT 抢跑、都直连，计数停在 2（回查 7.5 第三幕的读法）。
:::
