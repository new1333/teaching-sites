// src/upstream.ts —— upstream 池：轮询分发、失败计数、摘除与回归
export interface UpstreamPeer {
  host: string
  port: number
}

export interface UpstreamOptions {
  peers: UpstreamPeer[]
  maxFails?: number // 连续失败几次摘除（nginx 默认 1 次 / 10 秒窗口；教学实现用「连续」语义）
  failTimeoutMs?: number // 摘除多久后放回来试
  now?: () => number
}

export type PickResult =
  | { ok: true; peer: UpstreamPeer }
  | { ok: false; reason: 'all-down' }

interface PeerState {
  peer: UpstreamPeer
  consecutiveFails: number
  downUntil: number // 0 = 从未摘除；> now 表示摘除中
}

export interface UpstreamPool {
  /** 轮询挑下一台，跳过摘除中的；全员摘除则 all-down */
  pick(): PickResult
  /** 报告一台的结果：成功清零计数；连续失败达 maxFails 进入摘除期 */
  report(peer: UpstreamPeer, ok: boolean): void
  /** 是否处于摘除期（期满自动放行） */
  isDown(peer: UpstreamPeer): boolean
  size(): number
}

export function createUpstreamPool(opts: UpstreamOptions): UpstreamPool {
  const maxFails = opts.maxFails ?? 1
  const failTimeoutMs = opts.failTimeoutMs ?? 10_000
  const now = opts.now ?? Date.now

  const states = new Map<string, PeerState>()
  for (const peer of opts.peers) {
    states.set(`${peer.host}:${peer.port}`, { peer, consecutiveFails: 0, downUntil: 0 })
  }
  const ring = [...states.values()]
  let cursor = 0

  function alive(s: PeerState): boolean {
    return s.downUntil <= now()
  }

  return {
    pick() {
      // 从 cursor 起走一整圈，摘除中的跳过
      for (let i = 0; i < ring.length; i++) {
        const s = ring[cursor % ring.length]
        cursor++
        if (alive(s)) return { ok: true, peer: s.peer }
      }
      return { ok: false, reason: 'all-down' }
    },

    report(peer, ok) {
      const s = states.get(`${peer.host}:${peer.port}`)
      if (!s) return
      if (ok) {
        s.consecutiveFails = 0
        s.downUntil = 0
      } else {
        s.consecutiveFails++
        if (s.consecutiveFails >= maxFails) {
          s.downUntil = now() + failTimeoutMs // 摘除：期满后 alive 自动放行（试探性回归）
        }
      }
    },

    isDown(peer) {
      const s = states.get(`${peer.host}:${peer.port}`)
      return s ? !alive(s) : false
    },

    size() {
      return ring.length
    },
  }
}
