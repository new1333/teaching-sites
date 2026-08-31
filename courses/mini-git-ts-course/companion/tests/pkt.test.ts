// tests/pkt.test.ts
import { describe, expect, it } from 'vitest'
import { FLUSH_PKT, MAX_PAYLOAD, pktDecode, pktEncode } from '../src/pkt.ts'

describe('pktEncode:金样字节(protocol-common 示例表逐条对上)', () => {
  it('"a\\n" 编成 0006a\\n:长度 6 = 前缀 4 + 载荷 2,换行计入长度', () => {
    expect(pktEncode('a\n').toString('ascii')).toBe('0006a\n')
  })

  it('"a" 编成 0005a:没有换行,长度只算 5——换行不是必需,但只要在就算进总长', () => {
    expect(pktEncode('a').toString('ascii')).toBe('0005a')
  })

  it('"foobar\\n" 编成 000bfoobar\\n:4 + 7 = 11 = 十六进制 b,小写', () => {
    expect(pktEncode('foobar\n').toString('ascii')).toBe('000bfoobar\n')
  })

  it('flush 帧就是四个 0,没有载荷:它是「这一节完了」的记号', () => {
    expect(FLUSH_PKT.toString('ascii')).toBe('0000')
    expect(FLUSH_PKT.length).toBe(4)
  })

  it('一条引用行:40 位哈希 + 空格 + refs/heads/main + 换行,总长 61 = 0x3d', () => {
    const line = `${'7'.repeat(40)} refs/heads/main\n`
    expect(pktEncode(line).toString('ascii')).toBe(`003d${line}`)
  })

  it('空载荷拒发(0004):文档口径是 SHOULD NOT,mini-git 干脆报错——要发空节,发 flush', () => {
    expect(() => pktEncode('')).toThrow('0004')
  })

  it('载荷恰好 65516 字节可发(整帧 65520,前缀 fff0);多一字节当场报错——上限口径', () => {
    expect(pktEncode('x'.repeat(MAX_PAYLOAD)).toString('ascii', 0, 4)).toBe('fff0')
    expect(() => pktEncode('x'.repeat(MAX_PAYLOAD + 1))).toThrow('65516')
  })

  it('字节载荷原样通过:0x00、0x0a、0xff 都照发不误——协议要求 8-bit clean', () => {
    const raw = Buffer.from([0x00, 0x0a, 0xff, 0x33])
    const frame = pktEncode(raw)
    expect(frame.subarray(0, 4).toString('ascii')).toBe('0008') // 4 字节载荷,前缀仍写成 4 个字符
    expect(frame.subarray(4).equals(raw)).toBe(true) // 载荷字节一个没动
  })
})

describe('pktDecode:round-trip、分片与坏输入', () => {
  it('编码再解码,载荷一字节不差;0004 解出空数据帧(编码严发、解码宽收)', () => {
    const round = pktDecode(pktEncode('foobar\n'))
    expect(round.frames).toEqual([{ kind: 'data', payload: Buffer.from('foobar\n', 'utf8') }])
    expect(round.rest.length).toBe(0)
    const empty = pktDecode(Buffer.from('0004', 'ascii'))
    expect(empty.frames).toEqual([{ kind: 'data', payload: Buffer.alloc(0) }])
    expect(empty.rest.length).toBe(0)
  })

  it('多帧连排:data、flush、data 依次取出,次序不乱,rest 为空', () => {
    const buf = Buffer.concat([pktEncode('a\n'), FLUSH_PKT, pktEncode('foobar\n')])
    const { frames, rest } = pktDecode(buf)
    expect(frames).toEqual([
      { kind: 'data', payload: Buffer.from('a\n', 'utf8') },
      { kind: 'flush' },
      { kind: 'data', payload: Buffer.from('foobar\n', 'utf8') },
    ])
    expect(rest.length).toBe(0)
  })

  it('网络分片从帧中间剪开:半帧不硬解,原样留在 rest,等下一片补齐再成帧', () => {
    const whole = pktEncode('foobar\n') // 11 字节
    const first = pktDecode(whole.subarray(0, 6))
    expect(first.frames.length).toBe(0)
    expect(first.rest.toString('hex')).toBe(whole.subarray(0, 6).toString('hex'))
    const second = pktDecode(Buffer.concat([first.rest, whole.subarray(6)]))
    expect(second.frames).toEqual([{ kind: 'data', payload: Buffer.from('foobar\n', 'utf8') }])
    expect(second.rest.length).toBe(0)
  })

  it('尾巴不足 4 字节(连前缀都凑不齐)也只留 rest,不报错', () => {
    const { frames, rest } = pktDecode(FLUSH_PKT.subarray(0, 2))
    expect(frames.length).toBe(0)
    expect(rest.toString('ascii')).toBe('00')
  })

  it('坏前缀各报各的错:不是十六进制、短过 4、整帧超 65520', () => {
    expect(() => pktDecode(Buffer.from('zzzz', 'ascii'))).toThrow('十六进制')
    expect(() => pktDecode(Buffer.from('0002ab', 'ascii'))).toThrow('0002')
    expect(() => pktDecode(Buffer.from('ffff', 'ascii'))).toThrow('65520')
  })
})
