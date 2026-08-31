---
title: 规则引擎：第一条命中为什么决定一切
---

# 规则引擎：第一条命中为什么决定一切

## 兑现第 1 章埋下的承诺

第 1 章画出入口、路由、出站三段模型时，路由这一段只停留在一句话上：由规则引擎判断该走直连、拒绝还是转发。这一章把这句话变成一个真正能运行、能测试的纯函数。不涉及任何网络 I/O，只是一段根据连接信息做决策的逻辑——这也是为什么本章的验证不需要起服务器，只需要构造数据直接调用函数。

## 一条规则失灵，一条规则被架空

设想一份规则配置：先写一条"域名是 `example.com` 就直连"，后面又写了一条更具体的"域名是 `evil-example.com` 就拒绝"。上线之后发现两个奇怪的现象：访问 `evil-example.com` 意外直连，明明后面那条拒绝规则看起来应该管用；而如果把两条规则的顺序对调，拒绝规则又变成了对谁都永远不生效，形同虚设。

这不是配置写错了，是对规则引擎工作方式的理解错了。这一章要说清楚：一份规则列表到底是怎么被读的。

## 首条命中：从上到下，碰到第一条符合的就结束

规则引擎要做的事可以用一句话概括：给定一条连接的信息，从规则列表第一条开始逐条检查，只要某条规则的条件满足，立刻采用这条规则的动作，后面的规则完全不再看。这种工作方式叫"首条命中"（first match）：它更像一串 `if / else if / else if`，不像"挑出最匹配的那一条"。

这直接推翻了开头的误解：**规则越具体，并不会自动覆盖排在它前面的宽规则**。如果一条宽泛的 `DOMAIN-SUFFIX` 规则排在前面，它会先拦住所有匹配的连接，后面写得再精确的规则也没有机会被检查到——顺序本身就是优先级，跟规则写得"具体"还是"笼统"没有关系。

## 连接元数据：规则判断时手里能有什么牌

规则要匹配的对象，是一条连接携带的"连接元数据"（connection metadata）：目标域名（如果客户端给的是域名）、已经解析出的 IP（如果解析过）、目标端口。companion 里对应的类型很简单：

```ts
// src/types.ts · RouteContext
export interface RouteContext {
  readonly domain?: string
  readonly ip?: string
  readonly port: number
}
```

注意 `domain` 和 `ip` 都是可选字段，这不是随意的设计，而是直接对应一个后面会反复用到的事实：域名目标在没有解析之前，天然就没有 IP 可用。如果一条 `IP-CIDR` 规则排在前面，面对一个还没解析的域名目标，这条规则会因为 `ctx.ip` 是 `undefined` 而直接跳过。它不会误判成"不在网段内所以不匹配"，也不会凭空猜一个 IP 出来匹配。这也戳穿了第三个误解：**域名目标在解析前，并不能命中 IP-CIDR 规则**。不是"暂时不生效"，是这条规则在这种上下文里根本没有参与判断的资格。

## 域名后缀匹配：标签边界不是字符串后缀

规则类型里最容易出错的是 `DOMAIN-SUFFIX`：用一个后缀域名去匹配一批子域名。直觉上很多人会想到用字符串的 `endsWith` 判断，但这样做藏着一个安全隐患。看这张对照表：

| 规则值 | 候选域名 | 字符串 endsWith 结果 | 应该匹配吗 |
| --- | --- | --- | --- |
| `example.com` | `www.example.com` | 匹配 | 是 |
| `example.com` | `example.com` | 匹配 | 是 |
| `example.com` | `evil-example.com` | 匹配 | 不应该 |
| `example.com` | `notexample.com` | 匹配 | 不应该 |

