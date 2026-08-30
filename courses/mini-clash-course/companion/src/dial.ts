// src/dial.ts —— 拨号：把「host + port」拨成一条接通的 socket（全书共用的小工具）
import net from 'node:net'
import type { ProxyTarget } from './http-proxy' // 只借「host + port」这个形状，type 引用不带运行时依赖

// net.connect 的 Promise 包装。HTTP 入口、SOCKS5 入口与远端中继都用它拨号：
// 接通即 resolve；连不上 reject，之后怎么回话（502 / REP=01 / 回执 01）由调用方决定
export function connectTo(t: ProxyTarget): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect(t.port, t.host)
    s.once('connect', () => resolve(s))
    s.once('error', (e) => {
      s.destroy()
      reject(e)
    })
    s.on('error', () => s.destroy()) // 接通之后的事故只收尾，不让进程崩
  })
}
