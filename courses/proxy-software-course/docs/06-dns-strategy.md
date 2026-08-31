---
title: 'DNS 在哪里发生：域名规则与 IP 规则的拉扯'
---

# DNS 在哪里发生：域名规则与 IP 规则的拉扯

## 上一章欠下的账

上一章讲规则引擎时留了一个没深挖的细节：`RouteContext` 里的 `domain` 和 `ip` 都是可选字段，`IP-CIDR` 规则只有在上下文里出现了 `ip` 才会参与判断。但域名到底什么时候会变成 IP，这件事发生在规则判断之前还是之后，直接决定了同一条规则能不能用上。这正是这一章要还的账。

## 同一条网段规则，两种截然不同的结果

假设配置里写了一条规则："`10.0.0.0/8` 网段一律拒绝"。目标是一个域名 `internal.example.com`，这个域名解析出来的 IP 恰好就落在 `10.0.0.0/8` 里。运行之后却发现：域名目标却绕过去了，规则完全没拦住它。你把配置改成"先解析再判断"之后重新测试，这次拒绝规则确实生效了，但另一条原本用来匹配域名后缀的规则，看起来又像失去意义——总是走到兜底规则，从来没被那条域名规则命中过。

同一份 `10.0.0.0/8` 拒绝规则，换一种处理顺序就得到完全不同的结果。这不是 bug，是两种 DNS 处理策略各自的正常行为，只是选错了场景。

## DNS 解析位置：谁来查、什么时候查

**DNS 解析位置**指的是一个具体问题：域名到底在本地代理这一侧解析，还是保留给别的地方处理，比如目标真正联系上时才转交上游代理去解析，以及这件事发生在规则判断之前还是之后。DNS 的分层名字与解析概念可核对 [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034.html)。`preserve-domain` 与 `resolve-first` 这两个策略名和它们在 `planRoute` 中的顺序，是本课程为比较两种决策路径定义的实现选择，不是 RFC 1034 规定的标准模式。这个位置一旦确定，就决定了两件事：规则引擎能看到的上下文里有没有 `ip` 字段，以及最终建立连接时用的是域名还是 IP。

这也戳穿了第一个误解：**DNS 不只是负责性能**。离用户更近的 DNS 服务器能更快返回结果，这只是它的一部分作用；DNS 同样牵涉隐私（谁能看到这次查询的是哪个域名）和规则判断（有没有 IP 可以拿来匹配 IP 段的规则）。DNS 解析发生的位置，直接决定了后面所有路由和转发行为。

## preserve-domain：域名规则优先，DIRECT 才解析

第一种策略叫 **preserve-domain**：先用域名（如果目标是域名）去匹配规则，只有命中 `DIRECT` 的时候才在这一刻解析成 IP 用于拨号。`REJECT` 根本不需要建立连接，没有解析的必要；`PROXY` 则把域名原样交给出站阶段（比如交给一个上游 SOCKS5 代理去处理），本地完全不解析。

```ts
// src/dns.ts · planRoute（preserve-domain 分支）
  const ctx: RouteContext = target.kind === 'domain' ? { domain: target.host, port: target.port } : { ip: target.host, port: target.port }
  const decision = route(ctx, rules)
  if (!decision) return { ok: false, reason: 'no rule matched' }

  if (decision.action === 'DIRECT' && target.kind === 'domain') {
    const resolved = await resolveOrFail(resolver, target.host)
    if (!resolved.ok) return { ok: false, reason: resolved.reason }
    return { ok: true, decision, dialTarget: toResolvedTarget(resolved.ip, target.port) }
  }

  return { ok: true, decision, dialTarget: target }
```

这段代码同时回答了开头场景第一个问题的答案：`internal.example.com` 走 preserve-domain 时，规则判断只用得到域名本身。如果规则列表里没有专门针对这个域名的 `DOMAIN` 规则，请求会一路走到兜底。而那条写着 IP 网段的 `IP-CIDR` 规则，在域名还没解析、上下文根本没有 `ip` 字段的情况下，永远不会触发。不是规则失效，是它压根没有参与判断的资格，这一点和上一章讲的短路逻辑完全一致。

这里也戳穿了第二个误解：**走 `PROXY` 出站，并不需要本地先解析域名**。preserve-domain 策略下，命中 `PROXY` 的域名目标会原样传下去，域名解析这件事推迟到了更合适的地方，通常是上游代理自己的职责。本地代理甚至可以完全不知道这个域名对应的 IP 是什么。

## resolve-first：先解析，规则才看得到 IP

第二种策略叫 **resolve-first**：如果目标是域名，先解析成 IP，再把域名和 IP 一起放进上下文交给规则引擎。这样 `IP-CIDR` 规则才有机会参与判断，但域名相关的规则（`DOMAIN`、`DOMAIN-SUFFIX`）依然可以正常工作，因为上下文里域名字段并没有被丢弃。

```ts
// src/dns.ts · planRoute（resolve-first 分支）
  if (strategy === 'resolve-first') {
    let ip: string
    let domain: string | undefined
    if (target.kind === 'domain') {
      const resolved = await resolveOrFail(resolver, target.host)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      ip = resolved.ip
      domain = target.host
    } else {
      ip = target.host
    }
    const ctx: RouteContext = domain === undefined ? { ip, port: target.port } : { domain, ip, port: target.port }
    const decision = route(ctx, rules)
    if (!decision) return { ok: false, reason: 'no rule matched' }
    return { ok: true, decision, dialTarget: toResolvedTarget(ip, target.port) }
  }
```

