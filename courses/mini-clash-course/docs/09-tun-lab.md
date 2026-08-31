---
title: TUN 模式：虚拟网卡与全系统流量
---

# TUN 模式：虚拟网卡与全系统流量

## 9.1 前情：两笔挂账，都指到这一章

三个问题，接上第 8 章的尾巴：

- 第 1 章你亲眼见过：系统代理开着，那个不理会它的命令行工具照样直连。为什么一个「开关」罩不住全部应用？根治办法在哪一层？
- 第 8 章末尾留了一笔：不经入口的应用拿到假门牌，无人还原，连接永远找不到主人。账本明明就在本地，差的是什么？
- 两笔账的答案是同一个：还差一个「全机流量都不得不经过」的位置。这一章把它找出来——TUN 虚拟网卡。

## 9.2 开章：罩不住的，和收得进的

到现在为止，你已经能把一整套体系跑起来：SOCKS5 入口接流量，规则引擎判决，fake-ip 账本把假门牌还原成域名，AEAD 隧道把第二跳上锁。可那个不理会系统代理的命令行工具，从第 1 章到第 8 章一直在原地直连——你的整套体系对「不愿意配合的应用」无能为力，因为系统代理只是应用层的一块公告栏，谁来读谁受益。

Clash 的根治办法是在操作系统里立一根虚拟网线。TUN 虚拟网卡（TUN device）——操作系统里一块没有真实网线的网卡，读它、写它的不是网线另一头，而是你自己的进程。把默认路由指向它之后，全机的 IP 包不管哪个应用发的，都先流进这块网卡——命令行直连彻底没有出路。代价随即就来：代理进程拿到的不再是现成的 socket，而是一包包原始报文——没有连接对象，没有端口属性，只有字节。它得自己当协议栈，把包拼回连接。这一章就在自造的报文样本上，把这个「拆包、认连接、拼字节流」的过程亲手做一遍。

## 9.3 原理：从自愿公告到路由收口，从包到连接

### 9.3.1 系统代理为什么罩不住

第 1 章教过系统代理的语义：操作系统里的一块公告栏——设置项或环境变量，应用自愿来读。读了的应用把请求交给正向代理入口；不读的应用照旧自己发包。这一章要回答的是更深一层：公告栏为什么天生罩不住？

反事实检验一下：能不能在应用层强制？不能。发一个网络包的最后一步，握在每个应用自己的代码手里——它调操作系统的发包接口，指定发往哪里。操作系统在应用层只提供了「公告」，没提供「关卡」；应用不读公告，操作系统在它发包那一刻没有任何理由拦下它。**插不进关卡，就只能在更低的层等它。**

包发出去之前还有最后一道必经工序：操作系统要查路由表，决定这个包从哪块网卡出去。这一步不在任何应用的代码里，没有任何包能跳过。TUN 的解法就立在这里——把默认路由指向一块 TUN 虚拟网卡，全机 IP 包就都流进它，交给读它的代理进程。锚点：给整机流量装一个总闸接口，所有水先流进总闸，再由它决定分流。系统代理与应用 TUN 的覆盖面差异，根子就在收口位置。（有个诚实的追问：代理进程自己发出的包不也进总闸了吗？真实配置会给它的出口留一条更具体的路由豁免，不让水流回自己手里——本章不动真实路由，这笔账记在回望章的差异地图里。）

```text
系统代理：应用层公告，自愿来看              TUN：路由层收口，无路可绕
  应用 A（读公告）→ 代理入口 → 出网          应用 A ─┐
  应用 B（读公告）→ 代理入口 → 出网          应用 B ─┼→ 操作系统查路由表 → TUN 虚拟网卡 → 代理进程
  应用 C（不理会）→ 自己发包   → 出网        应用 C ─┘      （发包必经，与意愿无关）
```

| | 系统代理 | TUN 模式 |
|---|---|---|
| 收口位置 | 应用层（自愿读设置） | 路由层（发包必经） |
| 罩得住谁 | 愿意配合的应用 | 全机所有应用 |
| 不配合的应用 | 照样直连 | 包照样流进代理进程 |
| 入口拿到什么 | 现成的 socket | 一包包原始 IP 报文 |

表里最后一行是这一章真正的功课：收口换来覆盖面，代价是入口的「待遇」降级了。前八章的入口每次收到 CONNECT 请求，目标地址已经写在报文里；TUN 位置的进程眼里没有这些，只有一包包字节。要把它们变回「谁要去哪」，得自己拆。

还有一句丑话在前：真实 TUN 要建虚拟网卡、改路由表，两件事都要管理员权限，还得处理 ARP 一类配置杂务。本章不动你的真实网卡——所有实验都在内存里的自造字节样本上做（9.4 讲样本纪律）。

### 9.3.2 IP 头部：每个包开头 20 字节的元数据

TUN 进程拿到的是一个个 IP 包。IP 头部——每个 IP 包开头 20 字节左右的固定格式元数据：版本、总长、源/目的 IP 等。拆包第一步，就是把这份元数据读出来。裁判是 RFC 791，逐字段结构如下。

```text
偏移  0        1        2-3      4-5      6-7       8        9        10-11     12-15     16-19
     ┌────────┬────────┬────────┬────────┬─────────┬────────┬────────┬─────────┬─────────┬─────────┐
     │版本│IHL │ 服务   │ 总长    │ 标识    │标志│分片│  TTL   │ 协议   │头校验和 │  源 IP   │ 目的 IP  │
     └────────┴────────┴────────┴────────┴─────────┴────────┴────────┴─────────┴─────────┴─────────┘
      4位│4位   1 字节   2 字节   2 字节   3位│13位   1 字节   1 字节   2 字节    4 字节    4 字节
```

