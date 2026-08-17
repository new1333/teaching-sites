import { describe, it, expect } from 'vitest'
import { Bus } from '../src/bus'
import { PPU } from '../src/ppu'
import { makeNromCartridge } from '../src/fixtures'
import { parseINES } from '../src/cartridge'

// 装机：总线 + PPU（可选挂一张卡带决定 nametable 镜像方向）
function makeMachine(mirroring: 'horizontal' | 'vertical' = 'horizontal'): { bus: Bus; ppu: PPU } {
  const bus = new Bus()
  const ppu = new PPU(mirroring)
  bus.attachPpu(ppu)
  bus.attachCartridge(
    parseINES(makeNromCartridge({ prg: new Array<number>(0x4000).fill(0), chr: new Array<number>(0x2000).fill(0), mirroring }))
  )
  return { bus, ppu }
}

// $2006 两次写入设 PPU 地址的便利函数
function setPpuAddr(bus: Bus, addr: number): void {
  bus.write(0x2006, (addr >> 8) & 0xff)
  bus.write(0x2006, addr & 0xff)
}

describe('寄存器窗口：$2000-$2007', () => {
  it('$2006 两步拼地址 + $2007 读写数据', () => {
    const { bus } = makeMachine()
    setPpuAddr(bus, 0x2000) // nametable 0 首格
    bus.write(0x2007, 0x42)
    setPpuAddr(bus, 0x2000)
    expect(bus.read(0x2007)).toBe(0x42)
  })

  it('$2007 自增：默认 +1，PPUCTRL bit2 置 1 后 +32', () => {
    const { bus } = makeMachine()
    setPpuAddr(bus, 0x2000)
    bus.write(0x2007, 0x11)
    bus.write(0x2007, 0x22) // 写完 v 已 +1 → 写进 $2001
    setPpuAddr(bus, 0x2000)
    expect(bus.read(0x2007)).toBe(0x11)
    expect(bus.read(0x2007)).toBe(0x22)

    bus.write(0x2000, 0x04) // bit2 = 1：自增 32
    setPpuAddr(bus, 0x2000)
    bus.write(0x2007, 0x33) // 写进 $2000
    bus.write(0x2007, 0x44) // +32 → $2020
    setPpuAddr(bus, 0x2020)
    expect(bus.read(0x2007)).toBe(0x44)
  })

  it('读 $2002 返回 VBlank 位，且读一次即清', () => {
    const { bus, ppu } = makeMachine()
    ppu.vblank = true
    expect(bus.read(0x2002) & 0x80).toBe(0x80)
    expect(bus.read(0x2002) & 0x80).toBe(0x00) // 已清
  })

  it('$2000-$3FFF 每 8 个门牌镜像一次：写 $3FF0 等于写 $2000', () => {
    const { bus, ppu } = makeMachine()
    bus.write(0x3ff0, 0x89) // & 7 = 0 → PPUCTRL
    expect(ppu.ctrl).toBe(0x89)
  })

  it('OAM：$2003 设指针，$2004 读写并自增', () => {
    const { bus } = makeMachine()
    bus.write(0x2003, 0x10)
    bus.write(0x2004, 0xab)
    bus.write(0x2004, 0xcd) // 第二个写进 oam[0x11]
    bus.write(0x2003, 0x10)
    expect(bus.read(0x2004)).toBe(0xab)
    expect(bus.read(0x2004)).toBe(0xcd)
  })
})

describe('调色板 RAM', () => {
  it('$3F00-$3F1F 独立读写，不经 nametable 镜像', () => {
    const { bus } = makeMachine()
    setPpuAddr(bus, 0x3f00)
    bus.write(0x2007, 0x21)
    setPpuAddr(bus, 0x3f01)
    bus.write(0x2007, 0x16)
    setPpuAddr(bus, 0x3f00)
    expect(bus.read(0x2007)).toBe(0x21)
    setPpuAddr(bus, 0x3f01)
    expect(bus.read(0x2007)).toBe(0x16)
  })

  it('背景调色板镜像：写 $3F10 读 $3F00（$10/$14/$18/$1C 是背景色分身）', () => {
    const { bus } = makeMachine()
    setPpuAddr(bus, 0x3f10)
    bus.write(0x2007, 0x33)
    setPpuAddr(bus, 0x3f00)
    expect(bus.read(0x2007)).toBe(0x33)
  })
})

describe('nametable 镜像', () => {
  it('horizontal：写 $2000 在 $2400 可见（同一块）', () => {
    const { bus } = makeMachine('horizontal')
    setPpuAddr(bus, 0x2000)
    bus.write(0x2007, 0x77)
    setPpuAddr(bus, 0x2400)
    expect(bus.read(0x2007)).toBe(0x77)
  })

  it('vertical：写 $2000 在 $2800 可见；$2400 是另一块', () => {
    const { bus } = makeMachine('vertical')
    setPpuAddr(bus, 0x2000)
    bus.write(0x2007, 0x77)
    setPpuAddr(bus, 0x2800)
    expect(bus.read(0x2007)).toBe(0x77)
    setPpuAddr(bus, 0x2400)
    expect(bus.read(0x2007)).toBe(0x00) // 另一块，未写过
  })
})

describe('OAM DMA', () => {
  it('写 $4014：从指定页搬 256 字节进 OAM', () => {
    const { bus, ppu } = makeMachine()
    for (let i = 0; i < 256; i++) bus.write(0x0200 + i, i) // $02 页
    bus.write(0x2003, 0x00)
    bus.write(0x4014, 0x02) // DMA 源页 = $02
    expect(ppu.oam[0]).toBe(0x00)
    expect(ppu.oam[1]).toBe(0x01)
    expect(ppu.oam[0xff]).toBe(0xff)
  })
})
