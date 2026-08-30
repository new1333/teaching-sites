// src/crypto.ts —— 第二跳的锁：盐 + HKDF 子密钥 + 长度前缀 AEAD 块
// 一条方向的线上语言：
//   [盐 32 字节][密文块][密文块]……
//   每块 = [加密的 2 字节长度][长度火漆 16][加密的载荷][载荷火漆 16]——长度与载荷各封一次，各带一条火漆
// 教学实现，对照 Shadowsocks AEAD 公开规范（shadowsocks.org）的概念对表，差异登记差异清单附录
import net from 'node:net'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { Duplex } from 'node:stream'

export const SALT_LEN = 32 // 盐长：与规范对 aes-256-gcm 的取值相同（32 字节）
export const CHUNK_MAX = 0x3fff // 一块载荷的上限，与第 4 章帧上限同数：高两位置零，长度先验拒收
const TAG_LEN = 16 // GCM 火漆：16 字节
const NONCE_LEN = 12 // GCM 的 nonce 惯例：12 字节（96 位）
const SUBKEY_INFO = 'mini-clash/aead' // HKDF 的 info 串：把派生结果绑在本课这条链路的用途上

// —— 子密钥：每条连接现配一把 ——

// 盐 + HKDF 派生本连接的子密钥（HKDF = RFC 5869 的「提取-扩展」两步，node:crypto 一函数包办）。
// 为什么每连接要新盐新钥：块的 nonce 计数器每条连接从 0 重启，钥匙若不换，
// 第二条连接的第 0 块就与第一条撞在同一把钥匙 + 同一个计数上——第 5 章的异或灾难原样重演。
// 盐公开上路（对方没有它派生不出同一把钥匙），从头到尾保密的只有密码
export function deriveSubkey(password: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(password, 'utf8'), salt, SUBKEY_INFO, 32))
}

// —— 一次 AEAD 封缄 / 拆封（node:crypto 最小用法）——

// 第 opCounter 次 AEAD 操作的 nonce：12 字节，计数按小端落在低位（高位恒 0，块数远用不满 96 位）
function chunkNonce(opCounter: number): Buffer {
  const n = Buffer.alloc(NONCE_LEN)
  n.writeUInt32LE(opCounter, 0)
  return n
}

// 封：明文进，密文 + 火漆出（火漆殿后随行）
function aesSeal(key: Buffer, opCounter: number, plain: Buffer): Buffer {
  const c = createCipheriv('aes-256-gcm', key, chunkNonce(opCounter))
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()])
}

// 拆：先递上随行的火漆，final 验漆——漆对不上就抛错，整段作废
function aesOpen(key: Buffer, opCounter: number, wire: Buffer): Buffer {
  if (wire.length < TAG_LEN) throw new Error('密文段太短：连火漆都不齐')
  const d = createDecipheriv('aes-256-gcm', key, chunkNonce(opCounter))
  d.setAuthTag(wire.subarray(wire.length - TAG_LEN))
  return Buffer.concat([d.update(wire.subarray(0, wire.length - TAG_LEN)), d.final()])
}

// —— 块编解码：第 4 章的「长度前缀帧」整根封进 AEAD —— 

// 封第 index 块（从 0 数）：长度段、载荷段各一次 AEAD，计数各占一位——nonce 与位置就此绑定
export function sealChunk(key: Buffer, index: number, payload: Buffer): Buffer {
  if (payload.length === 0 || payload.length > CHUNK_MAX) throw new Error(`块长越界：${payload.length}（合法范围 1..${CHUNK_MAX}）`)
  const len = Buffer.alloc(2)
  len.writeUInt16BE(payload.length, 0)
  return Buffer.concat([aesSeal(key, 2 * index, len), aesSeal(key, 2 * index + 1, payload)])
}

// 开第 index 块：wire = [加密长度 2+16][加密载荷 len+16]。长度段先拆——边界自己也是密文，中间人数不出块来
export function openChunk(key: Buffer, index: number, wire: Buffer): Buffer {
  const len = aesOpen(key, 2 * index, wire.subarray(0, 2 + TAG_LEN)).readUInt16BE(0)
  if (len === 0 || len > CHUNK_MAX) throw new Error(`块长越界：${len}（合法范围 1..${CHUNK_MAX}）`)
  if (wire.length !== 2 + TAG_LEN + len + TAG_LEN) throw new Error('块长对不上：多一字节少一字节都不认')
  return aesOpen(key, 2 * index + 1, wire.subarray(2 + TAG_LEN))
}