| 字段 | 一句人话 |
|---|---|
| 版本 + IHL | 高 4 位版本（4 = IPv4）；低 4 位 IHL 是头长，单位 4 字节，最小 5——选项会让头变长 |
| 服务类型 | 优先级一类的标记，教学版不读 |
| 总长 | 整包（头 + 载荷）多少字节——找载荷终点全靠它 |
| 标识 / 标志 / 分片偏移 | 包太大被切片时对齐用的三兄弟；教学样本一律 DF（不许分片） |
| TTL | 生存时间：每过一台路由器减 1，减到 0 就丢——防止包在外永久流浪 |
| 协议 | 6 = TCP、17 = UDP——载荷里装的是哪一层的信，认连接的钥匙之一 |
| 头校验和 | 头部防错码；教学样本填 0，解析器也不验（差异清单） |
| 源 IP / 目的 IP | 寄出方与收件方门牌，各 4 字节 |

光看表还不够，拿一个真包跟读。这是实验场自造的 SYN 包（一次 TCP 连接的第一拍），40 个字节，每个值都是教学值。

```text
# companion 实测字节：tests/fixtures/tun-sample.ts 拼出的 SYN 包（40 字节）
45                          版本 4（高 4 位）+ IHL 5（低 4 位）→ 头长 5×4 = 20 字节
00                          服务类型：教学样本不用
00 28                       总长 40 = 20 字节头 + 20 字节载荷——整个 TCP 段头就是 IP 的载荷
00 00                       标识：教学样本不启用，0
40 00                       标志与分片偏移：DF（不许分片）
40                          TTL = 64
06                          协议 = 6（TCP）
00 00                       头校验和：教学值 0，不验（差异清单）
c0 00 02 0a                 源 IP：192.0.2.10（RFC 5737 文档段，不会分给真实主机）
cb 00 71 14                 目的 IP：203.0.113.20
—— 以上 20 字节是 IP 头；下面 20 字节是它的载荷，一个 TCP 段 ——
cf 08                       源端口 53000
01 bb                       目的端口 443
00 00 03 e8                 序号 1000（TCP 字节流的编号，下一节拆讲）
00 00 00 00                 确认号 0（SYN 拍不携带）
50 02                       数据偏移 5×4 = 20 字节；标志字节 0x02 = SYN
10 00                       窗口 4096
00 00 00 00                 校验和与紧急指针：教学值 0
```

两个位演算纸笔可复算。`0x45` 拆两半：版本 = `0x45 >>> 4 = 4`，IHL = `0x45 & 0x0f = 5`——一个字节装两个字段，各取各的位。`0x0028 = 40` 是大端序两字节（第 3 章教过的「高位在前」）。载荷从哪开始、到哪结束，头部自己说得清：从 IHL×4 开始，到总长为止——头里有选项时 IHL 变大，载荷起点跟着后移，这段跳过的逻辑 9.4 会写成代码。

### 9.3.3 报文段：TCP 层的包

IP 头剥开，露出载荷。当协议是 6 时，载荷是一个报文段——TCP 层的包：头部（端口、序号、标志位）+ 载荷，多个段按序号重组成字节流。裁判是 RFC 9293。

```text
偏移  0-1      2-3      4-7      8-11       12         13        14-15    16-17    18-19
     ┌────────┬────────┬────────┬────────┬──────────┬──────────┬────────┬────────┬─────────┐
     │ 源端口  │ 目的端口│  序号   │ 确认号  │偏移│保留 │  标志位   │  窗口  │ 校验和 │紧急指针  │
     └────────┴────────┴────────┴────────┴──────────┴──────────┴────────┴────────┴─────────┘
      2 字节    2 字节   4 字节    4 字节    4位│4位    1 字节     2 字节   2 字节   2 字节
```

| 字段 | 一句人话 |
|---|---|
| 源端口 / 目的端口 | 同一台机器上区分服务的房间号（第 1 章的老朋友） |
| 序号 seq | 这段载荷在整条字节流里的起点编号——「第几个字节」的计数体系 |
| 确认号 ack | 我已收齐对方流的第几字节，下一字节从这数起——进度回执 |
| 数据偏移 | 段头长，单位 4 字节；TCP 选项（如 MSS——一个段最多装多少字节载荷，握手时双方商量的结果）会让它大于 5 |
| 标志位 | 一个字节八个开关，下面单拆 |
| 窗口 | 我这头还能收多少字节——流量控制的阀门，教学版不读 |
| 校验和 / 紧急指针 | 教学样本填 0，不用 |

标志位字节值得单独一张位图——握手、挥手、带数据，全靠这八个开关的组合表达。

```text
字节 13 的八个开关（低位在右，位值即掩码）：
  CWR     ECE     URG     ACK     PSH     RST     SYN     FIN
  0x80    0x40    0x20    0x10    0x08    0x04    0x02    0x01
```

（左三位 CWR/ECE/URG——拥塞通知与紧急数据的开关，本章用不到，见名不慌；另 byte 12 的低 4 位在 RFC 9293 里实为 3 位保留加 1 位 NS（第九个开关），本章同样不读。）

跟算两个组合。`0x12 = 0x10 + 0x02`：ACK 位与 SYN 位同亮——握手第二拍 SYN|ACK，「我应了你，也发起了我这边」。`0x18 = 0x10 + 0x08`：ACK 与 PSH——一段带确认的数据，「字节给你，别攒着，赶紧交应用」。解析时判断某个开关是否亮，一次位与就够：`(bits & 0x02) !== 0`。