`evil-example.com` 和 `notexample.com` 在字符串意义上确实"以 example.com 结尾"，但它们和 `example.com` 根本不是同一个域名体系下的子域名。域名是按点号分隔的层级结构，这一点由 [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034.html) 定义。只有当候选域名完全等于规则值，或者在规则值前面多出的部分以一个完整的点号分隔标签结尾时，才算真正落在这个后缀之下。这条分界线就是"域名标签边界"：判断后缀匹配时，必须确认多出来的前缀部分是以 `.` 结尾拼接上去的，而不是直接在字符串层面粘连。这就是第二个误解要戳穿的地方：**字符串 `endsWith` 不足以实现安全的域名后缀匹配**。它会把"字符串偶然相似"误判成"确实是子域名"，这在需要用后缀规则做访问控制时是一个真实的安全漏洞。想象一条本该拦截敏感域名子站点的规则，被一个精心构造的相似域名绕过。

companion 里的判断只多了一步：

```ts
// src/rules.ts · domainSuffixMatches
function domainSuffixMatches(domain: string, suffix: string): boolean {
  const d = domain.toLowerCase()
  const s = suffix.toLowerCase()
  if (d === s) return true
  return d.endsWith(`.${s}`)
}
```

关键在最后一行：不是直接 `d.endsWith(s)`，而是 `d.endsWith('.' + s)`——多出来的前缀部分必须以点号收尾。`evil-example.com` 结尾确实是 `example.com`，但它前面多出的 `evil-` 和 `example.com` 之间没有点号分隔，`.endsWith('.example.com')` 会返回 `false`，规则不会命中。

## IP-CIDR：把网段判断变成一次位运算

