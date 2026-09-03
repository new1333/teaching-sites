// src/pkt.ts · pkt-line:4 位十六进制长度前缀,把一根字节流切成帧
//
// 帧格式的正本是协议文档 [protocol-common](https://git-scm.com/docs/protocol-common);
// [pack-protocol](https://git-scm.com/docs/pack-protocol) 的引用发现就建立在这层格式上。
// 这里对齐的关键口径:
//   - 长度 = 前缀 4 字节 + 载荷,十六进制写满 4 位(小写,文档的 HEXDIG 口径)
//   - 载荷里的换行(若有)计入长度;接收端有就剥、没有不追究
//   - 载荷至多 65516 字节,整帧至多 65520
//   - 前缀 0000 是 flush 帧:无载荷,「这一节完了」的记号,与空帧 0004 是两回事

/** flush 帧的四个字节:长度 0、无载荷;一节清单的收尾记号。 */
export const FLUSH_PKT = Buffer.from('0000', 'ascii')

/** 载荷上限:65516 字节,连同前缀整帧至多 65520(protocol-common 的 MUST NOT)。 */
export const MAX_PAYLOAD = 65516

/** 一帧:要么是带着载荷的数据帧,要么是 flush。 */
export type PktFrame = { kind: 'flush' } | { kind: 'data'; payload: Buffer }

/**
 * 编码一帧:前缀 = 4 + 载荷字节数,写成 4 位小写十六进制。
 * 空载荷(整帧 0004)文档口径是 SHOULD NOT 发,mini-git 干脆拒发——要表达「空」,发 flush。
 * 载荷是字符串时按 utf-8 编码;字节载荷原样通过,0x00 到 0xff 都不转义(8-bit clean)。
 */
export function pktEncode(payload: string | Buffer): Buffer {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8')
  if (body.length === 0) {
    throw new Error('pktEncode:空载荷的帧(0004)文档明说 SHOULD NOT 发——要发空节,发 flush')
  }
  if (body.length > MAX_PAYLOAD) {
    throw new Error(`pktEncode:载荷 ${body.length} 字节,超过上限 ${MAX_PAYLOAD}(整帧 65520)——拆成多帧发`)
  }
  const prefix = (body.length + 4).toString(16).padStart(4, '0') // 65520 = 0xfff0,恰好四位装得下
  return Buffer.concat([Buffer.from(prefix, 'ascii'), body])
}

/**
 * 解码:从 buf 开头尽可能多地取出完整帧;没到齐的尾巴原样留在 rest,等下一个网络分片补上。
 * 编码严发、解码宽收:0004 空帧照解成空载荷;前缀按文档口径用小写编码,解码大小写都认。
 * 坏输入当场报错:前缀不是 4 位十六进制、短过 4(连前缀自身都装不下)、整帧超 65520。
 */
export function pktDecode(buf: Buffer): { frames: PktFrame[]; rest: Buffer } {
  const frames: PktFrame[] = []
  let i = 0
  while (i + 4 <= buf.length) {
    const hex = buf.toString('ascii', i, i + 4)
    if (!/^[0-9a-f]{4}$/i.test(hex)) {
      throw new Error(`pktDecode:第 ${frames.length + 1} 帧的前缀 '${hex}' 不是 4 位十六进制`)
    }
    const len = parseInt(hex, 16)
    if (len === 0) {
      frames.push({ kind: 'flush' })
      i += 4
      continue
    }
    if (len < 4) {
      throw new Error(`pktDecode:前缀 '${hex}' 短过 4,连它自己的长度都装不下——这不是一个帧`)
    }
    if (len > MAX_PAYLOAD + 4) {
      throw new Error(`pktDecode:前缀 '${hex}' 的整帧超过 ${MAX_PAYLOAD + 4},mini-git 不收这种帧`)
    }
    if (i + len > buf.length) {
      break // 整帧(前缀含在内共 len 字节)还没到齐,留给下一个分片
    }
    frames.push({ kind: 'data', payload: buf.subarray(i + 4, i + len) })
    i += len
  }
  return { frames, rest: buf.subarray(i) }
}