### 9.3.4 五元组：把包认回连接的钥匙

现在手上有地址（IP 头）、有端口和序号（TCP 头），可以回答 TUN 进程的核心问题了：混在一起到达的一堆包，哪些属于同一条连接？

答案是五元组——识别一条 TCP 连接的五项信息：源 IP、源端口、目的 IP、目的端口、协议。锚点是通话单：谁（源 IP:端口）用哪条线（协议）打给谁（目的 IP:端口）——一张通话单就是一条连接，同一条连接的每个包都盖着同一张单子。五项为什么缺一不可？同一台机器上开两条连接去同一台服务器，只可能差在端口上——端口不进钥匙，两条并一条；UDP 与 TCP 用同两个端口也不稀奇——协议不进钥匙，两种流量搅在一起。

拿到钥匙，包变回连接还有两步。**第一步按五元组归组**：一来一回是同一条连接，钥匙按两端点排序生成，方向无关——192.0.2.10:53000 发往 203.0.113.20:443 的包，和反方向回来的包，排出同一把钥匙。**第二步按序号重组**：每个方向各自把载荷按 seq 升序排回、首尾拼接——TCP 承诺的字节流，就是这样从一段段报文段里拼回来的。拿本章样本流里的三个数据段跟读一遍。

```text
到达顺序（全机混流里截出的三段）：
  #08  C→S 192.0.2.10:53000 → 203.0.113.20:443   seq=1007   载荷 'world'
  #09  C→S 192.0.2.10:53001 → 203.0.113.20:80    seq=2001   载荷 'GET / HTTP/1.1␍␊␍␊'
  #10  C→S 192.0.2.10:53000 → 203.0.113.20:443   seq=1001   载荷 'hello '
```

#08 与 #10 五元组相同，归同一条连接；#09 源端口与目的端口都不同，另归一条。#08 先到、#10 后到——到达顺序乱了，序号没乱：按 seq 排，1001 的 'hello ' 排在 1007 的 'world' 前面，字节流拼回 'hello world'。**连接的真相在序号里，不在到达顺序里。**

这套还原也正是 TUN 位置对第 8 章遗留账的根治。进程从五元组里读到目的 IP，翻 fake-ip 账本还原域名，再交规则引擎判决。「不经入口的应用拿到假门牌」在 TUN 模式下不存在了——每条连接都不得不从你面前过。

### 9.3.5 真实 TUN 还差什么

教学版到此为止的三笔简化，先在正文声明，也登记差异清单附录。

- 设备与路由不碰。真实 TUN 要建设备、把默认路由指过去（还得给代理进程自己的出口留一条更具体的路由豁免）、处理 ARP（把 IP 换成网卡硬件地址的查询）一类邻居协议、把 DNS 也接管进来——全要管理员权限。本章零接触，实验全在自造样本上。
- 协议栈只当读侧。真实 TUN 模式下，代理进程还得当「另一头」：收到 SYN 要回 SYN|ACK，丢包要重传，头部要算校验和，还得做拥塞控制与流量控制。教学版只做读侧——解析、归组、重排，不回话、不重传、不验校验和。
- 重排也简化。只按 seq 升序拼接，重传的重复段、载荷重叠、序号回绕（32 位序号用完绕回 0）都不处理。

这也是真实 Clash 不手写裸栈的原因：TUN 的公开文档里，栈是可选的现成件（system、gvisor 等）——收口容易，把一个完整 TCP/IP 栈补齐很难，没人愿意在产品里重造它。第 12 章回望把「真实 TUN 栈」列入差异地图对账。

## 9.4 演练：在自造样本上把包拼回连接

实验场开工，先立样本纪律。为什么自造、不抓真实包？三笔账：抓包要动真实网卡（还要管理员权限）；真实字段值不受控，测试没法断言「seq 必须是 1000」；样本还要故意埋教学点——乱序到达、IP 选项、非 TCP 混流。自造样本全部教学值：IP 用 RFC 5737 文档段（192.0.2.x、203.0.113.x，不会分给真实主机），端口与序号取整数，测试断言一眼可核。与前八章全在 127.0.0.1 回环地址上做实验不同，这一章连回环都不用——样本就是内存里的字节。测试 `tests/tun-lab.test.ts` 照旧先写、先跑出红（模块不存在，加载即失败），再写实现转绿，11 条用例；门槛命令 `cd companion && npm run typecheck && npm test` 全绿 61 条（旧 50 + 本章 11）——旧用例一字未动还全绿，就是「解析件不碰既有链路」的机械证据。

### 9.4.1 拼装件：样本从教学值长出来

道具在 `tests/fixtures/tun-sample.ts`。拼装是解析的镜像：builder 从字段拼字节，`src/tun.ts` 从字节拆回字段——两边对上，字节布局就没有歧义。

