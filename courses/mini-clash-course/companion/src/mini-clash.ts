// src/mini-clash.ts —— 总装：一份配置拉起整机（fake-ip DNS + 规则/组路由 + SOCKS5 入口）
// 零件各自都已成形，这一章只做一件事：接成一条链。每条连接的数据面在 onConnect 一处收口：
// 还原 fake-ip → 规则判决 → 组选节点 → 加密两跳（或直连）；远端中继不在拉起之列——
// 节点是「站在目标可达位置」的别人家机器，整机只管按配置去连它（密码由 loadConfig 产物接管）
import type { Duplex } from 'node:stream'
import { createRouter, loadConfig, type Config, type Router } from './config'
import { FakeIpPool, startFakeDns } from './fakeip'
import { startSocks5Server } from './socks5'
import type { ProxyTarget } from './http-proxy' // 只借「host + port」这个形状，type 引用不带运行时依赖

export interface MiniClashHandle {
  socksPort: number // 入口房间号：inbound.port 写 0 时系统随手分的号从这里读回去
  dnsPort: number // 假电话簿的房间号：教学版不占 53（Unix 系要权限），配置里也没这一格——总装自己起
  pool: FakeIpPool // fake-ip 账本：查池况、对账映射用
  router: Router // 路由器：select 切换、组决策快照都从这进（入口之外的可编程面）
  close(): Promise<void>
}

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
