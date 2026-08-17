---
title: 配置继承：你写过的那些花括号
---

# 配置继承：你写过的那些花括号

你大概率亲手写过或改过这样一段 nginx.conf：`http` 块里写 `gzip on`，某个 `server` 块里写 `gzip off`，某个 `location` 里又写回 `gzip on`。上周的事故是这样的：一条指令原本写在 `server` 块里，对所有路径生效；新同事想让它只对 `/download` 生效，把它挪进了 `location /download`，reload 之后——`/download` 如愿了，但其他所有路径的这个行为悄悄丢了。没人改过它们的配置，可它们就是变了。回滚容易，讲清楚为什么难：花括号一层套一层，哪层写的生效、哪层继承谁的，团队里只有一个人「大概知道」。

这一章把这套规则从玄学变成代码。你会亲手实现一个 nginx.conf 子集的解析器，和那条贯穿所有花括号的继承规则。写完之后，「挪一条指令会弄坏别的路径」这件事在你眼里将不再神秘——因为你能在自己的解析器上重现它、解释它。

## 为什么配置长成这个样子

先想一层设计动机。假设你有 20 个站点（20 个 `server` 块），每个都要开 gzip、都要 65 秒 keep-alive 超时、都要同一套日志格式。如果没有嵌套，你得把这几十条指令抄 20 遍；改一条超时值，改 20 处。**配置上下文**（context）——nginx.conf 里一层层的花括号房间——就是为这件事生的：指令写在哪个房间，就算哪个房间直接持有的；`http` 房间套着 `server` 房间，`server` 套着 `location`，公共配置写在外层大房间里，全体小房间共用。

而**配置继承**（inheritance）的规则只有两条，剩下的都是推论：

1. 房间自己写过的指令，自己说了算（内层覆盖外层）；
2. 没写的指令，沿用外面最近一层写了的值（沿路径向外找，找到第一个为准）。

注意第 2 条的方向：从内向外找，不是「内外合并取平均」之类的模糊话术。`gzip` 在 http 是 on、server 是 off、location 没写——location 的有效值是 off，因为向外走第一站（server）就有答案，不再往外看。

于是「挪指令事故」的成因彻底清楚了：把指令从 `server` 挪进某个 `location`，等于把它从这个房间的「直接持有」清单里划掉。这个 location 自己不受影响（它现在直接持有）；但其他 location 的「向外找」路径上，这一站再也没有这个值了——它们要么找到更外层的旧值，要么一无所获。行为变化不是 bug，是继承规则在忠实地执行。

## 动手：文本怎么变成一棵树

配置文件是纯文本，规则跑在结构上，中间需要一次翻译。目标结构很直白：

```ts
// src/config.ts · ConfigNode
export interface ConfigNode {
  name: string // 块名：http / server / location / upstream …
  args: string[] // 块名后的参数（location /api → ['/api']）
  directives: Record<string, string> // 本块直接写的指令（键小写归一）
  children: ConfigNode[]
}
```

花括号的嵌套，翻译成节点的父子——这棵树就是继承规则的载体：一个块的有效配置，等于「从根到它的路径上所有节点的指令、由外向内逐层覆盖」。

解析用最朴素的两步。第一步切词：剥掉注释，把 `{` `}` `;` 前后补上空格（这样 `keepalive_timeout 65;` 里的 `;` 不会粘在 `65` 的屁股上），再按空白切。第二步用一个栈走词：攒词攒到 `;` 就落一条指令；攒到 `{` 就把攒的词当块名开一个新节点、入栈；遇到 `}` 就出栈。收工时栈里若还剩东西，就是有块没闭合：

```ts
// src/config.ts · parseConfig 的主循环
for (const tok of tokens) {
  if (tok === '{') {
    if (pending.length === 0) return { ok: false, reason: 'empty-directive' }
    const [name, ...args] = pending
    const node: ConfigNode = { name: name.toLowerCase(), args, directives: {}, children: [] }
    stack[stack.length - 1].children.push(node)
    stack.push(node)
    pending = []
  } else if (tok === '}') {
    if (pending.length > 0) return { ok: false, reason: 'empty-directive' } // } 前还有没收尾的词
    if (stack.length === 1) return { ok: false, reason: 'stray-close' }
    stack.pop()
  } else if (tok === ';') {
    if (pending.length < 2) return { ok: false, reason: 'empty-directive' }
    const [key, ...rest] = pending
    stack[stack.length - 1].directives[key.toLowerCase()] = rest.join(' ')
    pending = []
  } else {
    pending.push(tok)
  }
}
```