```ts
// tests/fixtures/tun-sample.ts · 教学值常量 + buildTcpPacket
export const CLIENT_IP = '192.0.2.10' // 客户端：RFC 5737 文档段 TEST-NET-1
export const SERVER_IP = '203.0.113.20' // 服务器：文档段 TEST-NET-3
export const FAKE_IP = '198.18.0.5' // 第 8 章假门牌网段里的一个号（第三幕「人人可还」用）

// —— 拼装：IP + TCP ——
// flags 名字与 src/tun.ts 解析结果同形（syn/ack/fin/rst/psh），拼与拆说同一套词
export interface TcpPacketSpec {
  srcIp: string
  srcPort: number
  dstIp: string
  dstPort: number
  seq: number
  ack?: number // 不写就是 0
  flags?: { syn?: boolean; ack?: boolean; fin?: boolean; rst?: boolean; psh?: boolean }
  payload?: Buffer | string
  ipOptions?: Buffer // IHL > 5 时插在 20 字节固定头之后；长度须是 4 的倍数
}

// 常用标志组合的速记
export const F = {
  syn: { syn: true },
  synAck: { syn: true, ack: true },
  ack: { ack: true },
  pshAck: { psh: true, ack: true },
  finAck: { fin: true, ack: true },
} as const

export function buildTcpPacket(spec: TcpPacketSpec): Buffer {
  const payload = typeof spec.payload === 'string' ? Buffer.from(spec.payload, 'latin1') : (spec.payload ?? Buffer.alloc(0))
  const options = spec.ipOptions ?? Buffer.alloc(0)
  if (options.length % 4 !== 0) throw new Error('IP 选项长度须是 4 的倍数（IHL 按字数计）')

  // TCP 段头（裁判是 RFC 9293）：20 字节固定头，教学样本不带 TCP 选项
  const tcp = Buffer.alloc(20)
  tcp.writeUInt16BE(spec.srcPort, 0)
  tcp.writeUInt16BE(spec.dstPort, 2)
  tcp.writeUInt32BE(spec.seq, 4)
  tcp.writeUInt32BE(spec.ack ?? 0, 8)
  let bits = 0
  if (spec.flags?.fin) bits |= 0x01
  if (spec.flags?.syn) bits |= 0x02
  if (spec.flags?.rst) bits |= 0x04
  if (spec.flags?.psh) bits |= 0x08
  if (spec.flags?.ack) bits |= 0x10
  tcp.writeUInt8((5 << 4) | 0, 12) // 数据偏移 5×4=20 字节，保留位 0
  tcp.writeUInt8(bits, 13)
  tcp.writeUInt16BE(0x1000, 14) // 窗口：教学值 4096
  // 校验和（16-17）与紧急指针（18-19）：教学样本全 0，解析器也不验（差异登记附录）

  return Buffer.concat([ipv4Header(spec.srcIp, spec.dstIp, 6, options, tcp.length + payload.length), tcp, payload])
}
```

IP 头的拼装单独一个函数——UDP 包也要用同一件。

```ts
// tests/fixtures/tun-sample.ts · ipv4Header / writeIp
// IPv4 头（裁判是 RFC 791）：固定 20 字节 + 可选选项；校验和填 0（不启用、不验证）
function ipv4Header(srcIp: string, dstIp: string, protocol: number, options: Buffer, transportLength: number): Buffer {
  const ip = Buffer.alloc(20 + options.length)
  ip.writeUInt8((4 << 4) | (5 + options.length / 4), 0) // 高 4 位版本 4，低 4 位 IHL（单位：4 字节）
  ip.writeUInt16BE(20 + options.length + transportLength, 2) // 总长 = IP 头 + 传输层全部
  ip.writeUInt16BE(0x4000, 6) // 标志与分片偏移：DF（不许分片）；教学样本不分片
  ip.writeUInt8(64, 8) // TTL：教学值 64
  ip.writeUInt8(protocol, 9) // 协议：6 = TCP、17 = UDP——五元组的「协议」元就在这一个字节
  writeIp(ip, 12, srcIp)
  writeIp(ip, 16, dstIp)
  options.copy(ip, 20)
  return ip
}

function writeIp(buf: Buffer, off: number, ip: string): void {
  ip.split('.').forEach((seg, i) => buf.writeUInt8(Number(seg), off + i))
}
```

样本流的剧本是一次完整对话加一次对照：对话 A 是「三次握手 + 两段数据 + 挥手」的全流程，两段数据故意乱序；对话 B 与 A 同一对 IP、只差端口，专给五元组当试金石；中间再混一包 UDP。

```ts
// tests/fixtures/tun-sample.ts · SAMPLE_STREAM
// —— 样本流：15 个包，两路对话交错到达 + 一包 UDP 混在里面 ——
// 真实 TUN 递过来的就是这种「全机混流」；教学样本把交错做成常态，归组才有戏可做。
export const SAMPLE_STREAM: Buffer[] = [
  toServer443(1000, 0, F.syn), // #01 对话 A：SYN
  toServer80(2000, 0, F.syn), // #02 对话 B：SYN（同一个客户端、同一台服务器，端口 80）
  toClient443(5000, 1001, F.synAck), // #03 对话 A：SYN|ACK
  toClient80(7000, 2001, F.synAck, Buffer.from([0x01, 0x01, 0x01, 0x00])), // #04 对话 B：SYN|ACK（带 4 字节 IP 选项）
  toServer443(1001, 5001, F.ack), // #05 对话 A：ACK，握手完成
  buildUdpPacket({ srcIp: CLIENT_IP, srcPort: 53002, dstIp: '198.51.100.7', dstPort: 53, payload: 'udp-demo-payload' }), // #06 一包 UDP（协议 17）混在流里
  toServer80(2001, 7001, F.ack), // #07 对话 B：ACK，握手完成
  toServer443(1007, 5001, F.pshAck, 'world'), // #08 对话 A：第二段数据「先到」（序号 1007）
  toServer80(2001, 7001, F.pshAck, 'GET / HTTP/1.1\r\n\r\n'), // #09 对话 B：一段数据（第 2 章的老朋友）
  toServer443(1001, 5001, F.pshAck, 'hello '), // #10 对话 A：第一段数据「后到」（序号 1001）
  toClient443(5001, 1012, F.pshAck, 'HELLO WORLD!'), // #11 对话 A：服务器回话（12 字节）
  toServer443(1012, 5013, F.finAck), // #12 对话 A：客户端挥手 FIN|ACK
  toClient443(5013, 1013, F.ack), // #13 对话 A：服务器应答挥手
  toClient443(5013, 1013, F.finAck), // #14 对话 A：服务器也挥手
  toServer443(1013, 5014, F.ack), // #15 对话 A：客户端最后应答，连接收摊
]
```

