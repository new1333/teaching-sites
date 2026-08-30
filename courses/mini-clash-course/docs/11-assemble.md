---
title: 总装：跑起来的 mini-clash
---

# 总装：跑起来的 mini-clash

## 11.1 前情：三笔欠账，都在等这一章

这一章不教新东西——它收三笔欠账，每一笔都有名有姓：

- 第 7 章的规则判决、第 8 章的假门牌还原，接线都长在 `tests/` 与 `demo/` 里——零件进了考场，接线还是草稿纸上的。谁来把它焊进产品？
- 第 10 章的 `createRouter` 把判决、选节点、建线做成了流水线，`connect` 恰好就是入口钩子的形状——可「恰好是」不等于「已经装上」。谁第一个真的用它？
- 配置已经能驱动一切零件，但 `inbound.port` 与节点密码还从没被一台真实机器消费过。整机在哪？

## 11.2 零件全齐，整机为零

零件确实全齐了：入口、DNS、规则、组、隧道、远端——六样，每样都在自己的测试里绿过。可它们还躺在各自模块里互不相识。`startSocks5Server` 不知道 `FakeIpPool` 的存在，`createRouter` 从没被装进哪台入口，密码与端口还散在测试的调用参数里。装过 Clash 的用户拿到的是一条命令：开关一亮，入口、DNS、分流全部同时就位。你的用户拿到的是六个函数与一份接线作业。

这一章只做一件事：把零件接成整机。产出一个总装函数 `startMiniClash`——配置文本（或已加载的 Config 对象）进去，一台 mini-clash 出来。fake-ip DNS、SOCKS5 入口、规则与组同时监听就位，返回一个统一 handle 一键收摊。验收标准也只有一条：一条命令拉起「远端中继 + mini-clash + 目标站」，用 curl 走完整条链路。

## 11.3 原理：零件正确，整机未必正确

为什么总装值得单独一章？因为**零件各自正确，接成整机后仍可能整体错误**。接缝处会生出零件层看不见的新问题，这台整机里最典型的一个是顺序：还原必须在判决之前。反事实摆出来——假如入口先把假门牌交给规则引擎再查账本，引擎见到的是 `198.18.0.1` 这样的 IP 字面量。第 7 章讲过它对域名行失明：`DOMAIN,localhost,choose` 永不命中，所有 fake-ip 连接全部落进 IP-CIDR 行或兜底，分流对假门牌流量整体失明。零件全绿——规则引擎对 IP 目标的行为完全正确，账本还原也完全正确——整机却是错的。这就是总装章要教的第一件事：接缝的语义，只有端到端才能验证。

端到端（end-to-end）——从浏览器发出的第一个字节到目标站应答的最后一个字节，整条链路一口气验证：零件的测试各自证明「零件对」，端到端测试证明「接对了」。本章的 `tests/assemble.test.ts` 就是这么写的：测试当浏览器，从 UDP 查电话簿开始，一路走到目标站的应答正文回来，中间每一跳都有回环桩记账。

第二件事是接缝的位置。回看全书，数据面的接线其实一直收口在同一处——第 3 章入口留下的 `onConnect` 钩子。第 7 章在钩子里接了规则判决，第 8 章在钩子里接了假门牌还原，第 10 章把判决、选节点、建线合并成 `router.connect`，而它的签名恰好就是钩子的形状。所以总装的数据面只剩三行：还原、改目标、交给路由器。控制面（配置、组策略）与数据面（每条连接的接线）在整机里也从此分居两处——改配置不需要碰连接的处理代码。

把整机画成一张图，你会看见第 1 章那张三角色图的全部影子。