`IP-CIDR` 规则要判断一个 IPv4 地址是否落在某个网段内。CIDR（Classless Inter-Domain Routing，无类别域间路由）用"地址 + 前缀长度"表示一段连续的 IP 空间。例如 `10.0.0.0/8` 表示前 8 位固定、后 24 位任意的所有地址，这套记法定义在 [RFC 4632](https://www.rfc-editor.org/rfc/rfc4632.html)。判断一个地址是否在网段里，只需要把地址和网段基址都转换成 32 位整数，用前缀长度算出的掩码各自做按位与，结果相等就说明落在同一个网段。

```ts
// src/rules.ts · ipInCidr
export function ipInCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidr(cidr)
  if (!parsed) return false
  const ipInt = ipv4ToInt(ip)
  if (ipInt === null) return false
  if (parsed.maskBits === 0) return true
  const mask = (0xffffffff << (32 - parsed.maskBits)) >>> 0
  return (ipInt & mask) >>> 0 === (parsed.base & mask) >>> 0
}
```

`maskBits === 0` 单独处理是因为 `/0` 表示"匹配一切地址"。这时候左移 32 位在 JavaScript 里的行为是未定义的，位移运算按 32 取模，左移 32 相当于左移 0，必须提前拦住，不能指望位运算自动算出正确结果。

## 五种规则拼成一次判断

需要区分标准事实和课程设计：CIDR 的前缀表示来自 RFC 4632；`DOMAIN`、`DOMAIN-SUFFIX`、`PORT`、`MATCH` 这组规则名，以及“按数组首条命中”的组合方式，是本课程为 mini-proxy 定义的实现契约，不是某份 RFC 强制规定的通用代理语法。

有了这些构件，`route` 函数只是把它们按顺序串起来：

```ts
// src/rules.ts · matchRule 与 route
function matchRule(rule: Rule, ctx: RouteContext): boolean {
  switch (rule.type) {
    case 'DOMAIN':
      return ctx.domain !== undefined && domainEquals(ctx.domain, rule.value)
    case 'DOMAIN-SUFFIX':
      return ctx.domain !== undefined && domainSuffixMatches(ctx.domain, rule.value)
    case 'IP-CIDR':
      return ctx.ip !== undefined && ipInCidr(ctx.ip, rule.value)
    case 'PORT':
      return String(ctx.port) === rule.value
    case 'MATCH':
      return true
  }
}
```

`route` 本身只是遍历规则数组、调用 `matchRule`，命中第一条就返回，遍历完都没命中就返回 `null`。这也是为什么规则列表末尾一定要有一条 **MATCH 兜底**（无条件命中的最后一条规则）：没有它，一部分连接可能走到规则列表末尾也得不到任何决策。这一点在下一章会看到运行时如何在监听之前就挡住这种缺失。

## 动手验证：先手算命中，再核对返回值

`tests/05-rule-engine.test.ts` 是纯函数测试，不涉及任何网络。运行之前，拿这组规则自己算一遍：

```ts
const rules = [
  { type: 'DOMAIN-SUFFIX', value: 'com', action: 'REJECT' },
  { type: 'DOMAIN', value: 'example.com', action: 'DIRECT' },
  { type: 'MATCH', value: '', action: 'DIRECT' },
]
```

对 `{ domain: 'example.com', port: 80 }` 调用 `route`，命中的会是第一条还是第二条？运行命令核对：

```bash
cd courses/proxy-software-course/companion
pnpm vitest run tests/05-rule-engine.test.ts
```

预期 13 个用例全部通过。对照断言会发现命中的是第一条 `DOMAIN-SUFFIX: com`，动作是 `REJECT`——尽管第二条 `DOMAIN: example.com` 看起来是"更精确"的匹配，但它排在后面，根本没有机会被检查到。这正好验证了首条命中的规则：顺序决定一切，跟规则本身写得多具体无关。

再看一个反例变体：如果把 `{ domain: 'evil-example.com' }` 传给一份只有 `DOMAIN-SUFFIX: example.com` 和兜底 `MATCH` 两条规则的列表，断言会确认命中的是 `MATCH`，走到了兜底，而不是那条后缀规则。这验证了标签边界确实生效，`evil-example.com` 没有被误判成 `example.com` 的子域名。

## 自查：换一组规则再判断一次

<details>
<summary>没有 IP 上下文时，IP-CIDR 规则会怎样</summary>

给定规则列表 `[{ type: 'IP-CIDR', value: '10.0.0.0/8', action: 'REJECT' }, { type: 'MATCH', value: '', action: 'DIRECT' }]`，调用 `route({ domain: 'no-ip-here.com', port: 80 }, rules)`，返回的动作会是什么？为什么？

<details>
<summary>参考答案</summary>

返回 `DIRECT`，命中的是兜底 `MATCH`。因为 `matchRule` 里 `IP-CIDR` 分支的判断条件是 `ctx.ip !== undefined && ipInCidr(...)`，这里的上下文只有 `domain`、没有 `ip`，`ctx.ip !== undefined` 已经是 `false`，整个 `&&` 表达式短路成 `false`，`IP-CIDR` 规则被直接跳过，不会走到 `ipInCidr` 内部逻辑。
</details>
</details>

<details>
<summary>规则命中但列表里没有兜底会怎样</summary>

如果规则列表只有一条 `{ type: 'DOMAIN', value: 'only-this.com', action: 'DIRECT' }`，对 `{ domain: 'other.com', port: 80 }` 调用 `route`，返回值是什么？这个返回值适合直接拿去决定"该怎么处理这条连接"吗？

<details>
<summary>参考答案</summary>

返回 `null`——遍历完唯一一条规则都没有命中，函数没有更多规则可看，只能表示"没有规则给出决策"。这个 `null` 不适合被当作某种默认动作（比如误当成 DIRECT）直接使用，它应该被上层判断为一种异常状态。第 8 章会实现配置校验，要求规则列表末尾必须有一条 `MATCH` 兜底，从源头上避免线上配置出现这种"可能返回 null"的情况。
</details>
</details>

## 回到开头的失灵规则

现在能解释开头那个现象了：`example.com` 直连规则排在前面，`evil-example.com` 拒绝规则排在后面时，如果直连规则用的是不严谨的后缀匹配，两个域名会被同一条规则一并处理；即便后缀匹配写对了，只要拒绝规则本身没有排在更靠前的位置，规则列表的顺序也决定了它对排在它之前就已经命中的连接完全不起作用。规则引擎不会替你"挑出最匹配的一条"，它只会按顺序找到第一条满足条件的规则就停下来。

路由这一段目前只用了 `domain`、`ip`、`port` 里的一部分信息做判断，而域名什么时候会被解析成 IP、`ip` 字段什么时候才会出现在上下文里，这一章还没有交代。下一章会把这个问题摊开：同一条 `IP-CIDR` 规则，换一种 DNS 解析时机，可能会得到完全不同的匹配结果。