文件里还有两件小道具不再整段贴：`buildUdpPacket`（8 字节 UDP 头，形态与上面同款）和 `FAKE_IP_STREAM`（发往假门牌 198.18.0.5 的三拍握手，9.4.5 上场）。序号走位对着 9.3.4 的跟读核一遍：客户端 1000（SYN）→ 1001（'hello '）→ 1007（'world'）→ 1012（FIN）；服务器 5000（SYN|ACK）→ 5001（'HELLO WORLD!' 12 字节）→ 5013（FIN）。

### 9.4.2 parseIpv4Packet：拆信封的四道验收

解析件 `src/tun.ts` 的第一件。真实 TUN 里混着各路包，看不懂的必须如实交白卷——所以拆不出来就返回 null，四个关卡：太短、版本不是 4、IHL 非法、总长与实际对不上。

```ts
// src/tun.ts · Ipv4Packet / parseIpv4Packet / ipAt
export interface Ipv4Packet {
  version: number // 恒为 4（IPv4）——字节 0 的高 4 位
  headerLength: number // IHL × 4：固定头 20 字节 + 选项；载荷从这里开始
  totalLength: number // 头 + 载荷的整包长度——链路层塞的填充尾巴不算在內
  protocol: number // 6 = TCP、17 = UDP……五元组的「协议」元就住在这一个字节
  srcIp: string
  dstIp: string
  payload: Buffer // 传输层视角的载荷 = subarray(headerLength, totalLength)
}

// 拆 IP 头（裁判是 RFC 791）。四样验收不过就还原不出（null）：太短、版本不是 4、
// IHL 非法、总长与实际字节对不上——真实 TUN 里混着各路包，看不懂的如实交白卷
export function parseIpv4Packet(buf: Buffer): Ipv4Packet | null {
  if (buf.length < 20) return null // 连 20 字节固定头都不齐
  const version = buf[0] >>> 4
  if (version !== 4) return null // IPv6 的包不是本实验的对象
  const ihl = buf[0] & 0x0f
  if (ihl < 5) return null // 固定头就要 5 字（20 字节），更短的 IHL 非法
  const headerLength = ihl * 4
  const totalLength = buf.readUInt16BE(2)
  if (totalLength < headerLength || totalLength > buf.length) return null // 半截包
  return {
    version,
    headerLength,
    totalLength,
    protocol: buf[9],
    srcIp: ipAt(buf, 12),
    dstIp: ipAt(buf, 16),
    payload: buf.subarray(headerLength, totalLength), // 选项字（若有）随头一起跳过
  }
}

// 四个字节拼回点分 IPv4
function ipAt(buf: Buffer, off: number): string {
  return `${buf[off]}.${buf[off + 1]}.${buf[off + 2]}.${buf[off + 3]}`
}
```

三处读点。`subarray(headerLength, totalLength)` 一行同时兑现两个纪律：载荷起点跟着 IHL 走（#04 那包带 4 字节选项，IHL=6，起点后移到 24）；终点跟着总长走（以太网小包会被链路层填充到最小帧长，填充的尾巴不算报文的）。9.3.2 那场位演算就是 `buf[0] >>> 4` 与 `buf[0] & 0x0f` 两行代码的纸笔版。

### 9.4.3 parseTcpSegment：端口、序号与八个开关

第二件拆 TCP 段头，逐字段对齐 9.3.3 的结构表。

```ts
// src/tun.ts · TcpFlags / TcpSegment / parseTcpSegment
export interface TcpFlags {
  syn: boolean // 同步：握手第一拍/第二拍的记号
  ack: boolean // 确认：这段的确认号字段有效
  fin: boolean // 结束：我这边的字节流说完了（挥手）
  rst: boolean // 重置：立刻断线，异常收场
  psh: boolean // 推送：别攒了，赶紧交给应用
}

export interface TcpSegment {
  srcPort: number
  dstPort: number
  seq: number // 序号：这段载荷在字节流里的起点（第 3 章教过的大端序，这里是 4 字节版）
  ack: number // 确认号：下一字节该从哪数起（对方流的进度回执）
  dataOffset: number // 段头长 = 高 4 位 × 4：固定 20 字节 + TCP 选项
  flags: TcpFlags
  payload: Buffer
}

// 标志位字节（段内偏移 13，裁判是 RFC 9293）——一字节八个开关，低位到高位：
// FIN=0x01、SYN=0x02、RST=0x04、PSH=0x08、ACK=0x10、URG=0x20
const FLAG_FIN = 0x01
const FLAG_SYN = 0x02
const FLAG_RST = 0x04
const FLAG_PSH = 0x08
const FLAG_ACK = 0x10

// 拆 TCP 段头。太短、数据偏移非法都还原不出（null）
export function parseTcpSegment(buf: Buffer): TcpSegment | null {
  if (buf.length < 20) return null
  const dataOffset = (buf[12] >>> 4) * 4
  if (dataOffset < 20 || dataOffset > buf.length) return null // 偏移小于固定头即非法
  const bits = buf[13]
  return {
    srcPort: buf.readUInt16BE(0),
    dstPort: buf.readUInt16BE(2),
    seq: buf.readUInt32BE(4),
    ack: buf.readUInt32BE(8),
    dataOffset,
    flags: {
      syn: (bits & FLAG_SYN) !== 0,
      ack: (bits & FLAG_ACK) !== 0,
      fin: (bits & FLAG_FIN) !== 0,
      rst: (bits & FLAG_RST) !== 0,
      psh: (bits & FLAG_PSH) !== 0,
    },
    payload: buf.subarray(dataOffset), // TCP 选项在选项区里，随头跳过
  }
}
```