回到开头场景的第二段：切换到 resolve-first 之后，`10.0.0.0/8` 拒绝规则确实能命中了，因为解析出的 IP 放进了上下文。但如果域名规则"看起来总是被跳过"，多半是规则本身排在了 IP 规则后面。这仍然是上一章讲的首条命中，不是 resolve-first 让域名规则失效了。resolve-first 只是多提供了一个 `ip` 字段，域名字段本身照样在上下文里，只要域名规则排得靠前，依然会优先命中。

## 一个容易忽略的边界：拿到 IP 之后，域名去哪了

无论哪种策略，一旦决定要用某个 IP 去拨号，这个连接建立起来之后，TCP 层面就只剩下一个 IP 地址和端口。`net.Socket` 不会替你记住"这个连接最初是通过哪个域名建立的"。这戳穿了第三个误解：**解析成 IP 之后，并不能指望从 socket 上自动恢复出原始域名**。如果后续还需要用到域名信息，比如日志记录、或者规则需要在建立连接之后再做一次域名判断，必须在解析之前就保存好域名，不能指望事后从底层连接对象里找回来。companion 里 `planRoute` 返回的 `RoutePlanOutcome` 同时带着 `decision` 和 `dialTarget`，原因也在这里：调用方可能既需要知道路由命中了哪条规则，也需要知道最终该拿什么地址去拨号。

## 动手验证：同一个域名，预测两种策略的差异

`tests/06-dns-strategy.test.ts` 全程用注入的假 resolver，不发起任何真实 DNS 查询。运行前，针对 `internal.example.com` 这个域名，先填好这张预测表：

| 命中的规则动作 | preserve-domain 下 resolver 会被调用吗 | resolve-first 下 resolver 会被调用吗 |
| --- | --- | --- |
| REJECT | | |
| PROXY | | |
| DIRECT | | |

运行命令核对：

```bash
cd courses/proxy-software-course/companion
pnpm vitest run tests/06-dns-strategy.test.ts
```

预期 9 个用例全部通过。核对断言会发现：preserve-domain 下只有命中 `DIRECT` 时 resolver 才会执行（用 `vi.fn` 包装后断言 `toHaveBeenCalledWith`），命中 `REJECT` 或 `PROXY` 时 `resolver` 完全不会触发；resolve-first 下只要目标是域名，不管最终命中哪条规则，resolver 都会先执行一次，因为规则判断本身就依赖解析出的 IP。

再看一个变体：如果目标本来就是字面 IP，不是域名，两种策略都不会调用 resolver，因为规则判断根本不需要额外解析。这一点在测试里用 `expect(resolver).not.toHaveBeenCalled()` 直接断言。这说明两种策略在处理"目标已经是 IP"的场景时行为完全一致，差异只体现在目标是域名的时候。

## 自查：换一种目标类型再想一遍

<details>
<summary>preserve-domain 下，PROXY 出站真的完全不需要 IP 吗</summary>

preserve-domain 策略下，命中 `PROXY` 时 `dialTarget` 会是什么？如果上游是另一个 SOCKS5 代理，它自己会不会解析这个域名？本地代理需要关心这件事吗？

<details>
<summary>参考答案</summary>

`dialTarget` 就是原始的域名目标：`planRoute` 在这个分支直接 `return { ok: true, decision, dialTarget: target }`，没有做任何解析。上游 SOCKS5 代理收到域名地址帧之后，是否解析、在哪里解析，是它自己的实现细节和责任。下一章会讲到，SOCKS5 出站客户端只负责把域名原样编码进地址帧发出去，不需要、也不应该在本地先解析一遍再传一个 IP 过去，那样反而会让上游看到的目标信息变少。
</details>
</details>

<details>
<summary>解析出的 IP 会变化，会发生什么</summary>

假设 `internal.example.com` 在两次连接之间实际解析结果发生了变化，现实中 DNS 记录确实可能更新。resolve-first 策略下,这两次连接的路由决策有没有可能不一样？preserve-domain 呢？

<details>
<summary>参考答案</summary>

resolve-first 下有可能不一样。每次连接都会重新解析，如果新旧 IP 分别落在不同的 `IP-CIDR` 规则里，两次连接可能得到不同的路由决策。preserve-domain 下，只要命中的是域名规则（`DOMAIN`、`DOMAIN-SUFFIX`）或 `REJECT`、`PROXY`，路由决策完全不依赖解析结果，不会因为 IP 变化而改变；只有命中 `DIRECT` 时才会解析，但那时候规则已经判断完毕，解析结果只影响最终连到哪个 IP，不影响"要不要走 DIRECT"这个决策本身。
</details>
</details>

## 回到开头的两次测试

现在能解释开头两次测试的差异了：preserve-domain 下，`IP-CIDR` 只有在目标本来就是字面 IP 时才可能命中。域名目标即使因为 `DIRECT` 被解析，规则判断也已经结束；解析结果只改变 `dialTarget`，不会回头再跑一次规则，所以那条 IP 规则没有第二次参与机会。切到 resolve-first 之后，IP 规则确实能生效了，但域名规则并没有失去意义；如果它排在 IP 规则后面，只会先被更早的 IP 规则截住。这仍然是首条命中的效果，只是这一次在判断前就多了一个可匹配的 IP 字段。

到这里，路由阶段已经能同时处理域名规则和 IP 规则，`dialTarget` 也已经确定了最终该用什么地址去连接。下一章要解决的问题是：`dialTarget` 确定之后，谁来真正发起这个连接——直连、拒绝、还是转交给另一个 SOCKS5 代理，这几种方式怎么用同一套接口表达。
