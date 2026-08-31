---
title: '配置先失败：不要让错误规则静默上线'
---

# 配置先失败：不要让错误规则静默上线

## 前情：积木都齐了，还没人检查图纸

前面几章分别做出了路由、DNS 策略、出站适配器这几块积木，它们各自都能正确工作。但它们最终要靠一份 JSON 配置文件拼在一起：规则里写的 `outbound` 名字、监听端口、DNS 策略这些字符串，全部来自一份人手写的文件，任何一处笔误都可能在运行时才暴露。这一章不写新的路由或转发逻辑，而是给整条流水线的输入把关。

## 拼错一个名字，代理却显示启动成功

想象一份配置：某条 `PROXY` 规则里，`outbound` 字段写的是 `upstrem-socks5`（少了一个 `a`），而 `outbounds` 里真正定义的节点叫 `upstream-socks5`。程序读取这份配置、启动监听、打印“HTTP 代理监听端口 8080”——一切看起来都正常。直到第一位用户访问命中这条规则的网站，才会因为拼错一个节点名，得到一个无法解释的 502。这个问题从写配置那一刻就存在，却要等到实际流量走到这条规则才会暴露。

## 严格配置校验：把错误挡在监听之前

**严格配置校验**（strict validation）指的是：在真正开始监听端口之前，把配置文件的每一处结构、取值范围、跨字段引用都检查一遍。任何不合法的地方都要报出明确的错误，不能靠“运行时再说”来发现问题。这里的字段、必需出站和 `MATCH` 兜底都是本课程 `ProxyConfig` 的 API 契约，不对应某个外部代理项目或网络标准。这戳穿了第一个误解：**TypeScript 的类型系统并不能自动验证 JSON 文件**。类型只在编译期检查代码里的字面量和变量。一份从磁盘读出来、`JSON.parse` 得到的值，类型是 `unknown`（或者更宽松的 `any`），TypeScript 编译器完全不知道这份运行时数据实际长什么样。`outbound: 'upstrem-socks5'` 这样的拼写错误，在类型层面完全合法，因为它就是一个普通字符串，只有运行时真正去查找这个名字才会发现它不存在。

companion 用一套类型谓词（type predicate）函数逐层收窄这份 `unknown` 数据。它不用 `as any` 或 `as unknown as ProxyConfig` 这种断言绕过检查。

```ts
// src/config.ts · isRecord 与 isValidPort
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535
}
```

`value is Record<string, unknown>` 这种写法就是类型谓词。函数返回 `true` 时，TypeScript 会把参数在调用处的类型收窄成 `Record<string, unknown>`。后续代码才能安全地用 `value['host']` 这样的写法去取字段，不用先假设它已经是对象。

## 规则解析：一条规则里藏着好几处可能出错的地方

拿规则解析举例，一条规则要检查的地方不止一处：类型是不是已知的五种之一、动作是不是已知的三种之一、`PROXY` 动作有没有配 `outbound`：

```ts
// src/config.ts · parseRule（动作校验片段）
  const action = value['action']
  if (!isRuleAction(action)) {
    errors.push(`rules[${index}].action 未知：${JSON.stringify(action)}（允许：${RULE_ACTION_NAMES.join(', ')}）`)
    return null
  }
  const outbound = value['outbound']
  if (outbound !== undefined && typeof outbound !== 'string') {
    errors.push(`rules[${index}].outbound 必须是字符串`)
    return null
  }
```

但光检查"这条规则自己写得对不对"还不够。`outbound: 'upstrem-socks5'` 这种拼写错误，只看这一条规则本身完全合法（它就是一个字符串），必须拿它和 `outbounds` 字段里真正存在的节点名对照，才能发现问题。这一步是"跨字段"的校验。`parseProxyConfig` 专门留了一段做这件事：

```ts
// src/config.ts · parseProxyConfig（PROXY 交叉引用校验片段）
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (rule === undefined || rule.action !== 'PROXY') continue
    const target = rule.outbound === undefined ? undefined : outbounds[rule.outbound]
    if (target === undefined) {
      errors.push(`rules[${i}] 引用了未定义的 outbound：${JSON.stringify(rule.outbound)}`)
    } else if (target.type !== 'SOCKS5') {
      errors.push(`rules[${i}] 的 outbound "${rule.outbound}" 必须是 SOCKS5 类型，实际为 ${target.type}`)
    }
  }
```

这段代码正是开头那个 502 事故本该在配置阶段就被拦下的地方。`upstrem-socks5` 在 `outbounds` 里查不到，`target` 是 `undefined`，`parseProxyConfig` 会把这条错误记下来，不会等到真的有连接命中这条规则才暴露。

## MATCH 兜底：为什么"找不到规则就默认直连"是个坏主意