// —— 流式拆封器：一条连接一个方向一个 ——

// 字节喂进来，凑齐一块拆一块。块号每拆完一块进一——拆封计数与封缄计数隔着网络各数各的，全靠位置对齐
function createChunkOpener(key: Buffer): { push(chunk: Buffer): Buffer[] } {
  let buffered = Buffer.alloc(0)
  let index = 0 // 已拆到第几块：下一块的 nonce 计数就从这里起
  return {
    push(chunk: Buffer): Buffer[] {
      buffered = Buffer.concat([buffered, chunk])
      const out: Buffer[] = []
      for (;;) {
        if (buffered.length < 2 + TAG_LEN) return out // 加密长度段还没到齐
        const len = aesOpen(key, 2 * index, buffered.subarray(0, 2 + TAG_LEN)).readUInt16BE(0) // 长度段也是密文
        if (len === 0 || len > CHUNK_MAX) throw new Error(`块长越界：${len}（合法范围 1..${CHUNK_MAX}）`)
        const total = 2 + TAG_LEN + len + TAG_LEN
        if (buffered.length < total) return out // 载荷还没到齐
        out.push(aesOpen(key, 2 * index + 1, buffered.subarray(2 + TAG_LEN, 2 + TAG_LEN + len + TAG_LEN))) // 载荷段连火漆一起切
        buffered = buffered.subarray(total)
        index += 1
      }
    },
  }
}

// —— 加密管道 —— 

// 封缄侧：首次封块时现摇盐、先发盐，此后逐块计数进位；超上限的明文先切开再封
function createChunkSealer(write: (b: Buffer) => void, password: string) {
  let key: Buffer | null = null // 惰性：写第一笔数据之前，盐与钥匙都还不存在
  let index = 0
  return {
    seal(plaintext: Buffer) {
      if (key === null) {
        const salt = randomBytes(SALT_LEN) // 「每连接新盐」的落点：摇盐在首写，不在建连——不写数据的方向不发盐
        write(salt)
        key = deriveSubkey(password, salt)
      }
      for (let i = 0; i < plaintext.length; i += CHUNK_MAX) write(sealChunk(key, index++, plaintext.subarray(i, i + CHUNK_MAX)))
    },
  }
}

// 拆封侧：先攒够盐、派生同一把子密钥，再交给块拆封器
function createSaltReader(password: string, onPlain: (b: Buffer) => void) {
  let opener: ReturnType<typeof createChunkOpener> | null = null
  let saltBuf = Buffer.alloc(0)
  return {
    push(chunk: Buffer) {
      let rest = chunk
      if (opener === null) {
        saltBuf = Buffer.concat([saltBuf, chunk])
        if (saltBuf.length < SALT_LEN) return // 盐还没攒齐
        opener = createChunkOpener(deriveSubkey(password, saltBuf.subarray(0, SALT_LEN)))
        rest = saltBuf.subarray(SALT_LEN) // 盐后可能粘着首块
      }
      for (const plain of opener.push(rest)) onPlain(plain)
    },
  }
}

// 加密管道：外侧读写明文字节（第 4 章的整套帧协议原样骑在上面），内侧（socket）跑「盐 + 密文块」。
// 两个方向各自独立：各摇各的盐、各数各的块——发盐的是发送方，拆盐的是接收方
export function aeadPipe(socket: net.Socket, password: string): Duplex {
  const sealer = createChunkSealer((b) => socket.write(b), password)
  const outer = new Duplex({
    read(_size) {
      // 数据是被推着来的（push），读侧不必主动拉——但这个钩子必须存在，缺了流一开工就报错
    },
    write(chunk, _enc, cb) {
      sealer.seal(chunk as Buffer) // 明文进 → 盐（仅首次）+ 密文块 → 内侧
      cb()
    },
  })
  const receiver = createSaltReader(password, (plain) => outer.push(plain))
  socket.on('data', (b) => {
    try {
      receiver.push(b)
    } catch (e) {
      outer.destroy(e as Error) // 验漆失败：管道整体收摊——拒收即断开，不给坏块任何落脚处
    }
  })
  socket.on('close', () => outer.destroy()) // 内侧收线：外侧跟着收
  socket.on('error', (e) => outer.destroy(e))
  outer.on('close', () => socket.destroy()) // 外侧收线：内侧跟着收
  return outer
}