```text
浏览器
  │ ① 查电话簿：「localhost 的门牌是多少？」
  ▼
fake-ip DNS（第 8 章）…… 应答假门牌 198.18.x.x，真名字记账在册
  │ 浏览器拿假门牌回来，向入口发起 SOCKS5 CONNECT（第 3 章）
  ▼
还原（第 8 章的账本）…… 假门牌换回真名字 localhost
  ▼
规则引擎（第 7 章）按序首中即停判出站名 ▶ 代理组（第 10 章）把出站名落到此刻的节点
  ├── 判 DIRECT ────▶ 本机直连 ─────────▶ 目标站
  └── 判节点 ─▶ AEAD 隧道（第 5、6 章）─▶ 远端中继（第 4 章）─代连─▶ 目标站
  （应答原路返回：目标 →（远端 → 隧道 →）入口 → 浏览器）
```

对账第 1 章的三个角色。角色一「把流量从应用手里接过来」——SOCKS5 入口，外加第 8 章之后多出的一张前哨：DNS，先把「名字」这一关也接过来。角色二「谁走哪条线」——还原、规则引擎、代理组三件接力，这正是第 1 章图里那行「分流决策」如今长成的样子。角色三「换一个位置出网」——AEAD 隧道加远端中继，目标站看到的敲门人是远端。第 1 章的五步路径也步步有着落，只有一步变了形状：浏览器「说明我要去 B」，在假门牌模式下变成「mini-clash 替浏览器记得它要去哪」。没进这台整机的零件有两件：第 2 章的 HTTP 入口（教学版整机只挂 SOCKS5 一个口——真实 Clash 的 mixed 端口两种话都说）与第 9 章的 TUN（接管面的另一种形态，罩住不肯交流量的应用）——两件都留在差异地图里与真实形态一起对账。

## 11.4 演练：startMiniClash

实验场开工。`src/mini-clash.ts` 是全书最小的一章源码，却把六块零件全部 import 了进来。测试 `tests/assemble.test.ts` 照旧先写、先跑出红（模块不存在，加载即失败），再写实现转绿，5 条用例。门槛命令照旧 `cd companion && npm run typecheck && npm test`，全绿应为 73 条（旧 68 + 本章 5）。旧用例一字未动还全绿，说明总装没有为接线改动任何一颗零件的语义。

先看整机对外的形状。

```ts
// src/mini-clash.ts · MiniClashHandle
export interface MiniClashHandle {
  socksPort: number // 入口房间号：inbound.port 写 0 时系统随手分的号从这里读回去
  dnsPort: number // 假电话簿的房间号：教学版不占 53（Unix 系要权限），配置里也没这一格——总装自己起
  pool: FakeIpPool // fake-ip 账本：查池况、对账映射用
  router: Router // 路由器：select 切换、组决策快照都从这进（入口之外的可编程面）
  close(): Promise<void>
}
```

再装本体，全文一处不藏。

```ts
// src/mini-clash.ts · startMiniClash
// 入参认两种：配置文本（交给 loadConfig 带路径校验后进机器）或已加载的 Config 对象。
// 返回的 handle 统一收摊：close 一次，入口与 DNS 一起落地
export async function startMiniClash(config: Config | string): Promise<MiniClashHandle> {
  const cfg = typeof config === 'string' ? loadConfig(config) : config
  const pool = new FakeIpPool()
  const router = await createRouter(cfg) // 组策略就位：url-test 组在这一步现场测速（判决与建线还没开始）
  const dns = await startFakeDns({ port: 0, pool })
  try {
    // 数据面总接线：入口每收到一个 CONNECT，先还原假门牌，再把真名字交路由器。
    // 顺序不能换——规则引擎若先见到 198.18.x.x，域名行全瞎，只能落 IP-CIDR 与兜底
    const onConnect = (t: ProxyTarget): Promise<ProxyTarget | Duplex> => {
      const domain = pool.restore(t.host) // 还原不出的是普通目标（真 IP 直报），原样放行
      const target: ProxyTarget = domain === null ? t : { host: domain, port: t.port }
      return router.connect(target) // DIRECT 交回地址（入口照直连）；组/节点交回加密两跳的管子
    }
    const entry = await startSocks5Server({ port: cfg.inbound.port, onConnect })
    return {
      socksPort: entry.port,
      dnsPort: dns.port,
      pool,
      router,
      close: async () => {
        await Promise.all([entry.close(), dns.close()])
      },
    }
  } catch (e) {
    await dns.close() // 入口没起来：先到的 DNS 不留孤儿监听
    throw e
  }
}
```

