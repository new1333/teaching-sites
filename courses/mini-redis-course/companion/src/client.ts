// 最小 RESP 客户端（测试与读者玩具）：cmd 一问一答；pipe 一口气发一批、一次收回全部应答。
// 应答侧同样要认边界——这里把解码器反着用一遍：按帧走位，不完整就等。
import net from 'node:net'
import { encodeCommand } from './resp.ts'

type Span = { text: string; end: number } | null

export interface MiniRedisClient {
  cmd: (...args: string[]) => Promise<string>
  pipe: (...batch: string[][]) => Promise<string[]>
  close: () => Promise<void>
}

export function connect(port: number, host = '127.0.0.1'): Promise<MiniRedisClient> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host)
    let buf = ''
    const waiters: { resolve: (reply: string) => void; reject: (err: Error) => void }[] = []

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      for (;;) {
        const end = parseFrame(0)?.end
        if (end === undefined) break // 应答也可能半包：等到齐才交
        const reply = buf.slice(0, end)
        buf = buf.slice(end)
        const waiter = waiters.shift()
        if (reply.startsWith('-')) waiter?.reject(new Error(reply))
        else waiter?.resolve(reply)
      }
    })
    socket.on('error', (err) => {
      while (waiters.length) waiters.shift()!.reject(err)
      reject(err)
    })

    socket.on('connect', () => {
      resolve({
        cmd: (...args) =>
          new Promise<string>((res, rej) => {
            waiters.push({ resolve: res, reject: rej })
            socket.write(encodeCommand(args))
          }),
        pipe: (...batch) => {
          // 管道：N 条命令一次 write 全发出去，N 条应答按序到齐才 resolve——
          // 复用同一套 waiters，应答帧的泵（上面的 data 处理器）不用动
          const replies = batch.map(
            (args) =>
              new Promise<string>((res, rej) => {
                waiters.push({ resolve: res, reject: rej })
              }),
          )
          socket.write(batch.map(encodeCommand).join(''))
          return Promise.all(replies)
        },
        close: () =>
          new Promise<void>((done) => {
            socket.on('close', () => done())
            socket.end()
          }),
      })
    })

    // 从 pos 起解析一条完整应答帧，返回「原始字节切片 + 结束下标」；不完整返回 null。
    // + - : 是一行一帧；$ 还带 n 字节数据；* 套 n 个子帧。
    function parseFrame(pos: number): { end: number } | null {
      const line = lineAt(pos)
      if (line === null) return null
      const kind = line.text[0]
      const body = line.text.slice(1)
      pos = line.end
      if (kind === '+' || kind === '-' || kind === ':') {
        return { end: pos }
      }
      if (kind === '$') {
        const n = Number(body)
        if (!Number.isInteger(n)) return null
        if (n === -1) return { end: pos } // $-1：空值，没有数据段
        const data = bytesAt(pos, n)
        if (data === null) return null
        if (!(buf[data.end] === '\r' && buf[data.end + 1] === '\n')) return null // 尾部 \r\n 未到齐
        return { end: data.end + 2 }
      }
      if (kind === '*') {
        const n = Number(body)
        if (!Number.isInteger(n) || n === -1) return { end: pos } // *-1 是 null 数组（表「无」，空数组为 *0）：无数据段
        for (let i = 0; i < n; i++) {
          const sub = parseFrame(pos)
          if (sub === null) return null
          pos = sub.end
        }
        return { end: pos }
      }
      return null
    }
    function lineAt(pos: number): Span {
      const idx = buf.indexOf('\r\n', pos)
      if (idx === -1) return null
      return { text: buf.slice(pos, idx), end: idx + 2 }
    }
    // 与 RespDecoder.bytesAt 同一道理：长度前缀按字节数计，字符下标要折算
    function bytesAt(pos: number, n: number): Span {
      let bytes = 0
      for (let i = pos; i < buf.length; i++) {
        if (bytes >= n) return { text: buf.slice(pos, i), end: i }
        const c = buf.charCodeAt(i)
        bytes += c < 0x80 ? 1 : c < 0x800 || (c >= 0xd800 && c <= 0xdfff) ? 2 : 3
      }
      return bytes >= n ? { text: buf.slice(pos), end: buf.length } : null
    }
  })
}