五次 `(bits & FLAG_X) !== 0` 就是 9.3.3 那张位图的代码形态——0x12 进来，SYN 与 ACK 两位各自亮起，其余三位全灭。数据偏移的读法与 IHL 同构：高 4 位、单位 4 字节，TCP 选项（真实握手里常见的 MSS 协商）随头一起跳过，教学版不解释它。

### 9.4.4 groupSessions：归组与重排

第三件把前两件串起来：每个包先拆 IP、再拆 TCP，按五元组归组，最后按序号把两个方向的字节流拼回来。

```ts
// src/tun.ts · TunSession / GroupResult / groupSessions
export interface SessionSegment {
  from: 'client' | 'server' // 相对首包方向：首包发送方记作 client（发起方）
  flags: string // 'SYN' / 'SYN|ACK' / 'PSH|ACK' …——跟读一张连接的履历用
  seq: number
  ack: number
  dataBytes: number
}

export interface TunSession {
  key: string // 规范五元组：协议打头、两端点按字典序小者在前——一来一回两方向拼同一把钥匙
  client: string // 首包发送方 ip:port
  server: string // 首包接收方 ip:port
  segments: SessionSegment[] // 按到达顺序
  toServer: Buffer // client→server 的字节流：按序号升序拼回（教学版的重排）
  toClient: Buffer // server→client 同理
}

export interface GroupResult {
  sessions: TunSession[] // 按首包出现顺序
  skipped: number // 解不出 / 非 TCP 的包数：真实 TUN 里全机流量都会来，看不懂的如实计数
}

// 把一串到达的 IP 包归回各自的 TCP 连接。TUN 递过来的是「全机混流」——
// 归组的钥匙只有一把：五元组（源 IP:端口 + 目的 IP:端口 + 协议）。
// 字节流重排只按序号升序拼接：重传重复、载荷重叠、序号回绕都不处理（差异登记附录）
export function groupSessions(packets: readonly Buffer[]): GroupResult {
  const byKey = new Map<string, TunSession>()
  const pending = new Map<TunSession, { c2s: Array<{ seq: number; bytes: Buffer }>; s2c: Array<{ seq: number; bytes: Buffer }> }>()
  const sessions: TunSession[] = []
  let skipped = 0
  for (const buf of packets) {
    const ip = parseIpv4Packet(buf)
    const seg = ip !== null && ip.protocol === 6 ? parseTcpSegment(ip.payload) : null
    if (ip === null || seg === null) {
      skipped += 1
      continue
    }
    const a = `${ip.srcIp}:${seg.srcPort}`
    const b = `${ip.dstIp}:${seg.dstPort}`
    const key = `tcp|${a < b ? a : b}|${a < b ? b : a}` // 两端排序定钥匙：方向无关
    let s = byKey.get(key)
    if (s === undefined) {
      s = { key, client: a, server: b, segments: [], toServer: Buffer.alloc(0), toClient: Buffer.alloc(0) }
      byKey.set(key, s)
      pending.set(s, { c2s: [], s2c: [] })
      sessions.push(s)
    }
    const fromClient = a === s.client
    s.segments.push({ from: fromClient ? 'client' : 'server', flags: flagString(seg), seq: seg.seq, ack: seg.ack, dataBytes: seg.payload.length })
    const parts = pending.get(s)!
    if (seg.payload.length > 0) (fromClient ? parts.c2s : parts.s2c).push({ seq: seg.seq, bytes: seg.payload })
  }
  for (const s of sessions) {
    const parts = pending.get(s)!
    s.toServer = reassemble(parts.c2s)
    s.toClient = reassemble(parts.s2c)
  }
  return { sessions, skipped }
}

function flagString(seg: TcpSegment): string {
  const names: Array<[keyof TcpFlags, string]> = [
    ['syn', 'SYN'],
    ['fin', 'FIN'],
    ['rst', 'RST'],
    ['psh', 'PSH'],
    ['ack', 'ACK'],
  ]
  return names.filter(([k]) => seg.flags[k]).map(([, n]) => n).join('|')
}

// 按序号升序拼接——乱序到达的段在这里回到正确位置
function reassemble(parts: Array<{ seq: number; bytes: Buffer }>): Buffer {
  if (parts.length === 0) return Buffer.alloc(0)
  return Buffer.concat([...parts].sort((x, y) => x.seq - y.seq).map((p) => p.bytes))
}
```

钥匙那一行是全件的枢纽：`tcp|${小端点}|${大端点}`——两个端点各是「IP:端口」，按字典序排定先后，一来一回排出同一把钥匙，这就是 9.3.4 说的「方向无关」。非 TCP 的包（#06 那包 UDP）不硬拆，`skipped` 如实计数——真实 TUN 递过来的是全机流量，看不懂的假装看得懂才是事故。`reassemble` 里一次 sort，就是「连接的真相在序号里」的代码形态。