四个读点。第一，`inbound.port` 与节点密码由配置接管——第 10 章的欠账在这里清：端口写 0，系统随手分的号从 `socksPort` 读回去；密码住在 `$.proxies` 里，`router.connect` 建线时自动带上，总装代码里一个密码都看不见。第二，DNS 端口没进配置——教学版不占 53（Unix 系要管理员权限），总装自己起随机端口、从 `dnsPort` 读回去；真实 Clash 的 `dns` 段可以配监听地址，这项简化登记差异清单。第三，`onConnect` 那 11.3 说的三行——还原、改目标、交路由器；`router.connect` 的两种回话（DIRECT 交回地址、组与节点交回加密两跳的管子）第 10 章已经备好，入口的 SOCKS5 状态机两种都认。第四，生命周期统一：`close()` 一把收摊入口与 DNS——「一条命令拉起」的另一半是「一次调用关停」。

端到端用例长什么样？挑主链路那条的承重段。

```ts
// tests/assemble.test.ts · 全链路用例（节选）
    // 第一步：浏览器先查电话簿——拿到的当然是假门牌
    const reply = await ask(handle, dnsQuery(0x0042, 'localhost'))
    const fakeIp = answerIp(reply)
    expect(fakeIp.startsWith('198.18.')).toBe(true) // 保留网段里的假门牌
    expect(handle.pool.restore(fakeIp)).toBe('localhost') // 账本记着它的主人

    // 第二步：拿假门牌发起 CONNECT，随后说 HTTP——整机要自己把名字换回来
    const body = await browse(handle, fakeIp, world.target.port)
    expect(body).toBe('HELLO-FROM-TARGET') // 响应原路返回：目标 → 远端 → 隧道 → 入口 → 浏览器
    expect(world.tap.connections()).toBe(1) // 走了第二跳：入口确曾连向远端
    expect(world.target.connections()).toBe(1) // 目标由远端代连（不是入口直连的位置）
    expect(world.target.requests()).toBe(1) // 请求真的送达了目标站

    // 第三步：抄录探针的账——线上没有明文：载荷与「去哪儿」都搜不到
    const seen = world.tap.seen()
    expect(seen.includes(Buffer.from('GET / HTTP'))).toBe(false) // 载荷上锁
    expect(seen.includes(Buffer.from('localhost'))).toBe(false) // CONNECT 帧里的目标也上锁
```

三步各证一件事：假门牌发得出去、账本记得住；一封真 HTTP 从浏览器出发、经远端代连、应答原路返回到浏览器手里——每一跳都有探针数过；节点门前的抄录里搜不到明文载荷也搜不到域名，第 6 章的认证加密隧道在整机上不是摆设。第三件事值得单独一条用例钉死——第 6 章的篡改语义，整机上必须原样成立。篡改者是个透明转发器，等链路建立（回程字节过境）之后，把去程每批字节的末位翻一位。

```ts
// tests/assemble.test.ts · 中途篡改者（节选）
  let seenFromBack = false // 回程有字节 = 盐与回执已过境，链路已建立：此后去程字节才动手
  const tap = net.createServer((front) => {
    const back = net.connect(downPort, '127.0.0.1')
    front.on('data', (b: Buffer) => {
      if (!seenFromBack || b.length === 0) return back.write(b)
      const broken = Buffer.from(b) // 别改原块（事件参数可能被复用），抄一份再下毒
      broken[broken.length - 1] ^= 0x55
      back.write(broken)
    })
```

```ts
// tests/assemble.test.ts · 篡改用例的收尾（节选）
    expect((await readExact(browser, 10))[1]).toBe(0x00) // 链路建立：此后去程字节开始被翻
    const closed = waitClose(browser) // 先猜后跑的靶子：这封请求过不了验漆，连接必死
    browser.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
    await closed // 断线而不是错位内容：第 6 章「验不过整封拒收」在整机上原样成立

    expect(target.connections()).toBe(1) // 目标曾被代连……
    expect(target.requests()).toBe(0) // ……但坏请求一个字节都没送达：AEAD 把它拦在远端门外
```