这段代码你应该看得很眼熟——它就是第 3 章那套「攒着，见到界符就结算」的思路换了身衣服。HTTP 解析器攒的是字节、以 `\r\n` 结算；这里攒的是词、以 `;` 和 `{` 结算。状态机的思维一旦上手，到处都是它的用武之地。

## 继承的执行：一次对象展开

树有了，规则二的「沿路径向外找」落成代码只有几行。做法是反过来从根出发：沿路径每走一层，就把该层的指令展开覆盖上去——后展开的（更内层）自然赢：

```ts
// src/config.ts · resolveConfig
export function resolveConfig(root: ConfigNode, path: string[]): Record<string, string> | null {
  let merged: Record<string, string> = { ...root.directives }
  let node: ConfigNode | undefined = root
  for (const step of path) {
    const parts = step.split(/\s+/)
    const name = parts[0].toLowerCase()
    const args = parts.slice(1).join(' ')
    node = node.children.find(
      (c) => c.name === name && (args === '' || c.args.join(' ') === args),
    )
    if (!node) return null
    merged = { ...merged, ...node.directives } // 内层覆盖外层
  }
  return merged
}
```

路径写法 `'location /static'` 里带上参数，是因为同一层可能有多个同名兄弟块。`location /api` 和 `location /static` 是两个不同的房间——参数才是门牌号。跟着演算一遍测试里那条最深的路径 `['http', 'server', 'location /static']`：

- 起点：merged = 根的 `{ worker_processes: '4' }`；
- 进 http：并入 `gzip: 'on'`、`keepalive_timeout: '65'`；
- 进 server：`gzip` 被覆盖成 `'off'`，新增 `listen: '8080'`；
- 进 location /static：`keepalive_timeout` 被覆盖成 `'10'`，`gzip` 保持 `'off'`（它没写，上一站的值留着）。

四次对象展开，得到 `/static` 这个房间的有效配置——每一条都能指出「来自哪一层」，事故复盘时这就是你缺的那张账。

## 验证

进 `companion/` 跑 `pnpm test`：

```text
✓ tests/config-inheritance.test.ts (9 tests) 11ms
✓ tests/memory-pool.test.ts (7 tests) 5ms
✓ tests/keepalive-reuse.test.ts (4 tests) 39ms
✓ tests/http-parser-state-machine.test.ts (10 tests) 7ms
✓ tests/connection-registry.test.ts (7 tests) 248ms
Test Files  5 passed (5)
     Tests  37 passed (37)
```

九个断言覆盖两类承诺。解析侧：嵌套块正确入树、location 带参数、注释忽略、未闭合与多余右括号各自返回结构化错误（`unclosed-block` / `stray-close`）。继承侧就是前文演算的机械化：覆盖生效（server 的 off 压过 http 的 on）、穿透继承（location 从三层之外拿到 `worker_processes`）、兄弟隔离（`/api` 的 `gzip on` 对 `/static` 毫无影响）、路径走不通返回 null。开头那个「挪指令事故」，现在你可以在测试里一行行摆出来给别人看。

## 读完本章，你该能回答

- 20 个 server 块的公共配置，为什么必须放在外层而不是抄 20 遍？上下文和继承各解决了哪一半？
- 「挪一条指令弄坏别的路径」用继承规则怎么解释？被影响的路径丢失了什么？
- resolveConfig 为什么从根展开到目标，而不是从目标向上收集？两种方向算出的结果有区别吗？
- 栈在这段解析器里承担什么？它和第 3 章 pending 缓冲的相似之处是什么？

解析和继承都是静悄悄的内部机制，下一章抬头看一个你天天听说却未必见过内部的东西：master 和 worker 那群进程——谁在管谁、reload 为什么不掐断流量。
