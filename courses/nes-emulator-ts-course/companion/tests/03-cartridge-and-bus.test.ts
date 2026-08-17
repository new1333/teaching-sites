import { describe, it, expect } from 'vitest'
import { parseINES } from '../src/cartridge'
import { Bus } from '../src/bus'
import { makeNromCartridge } from '../src/fixtures'

// 一张 16KB PRG + 8KB CHR 的最小 NROM 卡带（内容全 0，只测结构）
const prg16k = () => new Array<number>(0x4000).fill(0)
const chr8k = () => new Array<number>(0x2000).fill(0)

describe('parseINES：卡带解析', () => {
  it('解析出 PRG/CHR 尺寸、mapper 0 与垂直镜像', () => {
    const bytes = makeNromCartridge({ prg: prg16k(), chr: chr8k(), mirroring: 'vertical' })
    const cart = parseINES(bytes)
    expect(cart.prgRom.length).toBe(0x4000)
    expect(cart.chrRom.length).toBe(0x2000)
    expect(cart.mapper).toBe(0)
    expect(cart.mirroring).toBe('vertical')
  })

  it('flags6 第 0 位为 0 时解析为水平镜像', () => {
    const bytes = makeNromCartridge({ prg: prg16k(), chr: chr8k(), mirroring: 'horizontal' })
    expect(parseINES(bytes).mirroring).toBe('horizontal')
  })

  it('PRG 内容原样进卡带：首字节与复位向量位置可读', () => {
    const prg = prg16k()
    prg[0] = 0xa9 // 卡带在 $8000 的第一个字节
    prg[0x3ffc] = 0x00 // $FFFC 低字节（16KB PRG 的 $C000 段镜像到末尾）
    prg[0x3ffd] = 0x80 // $FFFD 高字节
    const cart = parseINES(makeNromCartridge({ prg, chr: chr8k() }))
    expect(cart.prgRom[0]).toBe(0xa9)
    expect(cart.prgRom[0x3ffc]).toBe(0x00)
    expect(cart.prgRom[0x3ffd]).toBe(0x80)
  })

  it('文件头不是 NES\\x1a 时抛错', () => {
    const bad = makeNromCartridge({ prg: prg16k(), chr: chr8k() })
    bad[0] = 0x00
    expect(() => parseINES(bad)).toThrow()
  })
})

describe('Bus：64KB 门牌街', () => {
  it('内部 RAM：写 $0000 读 $0000 一致', () => {
    const bus = new Bus()
    bus.write(0x0000, 0xab)
    expect(bus.read(0x0000)).toBe(0xab)
  })

  it('RAM 三段镜像：$0800/$1000/$1800 与 $0000 是同一间房', () => {
    const bus = new Bus()
    bus.write(0x0005, 0x11)
    expect(bus.read(0x0805)).toBe(0x11)
    expect(bus.read(0x1005)).toBe(0x11)
    expect(bus.read(0x1805)).toBe(0x11)
    bus.write(0x17ff, 0x22) // 写镜像段，原段同步变化
    expect(bus.read(0x07ff)).toBe(0x22)
  })

  it('接上卡带后 $8000 读到 PRG 首字节；未接时是开放总线 0', () => {
    const bus = new Bus()
    expect(bus.read(0x8000)).toBe(0) // 未插卡带：开放总线
    const prg = prg16k()
    prg[0] = 0x4c
    bus.attachCartridge(parseINES(makeNromCartridge({ prg, chr: chr8k() })))
    expect(bus.read(0x8000)).toBe(0x4c)
  })

  it('16KB PRG 在 $C000 段镜像：read($C000) === read($8000)', () => {
    const prg = prg16k()
    prg[0] = 0x60
    const bus = new Bus()
    bus.attachCartridge(parseINES(makeNromCartridge({ prg, chr: chr8k() })))
    expect(bus.read(0xc000)).toBe(0x60)
    expect(bus.read(0xfff0)).toBe(prg[0x3ff0]) // $FFF0 对应 PRG 末区
  })

  it('未映射区间读为 0、写不抛错（开放总线约定）', () => {
    const bus = new Bus()
    expect(bus.read(0x5000)).toBe(0)
    expect(() => bus.write(0x5000, 0xff)).not.toThrow()
  })

  it('$2000-$3FFF 与 $4000-$401F 暂按开放总线处理（后续章接通）', () => {
    const bus = new Bus()
    expect(bus.read(0x2002)).toBe(0)
    expect(() => bus.write(0x4014, 0x00)).not.toThrow()
  })
})