结果与第 6 章手拼密文时一模一样：连接断开，坏数据一个字节到不了目标——只是这次不是对着一根管子测，而是在六块零件同时运转的整机上。剩下两条用例钉 DIRECT（真 IP 命中 IP-CIDR 行，远端零连接）与还原后判直连（名字留在本地、解析交给操作系统），加上 `close()` 收摊两个监听都落地。

## 11.5 验证：亲手开机，一条命令拉起全部角色

**开机。** 进 `companion/` 跑 `npm run demo:mini-clash`。一条命令拉起七个角色：两台各带锁的远端中继、快桩前的抄录探针、慢桩前压 120ms 的转发器、测速目标、目标站，最后是 `startMiniClash` 拉起的整机——全住回环地址，不出机器。三幕应看到（端口每次随机）。

```text
# companion 的 demo:mini-clash 输出节录
  mini-clash 已起：SOCKS5 入口 127.0.0.1:1813   fake-ip DNS 127.0.0.1:61669
  组 choose（select）  此刻出: node-fast
  组 auto（url-test） 探测 node-slow 509ms，node-fast 3ms → 此刻出: node-fast

—— 第二幕：浏览器视角走完整链路 ——
  ① 查 DNS「localhost」→ 应答假门牌 198.18.0.1（真名字记在 mini-clash 的账上）
  ② 拿假门牌连入口 → 还原回 localhost → 命中第 0 行（DOMAIN）→ 出站 choose → 节点 node-fast
  ③ GET 过整机 → 目标站收到（第 1 封请求）→ 应答原路返回：
     "hello from the mini-clash target site"
  ④ 节点门前的抄录（367 字节过境）：明文 GET 搜不到，域名 localhost 搜不到——线上只有盐与密文块
  ⑤ 对照：直接报真 IP 127.0.0.1 → 命中 IP-CIDR 行 → 直连（快桩新过境 0 字节，零）

—— 第三幕：亲手走链路（另开一个终端，整机保持运行 60 秒） ——
  A. 域名交给 mini-clash（走 DOMAIN 行 → choose 组 → 加密两跳）：
     curl --socks5-hostname 127.0.0.1:1813 http://localhost:1802/
  B. 本地先解析成真 IP 再交给 mini-clash（走 IP-CIDR 行 → 直连）：
     curl --socks5 127.0.0.1:1813 http://127.0.0.1:1802/
```

第三幕是你的动手时间，别只看。另开一个终端，照 A、B 两条命令各跑一次 curl，两条的正文都是那句话。但它们走的是两条线。A 用 `--socks5-hostname` 把域名原样交给 mini-clash——正是第 1 章「愿意交出流量的应用」的自愿语义，名字过线、走加密两跳。B 用 `--socks5` 让 curl 先在本地解析成真 IP 再交出来，命中 IP-CIDR 行直连。想在第二幕之外亲眼看假门牌，装了 dig 的机器可以跑 `dig @127.0.0.1 -p {dnsPort} localhost`；Windows 自带的 nslookup 指定不了端口，跳过无妨。

**先猜后跑。** 打开 `demo/mini-clash-demo.ts`，把 choose 组的名单从 `['node-fast', 'node-slow']` 倒过来成 `['node-slow', 'node-fast']`。跑之前写下预言：第二幕第②步打印的节点是谁？curl A 还能拿到正文吗？快桩门前的抄录会记到多少字节？跑 `npm run demo:mini-clash` 验证。答案：节点换成 node-slow——select 组默认出名单第一个，规则行一个字没动；curl A 照样拿到正文，只是每批字节都被慢桩压了 120ms，快不了一秒、慢得能上手感；快桩抄录记到 0 字节——连接整体搬了家。这一跑把第 10 章「组内选谁由策略定」在整机上的含义变成手感。顺手跑 `npm test`，73 条全绿。

