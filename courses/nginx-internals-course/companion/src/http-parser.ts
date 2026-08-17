// src/http-parser.ts —— HTTP/1.1 请求头解析状态机
// 只负责「字节流 → 请求头」这一段：请求体（body）不在本章范围。

export interface RequestHead {
  method: string
  path: string
  version: string
  headers: Record<string, string> // 键统一小写：HTTP 头部名大小写不敏感
}

export type ParseErrorReason =
  | 'bad-request-line' // 请求行不是「方法 路径 版本」三段
  | 'bad-header' // 头部行没有冒号
  | 'line-too-long' // 一行超过上限——慢速攻击防线

export type ParseEvent =
  | { type: 'request'; head: RequestHead }
  | { type: 'error'; reason: ParseErrorReason }

export interface HttpParser {
  /** 喂入一段字节，返回这段字节「催熟」出的事件（0 到多个） */
  feed(bytes: Uint8Array): ParseEvent[]
}

export interface ParserOptions {
  maxLineBytes?: number
}

export function createHttpParser(opts: ParserOptions = {}): HttpParser {
  const maxLineBytes = opts.maxLineBytes ?? 8 * 1024
  const decoder = new TextDecoder('latin1') // 逐字节映射，任意字节都不会解码失败

  // 三种状态：line（读请求行）→ headers（读头部行）→ 回到 line 等下一个请求
  // broken：出过错，永不再产出——连接应该关闭
  let state: 'line' | 'headers' | 'broken' = 'line'
  let pending = '' // 跨次 feed 存活的未完成行（可能停在任何字节处，包括 \r\n 的中间）
  let head: RequestHead | null = null

  function fail(events: ParseEvent[], reason: ParseErrorReason): void {
    events.push({ type: 'error', reason })
    state = 'broken'
  }

  return {
    feed(bytes) {
      const events: ParseEvent[] = []
      if (state === 'broken') return events

      pending += decoder.decode(bytes)

      for (;;) {
        const idx = pending.indexOf('\r\n')
        if (idx === -1) {
          // 手里没有完整行。若未完成部分已超上限，说明对端在灌一行无限长的东西
          if (pending.length > maxLineBytes) fail(events, 'line-too-long')
          break
        }
        const line = pending.slice(0, idx)
        pending = pending.slice(idx + 2)

        if (line.length > maxLineBytes) {
          fail(events, 'line-too-long')
          break
        }

        if (state === 'line') {
          const parts = line.split(' ')
          if (parts.length !== 3 || !parts[2].startsWith('HTTP/')) {
            fail(events, 'bad-request-line')
            break
          }
          head = { method: parts[0], path: parts[1], version: parts[2], headers: {} }
          state = 'headers'
        } else {
          // state === 'headers'
          if (line === '') {
            // 空行 = 头部结束，请求完整了
            events.push({ type: 'request', head: head as RequestHead })
            head = null
            state = 'line' // 回到起点，等同一个连接上的下一个请求（keep-alive 的地基）
          } else {
            const colon = line.indexOf(':')
            if (colon <= 0) {
              fail(events, 'bad-header')
              break
            }
            const name = line.slice(0, colon).trim().toLowerCase()
            const value = line.slice(colon + 1).trim()
            ;(head as RequestHead).headers[name] = value
          }
        }
      }
      return events
    },
  }
}