规则解析里还有一处检查：规则数组末尾必须有一条 `MATCH` 规则。这戳穿了第二个误解：**找不到规则命中时，默认走 `DIRECT` 并不是更友好的选择**。表面上看，缺了兜底规则时自动给个"最不容易出问题"的默认动作，好像能让程序更"宽容"；但这种宽容恰恰是安全隐患的来源。如果作者原本想写一条 `REJECT` 兜底，比如"没有明确允许的目标一律拒绝"，这是常见的安全默认，程序却在没人注意的情况下悄悄换成了 `DIRECT`，等于系统自己篡改了作者的安全意图，而且不会有任何提示。要求配置里必须显式写一条 `MATCH` 规则，把"找不到规则时该怎么办"这个决定权始终留给写配置的人，而不是让运行时替他做主。

## 一次性收集所有错误，而不是找到第一个就停

这里还有第三个容易被忽略的设计决定：`parseProxyConfig` 用一个 `errors: string[]` 数组贯穿始终，每发现一处问题就 `push` 一条，遍历完整个配置才返回。这戳穿了第三个误解：**遇到第一个错误就立刻返回，并不比一次性收集所有错误更容易排障**。想象一份配置同时有三处问题：监听端口写超了范围、`dnsStrategy` 拼错了、还有一条规则引用了不存在的 `outbound`。如果校验逻辑发现第一个错误就退出，使用者改完这一处、重新运行，又会撞上第二个错误，得反复运行三次才能看到全部问题；一次性收集全部错误，使用者一轮就能看到需要改的所有地方。

## 动手验证：故意提交一份有多处错误的配置

`tests/08-runtime-config.test.ts` 是纯函数测试，不需要真的监听端口。运行之前先猜一下：如果同时把 `dnsStrategy` 拼错、又让某条规则引用不存在的 `outbound`，`parseProxyConfig` 返回的 `errors` 数组里会同时出现几条错误信息，还是只有第一条？

运行命令：

```bash
cd courses/proxy-software-course/companion
pnpm vitest run tests/08-runtime-config.test.ts
```

预期 19 个用例全部通过。挑几条断言核对："PROXY 引用了不存在的 outbound 报错"这一条会确认返回的错误数组里包含引用了那个不存在名字的具体信息；"规则数组末尾不是 MATCH 时报错"这一条确认缺少兜底规则会被单独报出来，错误信息里包含"MATCH"字样。多处错误同时存在的场景可以自己动手拼一份测试配置验证：把 `baseConfig()` 里同时改错 `dnsStrategy` 和一处规则，`errors.length` 应该反映出两处问题都被记录了下来，而不是只有一处。

再看一个变体：如果一条规则的 `outbound` 确实存在，但对应的出站类型是 `DIRECT` 而不是 `SOCKS5`，会怎样？测试里有专门一条用例覆盖这种情况，断言错误信息里会提到"必须是 SOCKS5 类型"。这说明交叉校验不只检查"名字存在"，还检查"类型对不对"：`PROXY` 动作在这套设计里只能连到一个 SOCKS5 上游，连到一个 `DIRECT` 出站在语义上没有意义。

## 自查：换一种错误组合再想一遍

<details>
<summary>如果 `outbounds` 里缺少 REJECT，会怎样</summary>

假设一份配置的 `outbounds` 字段只写了 `DIRECT`，没有写 `REJECT`。规则列表本身语法完全正确，也有兜底 `MATCH`。这份配置能通过 `parseProxyConfig` 吗？

<details>
<summary>参考答案</summary>

不能。`parseProxyConfig` 里有一句专门检查：`if (!('REJECT' in outbounds)) errors.push('outbounds 必须包含 REJECT 出站...')`。即便规则列表里没有任何一条规则用到 `REJECT`，这份配置依然会报错。`REJECT` 和 `DIRECT` 是两个必须始终存在的基础出站，不依赖规则是否引用了它们。这样运行时任何时候需要用到默认拒绝逻辑，都能保证有一个可用的出站。
</details>
</details>

<details>
<summary>端口写成字符串 `"8080"` 会被接受吗</summary>

如果 `listeners.http.port` 写成字符串 `"8080"` 而不是数字 `8080`，`isValidPort` 会不会因为这个值"看起来是端口"就接受它？

<details>
<summary>参考答案</summary>

不会。`isValidPort` 第一步就是 `typeof value === 'number'`，字符串 `"8080"` 的类型是 `string`，这一步直接判 `false`，函数在检查取值范围之前就已经拒绝了它。这也说明校验函数的每一步判断都不能跳过。如果只检查"数值范围合不合法"而不先确认类型，字符串 `"8080"` 可能被隐式转换后意外通过校验，那样 JSON 里到底该写数字还是字符串就变得含糊不清了。
</details>
</details>

## 回到开头的 502

现在能回答开头的问题了：`upstrem-socks5` 这种拼写错误之所以能一路运行到用户遇到 502，是因为原来的实现没有在监听之前检查规则和出站之间的引用关系。这一章实现的 `parseProxyConfig` 会在程序真正开始监听任何端口之前，就把这类跨字段的错误连同端口范围、未知类型、缺失兜底规则一起收集出来，一次性报给写配置的人。运行时看到的不再是一个含糊的 502，而是一份写着"配置校验失败"和具体原因的清单。

配置现在有了严格的形状保证，下一章要把它真正交给运行时：同时监听 HTTP 和 SOCKS5 两个端口，让两种入口协议共用同一条已经验证过的 route-DNS-dial 管线。
