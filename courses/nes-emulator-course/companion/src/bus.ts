// CPU 侧总线:把 16 位地址路由到 RAM / PPU / IO / 卡带窗口。
// 镜像规则是硬件布线的事实:RAM 2K 镜像到 $0000-$1FFF,PPU 寄存器每 8 字节镜像到 $2000-$3FFF。

import type { Ppu } from './ppu.js'

export class Bus {
  ram = new Uint8Array(0x800) // 机器内部 RAM,只有 2KB
  /** 卡带窗口($4020-$FFFF)第 11 章接上;未接时读 0 */
  cartRead: (addr: number) => number = () => 0
  cartWrite: (addr: number, val: number) => void = () => {}
  /** 手柄($4016/$4017)第 10 章接上 */
  ioRead: (addr: number) => number = () => 0
  ioWrite: (addr: number, val: number) => void = () => {}

  constructor(readonly ppu: Ppu) {}

  /** $4014 挂起的 DMA 源页(整机主循环在指令间隙执行,计 513/514 CPU 周期) */
  private dmaPage = 0
  private dmaPending = false

  read(addr: number): number {
    if (addr < 0x2000) return this.ram[addr & 0x07ff] // RAM 镜像
    if (addr < 0x4000) return this.ppu.cpuRead(addr & 7) // PPU 寄存器镜像
    if (addr < 0x4020) return this.ioRead(addr) // APU/手柄
    return this.cartRead(addr) // 卡带窗口
  }

  write(addr: number, val: number): void {
    if (addr < 0x2000) {
      this.ram[addr & 0x07ff] = val
    } else if (addr < 0x4000) {
      this.ppu.cpuWrite(addr & 7, val)
    } else if (addr < 0x4020) {
      if (addr === 0x4014) {
        this.dmaPage = val & 0xff
        this.dmaPending = true
      }
      this.ioWrite(addr, val)
    } else {
      this.cartWrite(addr, val)
    }
  }

  /** 执行挂起的 OAM DMA:整页 256 字节搬进 OAM(从当前 OAMADDR 起写) */
  runPendingDma(): boolean {
    if (!this.dmaPending) return false
    this.dmaPending = false
    for (let i = 0; i < 256; i++) {
      this.ppu.oamWrite(this.read((this.dmaPage << 8) | i))
    }
    return true
  }
}