11 条用例的分布：parseIpv4Packet 5 条，覆盖 SYN 逐字段、hex 回喂、UDP、残缺与非法、IHL=6 跳过选项。parseTcpSegment 3 条：握手两拍、数据段、残缺与非法。groupSessions 3 条：归组计数、乱序拼回、假门牌还原。其中 hex 回喂那条专盯正文：`SYN_HEX` 喂回去解析出的字段必须与拼装件一字不差——读者在 REPL 里粘的十六进制，测试替你天天验。

### 9.4.5 第三幕接线：TUN 位置翻 fake-ip 账本

第 8 章的遗留账在这一步收口。发往假门牌的连接，在 TUN 位置同样被归成一条连接——目的 IP 拿去翻账本，门牌当场有主。

```ts
// tests/tun-lab.test.ts · 假门牌人人可还（第三幕的机械形态）
  it('TUN 位置假门牌人人可还：发往 198.18.0.5 的连接一翻账本就是域名', () => {
    // 第 8 章的遗留账在此收口：不经入口的应用拿假门牌连接，在 TUN 位置同样看得见——
    // 归出连接后按目的 IP 翻 fake-ip 账本，门牌当场有主
    const pool = new FakeIpPool()
    for (const filler of ['a.example', 'b.example', 'c.example', 'd.example']) pool.allocate(filler)
    expect(pool.allocate('www.example.com')).toBe('198.18.0.5') // 排到第 5 个号，正是样本流的目的地
    const { sessions } = groupSessions(FAKE_IP_STREAM)
    expect(sessions.length).toBe(1)
    expect(sessions[0].server).toBe('198.18.0.5:443')
    expect(pool.restore(sessions[0].server.split(':')[0])).toBe('www.example.com')
  })
```

注意这次合演的两件零件互不相识：`src/tun.ts` 不知道账本，`src/fakeip.ts` 不知道报文——组合发生在调用方。这与第 7、8 章「判决接线长在入口钩子上」是同一门手艺：解析件只管把包变回连接，翻不翻账、判不判 PROXY，是站在 TUN 位置的那个人说了算。

## 9.5 验证：亲手开机，喂字节看连接

**开机。** 全部验证只需要 companion 目录。先喂一包十六进制给解析器——不写代码，命令行一行。

```bash
cd companion
node --import tsx -e "import('./src/tun.ts').then(m => console.log(m.parseIpv4Packet(Buffer.from('450000280000400040060000c000020acb007114cf0801bb000003e8000000005002100000000000','hex'))))"
```

```text
# 上面这条命令的输出（40 个字节进，IP 头字段出）
{
  version: 4,
  headerLength: 20,
  totalLength: 40,
  protocol: 6,
  srcIp: '192.0.2.10',
  dstIp: '203.0.113.20',
  payload: <Buffer cf 08 01 bb 00 00 03 e8 00 00 00 00 50 02 10 00 00 00 00 00>
}
```

那串十六进制就是 9.3.2 跟读的 SYN 包——你逐字节核，`45 00 00 28` 对上 `version 4 / headerLength 20 / totalLength 40`，`c0 00 02 0a` 对上 `srcIp '192.0.2.10'`。再把外层扒掉看 TCP 头。

```bash
node --import tsx -e "import('./src/tun.ts').then(m => console.log(m.parseTcpSegment(m.parseIpv4Packet(Buffer.from('4500002e0000400040060000c000020acb007114cf0801bb000003e900001389501810000000000068656c6c6f20','hex')).payload)))"
```

```text
# 输出：数据段的端口、序号与标志位，载荷正是 'hello '
{
  srcPort: 53000,
  dstPort: 443,
  seq: 1001,
  ack: 5001,
  dataOffset: 20,
  flags: { syn: false, ack: true, fin: false, rst: false, psh: true },
  payload: <Buffer 68 65 6c 6c 6f 20>
}
```

第二串十六进制是样本流里 #10 那段数据——`50 18` 的标志字节 0x18 拆出 `ack: true, psh: true`，尾部 6 个字节 `68 65 6c 6c 6f 20` 就是 'hello '。然后跑整机样本流。

```bash
npm run demo:tun-lab
```

```text
# companion 的 demo:tun-lab 输出节录（第二幕与第三幕）
—— 第二幕：15 个包（两路对话交错 + 一包 UDP）归回连接 ——
  #01 C→S 192.0.2.10:53000 → 203.0.113.20:443  SYN      seq=1000  ack=0     载荷 0 字节
  #02 C→S 192.0.2.10:53001 → 203.0.113.20:80  SYN      seq=2000  ack=0     载荷 0 字节
  #03 S→C 203.0.113.20:443 → 192.0.2.10:53000  SYN|ACK  seq=5000  ack=1001  载荷 0 字节
  #05 C→S 192.0.2.10:53000 → 203.0.113.20:443  ACK      seq=1001  ack=5001  载荷 0 字节
  #06 ···· 非 TCP 包（协议 17）：教学版不硬拆，如实计数
  #08 C→S 192.0.2.10:53000 → 203.0.113.20:443  PSH|ACK  seq=1007  ack=5001  载荷 5 字节  "world"
  #09 C→S 192.0.2.10:53001 → 203.0.113.20:80  PSH|ACK  seq=2001  ack=7001  载荷 18 字节  "GET / HTTP/1.1\r\n\r\n"
  #10 C→S 192.0.2.10:53000 → 203.0.113.20:443  PSH|ACK  seq=1001  ack=5001  载荷 6 字节  "hello "
  #11 S→C 203.0.113.20:443 → 192.0.2.10:53000  PSH|ACK  seq=5001  ack=1012  载荷 12 字节  "HELLO WORLD!"
  归组结果：2 条 TCP 连接 + 1 包非 TCP（skipped）
  连接 1  tcp|192.0.2.10:53000|203.0.113.20:443  共 10 段（首包发送方记作 client）
    C→S 字节流（按序号拼回，11 字节）: "hello world"
    S→C 字节流（按序号拼回，12 字节）: "HELLO WORLD!"
  连接 2  tcp|192.0.2.10:53001|203.0.113.20:80  共 4 段（首包发送方记作 client）
    C→S 字节流（按序号拼回，18 字节）: "GET / HTTP/1.1\r\n\r\n"

—— 第三幕：TUN 位置，假门牌人人可还 ——
  全机混流里出现一条连接: 192.0.2.10:53003 → 198.18.0.5:443（三拍握手，3 段）
  目的 IP 198.18.0.5 翻 fake-ip 账本 → www.example.com
```

