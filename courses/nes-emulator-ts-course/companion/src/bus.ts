// 64KB 门牌街：CPU 的一切读写从这里分发到 RAM、PPU/APU 窗口或卡带。

import type { Cartridge } from './cartridge'
import type { PPU } from './ppu'
import type { APU } from './apu'
import type { Controller } from './controller'

export class Bus {
  readonly ram = new Uint8Array(0x800) // 主机只有 2KB 内存
  private cartridge: Cartridge | null = null
  private ppu: PPU | null = null
  private apu: APU | null = null
  private controller: Controller | null = null

  attachCartridge(cart: Cartridge): void {
    this.cartridge = cart
  }

  attachPpu(ppu: PPU): void {
    this.ppu = ppu
  }

  attachApu(apu: APU): void {
    this.apu = apu
  }

  attachController(controller: Controller): void {
    this.controller = controller
  }

  read(addr: number): number {
    addr &= 0xffff
    if (addr < 0x2000) {
      // $0000-$1FFF：2KB RAM，高 3 位地址线没接，三段镜像到同一间房
      return this.ram[addr & 0x7ff]
    }
    if (addr < 0x4000) {
      // $2000-$3FFF：PPU 八个寄存器，每 8 个门牌重复一次
      return this.ppu ? this.ppu.readReg(addr & 7) : 0
    }
    if (addr < 0x4020) {
      // $4000-$4013：APU；$4016：手柄；$4017：第二手柄（不接）
      if (addr === 0x4016) return this.controller ? this.controller.read() : 0
      return this.apu ? this.apu.readReg(addr) : 0
    }
    if (addr < 0x8000) {
      // $4020-$7FFF：卡带扩展区，NROM 不用
      return 0
    }
    // $8000-$FFFF：PRG。NROM-128（16KB）靠地址掩码自然镜像到 $C000 段
    if (this.cartridge) {
      return this.cartridge.prgRom[addr & (this.cartridge.prgRom.length - 1)]
    }
    return 0 // 没插卡带
  }

  write(addr: number, val: number): void {
    addr &= 0xffff
    val &= 0xff
    if (addr < 0x2000) {
      this.ram[addr & 0x7ff] = val
      return
    }
    if (addr < 0x4000) {
      this.ppu?.writeReg(addr & 7, val)
      return
    }
    if (addr === 0x4014 && this.ppu) {
      // OAM DMA：把 CPU 内存整页 256 字节灌进 OAM
      const page = val << 8
      this.ppu.oamDma(i => this.read(page + i))
      return
    }
    if (addr === 0x4016) {
      this.controller?.write(val) // 手柄 strobe
      return
    }
    if (addr < 0x4020) {
      this.apu?.writeReg(addr, val)
      return
    }
    // 其余地址段：设备未接通前统一丢弃（开放总线约定）
  }
}
