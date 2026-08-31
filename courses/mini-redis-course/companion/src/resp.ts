// RESP2 编解码：类型标记（+ - : $ *）+ \r\n 行终止 + 前缀长度。
// 服务端用它编码应答，解码器吃下客户端发来的命令（批量串数组）。
const CRLF = '\r\n'

// ---- 应答编码：一个函数对应一种 RESP 类型 ----

export function encodeSimpleString(s: string): string {
  // 简单串不能含 \r 和 \n——要装任意内容请用批量串
  return `+${s}${CRLF}`
}

export function encodeError(message: string): string {
  return `-${message}${CRLF}`
}

export function encodeInteger(n: number): string {
  return `:${n}${CRLF}`
}

export function encodeBulkString(s: string): string {
  // 长度前缀按 UTF-8 字节数计：'你好' 是 2 个字符、6 个字节
  return `$${Buffer.byteLength(s, 'utf8')}${CRLF}${s}${CRLF}`
}

export function encodeNullBulkString(): string {
  // RESP2 没有专门的空值类型：缺失的键用长度 -1 的批量串表示
  return `$-1${CRLF}`
}

export function encodeArrayOfStrings(items: string[]): string {
  return `*${items.length}${CRLF}` + items.map((it) => encodeBulkString(it)).join('')
}

// ---- 命令编码：客户端方向——命令一律编码成「批量串数组」 ----

export function encodeCommand(args: string[]): string {
  return encodeArrayOfStrings(args)
}

// ---- 命令解码：带缓冲、逐段喂 ----

type Span = { text: string; end: number } | null

export class RespDecoder {
  // 每个连接一份缓冲：TCP 不保证命令按发送切段到达，没到齐的先攒着
  private buf = ''

  feed(chunk: string): string[][] {
    this.buf += chunk
    const commands: string[][] = []
    for (;;) {
      const cmd = this.tryParseCommand()
      if (cmd === null) break // 不完整（半包）：留着等下一段，绝不猜
      commands.push(cmd)
    }
    return commands
  }

  // 尝试从缓冲头部解析一条完整命令；任何一处不完整就返回 null 且不消费缓冲。
  // 用下标 pos 走位而不是边走边切，天然做到「没到齐就当没来过」。
  private tryParseCommand(): string[] | null {
    let pos = 0
    const header = this.lineAt(pos)
    if (header === null) return null
    if (!/^\*\d+$/.test(header.text)) {
      throw new Error(`protocol error: 期望 '*' 开头的命令数组，收到 '${this.buf[0]}'`)
    }
    pos = header.end
    const count = Number(header.text.slice(1))
    const args: string[] = []
    for (let i = 0; i < count; i++) {
      const lenLine = this.lineAt(pos)
      if (lenLine === null) return null
      if (!/^\$\d+$/.test(lenLine.text)) {
        throw new Error(`protocol error: 期望 '$' 开头的批量串，收到 '${this.buf[pos]}'`)
      }
      pos = lenLine.end
      const data = this.bytesAt(pos, Number(lenLine.text.slice(1)))
      if (data === null) return null
      args.push(data.text)
      pos = data.end
      if (!this.crlfAt(pos)) return null
      pos += 2 // 跳过数据尾部的 \r\n
    }
    this.buf = this.buf.slice(pos) // 整条到齐，才真正消费缓冲
    return args
  }

  // 从 pos 起读到 \r\n；没等到 \r\n 返回 null（半包）
  private lineAt(pos: number): Span {
    const idx = this.buf.indexOf('\r\n', pos)
    if (idx === -1) return null
    return { text: this.buf.slice(pos, idx), end: idx + 2 }
  }

  // 从 pos 起按「UTF-8 字节数」取数据：长度前缀说的是字节数，
  // 而字符串下标按字符走——'你好' 占 2 个下标但算 6 个字节，必须逐字符折算。
  private bytesAt(pos: number, n: number): Span {
    let bytes = 0
    for (let i = pos; i < this.buf.length; i++) {
      if (bytes >= n) return { text: this.buf.slice(pos, i), end: i }
      const c = this.buf.charCodeAt(i)
      // ASCII 一字节；两字节区（含代理项的一半，高低代理合成四字节）两字节；其余三字节
      bytes += c < 0x80 ? 1 : c < 0x800 || (c >= 0xd800 && c <= 0xdfff) ? 2 : 3
    }
    return bytes >= n ? { text: this.buf.slice(pos), end: this.buf.length } : null
  }

  private crlfAt(pos: number): boolean {
    return this.buf[pos] === '\r' && this.buf[pos + 1] === '\n'
  }
}