第二幕就是 9.3.4 的跟读可感知版：15 个包、两路对话交错，归出恰好 2 条连接；#08 与 #10 乱序到达，字节流仍按序号拼回 'hello world'。第三幕是第 8 章遗留账的闭环见证：一条发往假门牌的连接，在 TUN 位置被看见、被归组、被翻账——门牌有主。顺手 `npm test`，61 条全绿。

**先猜后跑（指认破坏）。** 打开 `src/tun.ts`，把 `reassemble` 里的 `.sort((x, y) => x.seq - y.seq)` 删掉再拼回代码。跑之前写下预言：11 条用例哪条红？连接 1 的 C→S 字节流变成什么？答案：红的只有「乱序到达仍按序号拼回」一条——到达顺序是 #08（world）在前、#10（hello ）在后，不排序就按到达顺序首尾相接，toServer 变成 'worldhello '。其余 10 条不红：连接 2 只有一段数据，排不排无差别；归组与字段解析根本不经过 sort。demo 第二幕里连接 1 的 C→S 字节流同步变 'worldhello '。改回原样，61 条应全绿。

**自包含复算。** 9.5 开头那两行 REPL 命令不进实验场也能跑——只要有这份 companion 检出。再退一步，纸笔也行：拿 9.3.2 的 SYN 包字节，手算 `0x45 >>> 4` 与 `0x45 & 0x0f`，再算 `0x0028` 的十进制——版本、头长、总长三个数你就都有了。

## 9.6 收束：全机流量进了门，包也拼回了连接

回到开篇那个不理会系统代理的命令行工具。现在你能讲清两层：它为什么直连——系统代理是应用层的公告栏，应用不读，操作系统在应用层没有任何关卡拦它；根治为什么在路由层——**发包前查路由表是每包必经的工序，默认路由指向 TUN 虚拟网卡后，不配合的应用也无路可绕**。两笔挂账就此清了：第 1 章的「罩不住」在 9.3.1 找到了层与成因；第 8 章的「假门牌无人还原」在 9.4.5 闭环——TUN 位置看得见全机每一条连接，账本人人可还。

你手里多了第七块零件：`src/tun.ts` 的 `parseIpv4Packet`（拆 IP 头、跳选项、按总长切载荷）、`parseTcpSegment`（端口、序号、八个标志开关）、`groupSessions`（五元组归组 + 序号重排），配上 `tests/fixtures/tun-sample.ts` 的自造样本流。可迁移的解法一件：「在必经之路收口，按标识归组」——负载均衡按四元组把连接哈希到后端、NAT 网关按五元组建映射表，都是同一形状；它换来的位置也同一味：站到所有流量的上游去。

概念去向地图：

- 教学整机仍以 SOCKS5 为入口，TUN 件止步于解析实验——不动真实网卡与路由表，差异清单里逐条登记；真实 TUN 的完整形态（现成用户态栈、设备与路由接管）在第 12 章回望的差异地图对账。
- 假门牌「人人可还」的合演此刻长在测试与 demo 里——第 12 章概念对账时，它属于「你已经能做什么」清单的一行。

### 自查

1. 解释：系统代理开着，一个从不读设置的应用照样把包发出去了。TUN 模式下这个包走了一条什么路？收口发生在哪一步、属于哪一层？
2. 计算：一个 TCP 段的标志字节是 `0x11`，是哪几个开关亮着？这样的段最可能出现在连接生命周期的哪一步？
3. 预测：把 `groupSessions` 的钥匙改成只用「源 IP + 目的 IP」（两端排序照旧，只把端口从钥匙里摘掉），15 个包的样本流会归成几条连接？为什么？

::: details 参考答案与锚点
1. 应用调发包接口后，操作系统查路由表决定出口——默认路由已指向 TUN 虚拟网卡，这个包连同全机所有 IP 包一起流进代理进程，由它拆包、归组、判决。收口在「查路由表」这一步，属路由层；应用层没有关卡，这正是 9.3.1 的成因与反事实检验。
2. `0x11 = 0x10 + 0x01`：ACK 与 FIN 同亮——带确认的挥手，出现在四次挥手处（「我的字节流说完了，你的进度我已确认」）。位图与掩码回查 9.3.3。
3. 归成 1 条：对话 A 与对话 B 的源/目的 IP 完全相同，只差端口——钥匙里没有端口，两路并作一路，'hello world' 与 'GET / …' 混进同一条字节流，谁也读不懂。（若把钥匙写成带方向的两把「源→目的」与「目的→源」，也只是拆成 2 条，每条内部照样混流。）五元组「缺一不可」的演算回查 9.3.4，钥匙构造回查 9.4.4。
:::
