import { describe, it, expect } from 'vitest'
import { Bus } from '../src/bus.js'
import { Ppu } from '../src/ppu.js'

function makeMachine(mirroring: 'horizontal' | 'vertical' = 'horizontal') {
  const ppu = new Ppu(mirroring)
  const bus = new Bus(ppu)
  return { ppu, bus }
}

describe('Bus:CPU 侧地址路由与镜像', () => {
  it('RAM 2KB 镜像到 $0000-$1FFF 全段', () => {
    const { bus } = makeMachine()
    bus.write(0x0000, 0x11)
    bus.write(0x07ff, 0x22)
    expect(bus.read(0x0800)).toBe(0x11)
    expect(bus.read(0x1800)).toBe(0x11)
    expect(bus.read(0x0fff)).toBe(0x22)
    expect(bus.read(0x1fff)).toBe(0x22)
  })

  it('PPU 寄存器每 8 字节镜像:写 $2008 落到 PPUCTRL($2000)', () => {
    const { ppu, bus } = makeMachine()
    bus.write(0x2008, 0x80)
    expect(ppu.ctrl).toBe(0x80)
    // $3FF8 也是 $2000 的镜像
    bus.write(0x3ff8, 0x21)
    expect(ppu.ctrl).toBe(0x21)
  })

  it('读 $2002 也可以走镜像地址', () => {
    const { ppu, bus } = makeMachine()
    ppu.vblank = 1
    expect(bus.read(0x2002) & 0x80).toBe(0x80)
    ppu.vblank = 1
    expect(bus.read(0x2ff2) & 0x80).toBe(0x80) // $2FF2 → $2002
  })
})

describe('PPUSTATUS($2002)读副作用', () => {
  it('读一次返回 vblank 位并清零;低 5 位是上次写入的残影', () => {
    const { ppu, bus } = makeMachine()
    bus.write(0x2001, 0x1f) // 先写过 PPUMASK,残影字节是 $1F
    ppu.vblank = 1
    const v = bus.read(0x2002)
    expect(v & 0x80).toBe(0x80)
    expect(v & 0x1f).toBe(0x1f)
    expect(ppu.vblank).toBe(0) // 读清
    expect(bus.read(0x2002) & 0x80).toBe(0)
  })

  it('读 STATUS 会复位 $2006/$2005 的写指针 w(下次再当高位写)', () => {
    const { ppu, bus } = makeMachine()
    bus.write(0x2006, 0x21) // 第一次:高位写
    bus.read(0x2002) // 副作用:w=0
    bus.write(0x2006, 0x22) // 又被当成高位写
    bus.write(0x2006, 0x34) // 低位写
    expect(ppu.v).toBe(0x2234)
  })
})

describe('PPUADDR($2006)/PPUDATA($2007):CPU 侧写显存', () => {
  it('两次写 $2006 拼出 14 位地址,$2007 写入命名表 0', () => {
    const { ppu, bus } = makeMachine()
    bus.write(0x2006, 0x20)
    bus.write(0x2006, 0x00)
    bus.write(0x2007, 0x65)
    bus.write(0x2007, 0x66)
    expect(ppu.vram[0]).toBe(0x65)
    expect(ppu.vram[1]).toBe(0x66)
    expect(ppu.v).toBe(0x2002) // 写两次,地址 +2
  })

  it('垂直镜像:$2400 是第二块物理命名表,$2800 折回第一块', () => {
    const { ppu, bus } = makeMachine('vertical')
    bus.write(0x2006, 0x24)
    bus.write(0x2006, 0x05)
    bus.write(0x2007, 0xaa)
    expect(ppu.vram[0x405]).toBe(0xaa)

    bus.write(0x2006, 0x28)
    bus.write(0x2006, 0x05)
    bus.write(0x2007, 0xbb)
    expect(ppu.vram[0x005]).toBe(0xbb) // table2 → table0
  })

  it('水平镜像:$2400 折回第一块,$2800 是第二块', () => {
    const { ppu, bus } = makeMachine('horizontal')
    bus.write(0x2006, 0x24)
    bus.write(0x2006, 0x05)
    bus.write(0x2007, 0xaa)
    expect(ppu.vram[0x005]).toBe(0xaa) // table1 → table0

    bus.write(0x2006, 0x28)
    bus.write(0x2006, 0x05)
    bus.write(0x2007, 0xbb)
    expect(ppu.vram[0x405]).toBe(0xbb) // table2 → table1 物理
  })

  it('PPUCTRL bit2 置位时 $2007 步进 32', () => {
    const { ppu, bus } = makeMachine()
    bus.write(0x2000, 0x04)
    bus.write(0x2006, 0x20)
    bus.write(0x2006, 0x00)
    bus.write(0x2007, 0x01)
    expect(ppu.v).toBe(0x2020)
  })

  it('$2007 读有一拍缓冲:第一次读到旧缓冲,第二次才读到新数据', () => {
    const { ppu, bus } = makeMachine()
    // 直接经 PPU 侧总线放数据(绕开缓冲,模拟「显存里本来就有」)
    ppu.ppuWrite(0x2000, 0x99)
    bus.write(0x2006, 0x20)
    bus.write(0x2006, 0x00)
    expect(bus.read(0x2007)).toBe(0x00) // 第一次:返回旧缓冲,同时把 $2000 的内容装进缓冲
    expect(bus.read(0x2007)).toBe(0x99) // 第二次:吐出上一拍装的 $2000 内容
  })
})

describe('调色板 RAM($3F00 段)与镜像', () => {
  it('$3F10 写入落到 $3F00(背景透明色槽位)', () => {
    const { ppu, bus } = makeMachine()
    bus.write(0x2006, 0x3f)
    bus.write(0x2006, 0x10)
    bus.write(0x2007, 0x21)
    expect(ppu.palette[0]).toBe(0x21)
  })

  it('调色板读不走缓冲,直接返回', () => {
    const { ppu, bus } = makeMachine()
    bus.write(0x2006, 0x3f)
    bus.write(0x2006, 0x01)
    bus.write(0x2007, 0x0f)
    bus.write(0x2006, 0x3f)
    bus.write(0x2006, 0x01)
    expect(bus.read(0x2007)).toBe(0x0f)
  })
})

describe('PPUSCROLL($2005)与 Loopy 寄存器', () => {
  it('两次写 $2005 分解出 fine-X / 粗X / fine-Y / 粗Y', () => {
    const { ppu, bus } = makeMachine()
    bus.write(0x2005, 0xff) // fine-X=7,coarse-X=31
    bus.write(0x2005, 0x1b) // fine-Y=3,coarse-Y=3
    // t = fineY(3)<<12 | coarseY(3)<<5 | coarseX(31)
    expect(ppu.t).toBe((3 << 12) | (3 << 5) | 31)
    expect(ppu.x).toBe(7)
  })

  it('PPUCTRL 的基命名表位写入 t 的 bit10-11', () => {
    const { ppu, bus } = makeMachine()
    bus.write(0x2000, 0x03) // 选命名表 3
    expect(ppu.t & 0x0c00).toBe(0x0c00)
  })
})