## 11.6 收束：零件已成整机

回到开篇那句话——零件全齐，整机为零。现在整机不是零了：`startMiniClash` 一份配置文本进去，入口、DNS、规则、组、隧道按各自章节的语义同时就位；一条 `npm run demo:mini-clash` 拉起远端与目标站，两条 curl 从浏览器一路走到目标站再回来。三笔欠账本章全部清掉：第 7 章的判决接线、第 8 章的 DNS 接线，从测试草稿纸焊进了 `src/mini-clash.ts`；第 10 章的 `createRouter` 有了第一个真实用户——`startMiniClash` 的第一行——配置第一次被一台真实机器消费，端口与密码各就各位。

你已经能做什么？与全书模块对个账。

| 章 | 零件 | 你写出了什么 |
| --- | --- | --- |
| 2 | `src/http-proxy.ts` | HTTP 正向代理的两种接法（absolute-form 与 CONNECT） |
| 3 | `src/socks5.ts` | 字节级通用入口，`onConnect` 钩子成为全书接缝 |
| 4 | `src/relay.ts`、`src/dial.ts` | 两跳链路：远端中继与长度前缀帧 |
| 5 | —— | 威胁模型：第二跳加密防谁、防什么 |
| 6 | `src/crypto.ts` | 盐 + HKDF + AEAD 帧的加密隧道 |
| 7 | `src/rules.ts` | 规则引擎：按序首中即停的分流判决 |
| 8 | `src/fakeip.ts` | 假电话簿与账本还原，DNS 前哨 |
| 9 | `src/tun.ts` | 报文解析实验（未进整机——接管面的另一种形态） |
| 10 | `src/config.ts` | 声明式配置与代理组 |
| 11 | `src/mini-clash.ts` | 总装：一条命令拉起的整机 |

这张表里每一行的行为，此刻都在 `npm test` 的 73 条用例与一条 demo 命令里同时活着。可迁移的解法两件：接缝收口——让模块间的接线只存在于一处，改动就只发生在一处；端到端验证——零件测试证明零件对，整机测试证明接对了，两层缺一不可。

全书还剩最后一件事：mini 版与真实 Clash 差在哪——协议面、连接复用、真实 TUN 栈、规则 providers。还有「打开 Clash 之后流量经历了什么」这个开场问题的正式收口，都在下一章对账。

### 自查

1. 预测：把 demo 配置里第 0 行规则改成 `DOMAIN,localhost,auto`。第二幕第②步打印的出站与节点各是什么？curl A 的路径变吗？
2. 接线：把 `onConnect` 里还原与判决对调（先 `matchTarget` 再 `restore`），整机的哪个行为会先坏掉？为什么零件测试全是绿的？
3. 动手：把篡改用例里 corruptor 的翻字节从「去程末位」挪到「回程末位」（`back.on('data')` 里翻）。预言：用例还能过吗？目标站的 `requests()` 还会是 0 吗？

::: details 参考答案与锚点
1. 出站 auto、节点 node-fast。路径不变：auto 建组时已现场测速、此刻出快者（回查 10.4.3 与 11.5 第一幕打印）——变的只是「出谁」的理由，从 select 默认名单第一个换成成绩说话。
2. 假门牌连接的分流先坏：判决见到 `198.18.x.x`，域名行全部失明，全部落 IP-CIDR 与兜底（回查 11.3 的反事实与 7.3.5 的「有域名先不解析」）。零件测试绿是因为规则引擎对 IP 目标、账本对还原各自都正确——错在接缝的顺序，只有端到端用例抓得住（回查 11.4 的顺序注释）。
3. 过不了。连接照样断——入口侧验漆失败、浏览器只见断线，`waitClose` 那行仍成立；但目标站已经收到了完整的 GET，`requests()` 变 1，`toBe(0)` 的断言抓个正着。想验证回程语义，得把断言改成「requests 为 1 且浏览器收不到正文」——坏在这一跳的是应答，不是请求（回查 11.4 篡改用例与第 6 章「验不过整封拒收」的双向语义）。
:::
