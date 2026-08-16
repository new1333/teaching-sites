// 整机:CPU + PPU + 总线 + 手柄的时钟同步外壳。
// 推进策略 = 指令级 catch-up:CPU 每条指令的周期数 × 3 = PPU 补走的 dot 数。

import { Cpu } from './cpu.js'
import { Ppu, ChrRam } from './ppu.js'
import { Bus } from './bus.js'
import { Controller, type NesButton } from './controller.js'
import { parseINES, type Mirroring } from './ines.js'

export class Nes {
  readonly ppu: Ppu
  readonly bus: Bus
  readonly cpu: Cpu
  readonly controller = new Controller()

  constructor(mirroring: Mirroring = 'horizontal') {
    this.ppu = new Ppu(mirroring)
    this.bus = new Bus(this.ppu)
    this.cpu = new Cpu(this.bus)
    // $4016/$4017 走手柄;APU 寄存器暂不实现(读 0、写忽略)
    this.bus.ioRead = (a) => (a === 0x4016 || a === 0x4017 ? this.controller.cpuRead(a) : 0)
    this.bus.ioWrite = (a, v) => this.controller.cpuWrite(a, v)
    this.cpu.reset()
  }

  /** 装载 .nes 字节流(NROM):接通卡带窗口与图案存储,然后复位 */
  loadRom(bytes: Uint8Array): void {
    const cart = parseINES(bytes)
    if (cart.mapper !== 0) {
      throw new Error(`Nes.loadRom:暂只支持 NROM(mapper 0),该卡带是 mapper ${cart.mapper}`)
    }
    // NROM:16K PRG 镜像到 $8000/$C000,32K 直通
    const mask = cart.prgRom.length === 0x4000 ? 0x3fff : 0x7fff
    const prg = cart.prgRom
    this.bus.cartRead = (a) => prg[a & mask]
    if (cart.chrRom) {
      const chr = cart.chrRom // CHR-ROM:只读
      this.ppu.chr = { read: (a) => chr[a & 0x1fff], write: () => {} }
    } else {
      this.ppu.chr = new ChrRam() // CHR-RAM:程序自己写图案
    }
    this.ppu.mirroring = cart.mirroring
    if (cart.mirroring === 'fourScreen') this.ppu.vram = new Uint8Array(0x1000)
    this.cpu.reset()
  }

  /** 按键事件入口(player 0/1;键盘、手柄、脚本都汇到这里) */
  setButton(player: 0 | 1, button: NesButton, down: boolean): void {
    this.controller.setButton(player, button, down)
  }

  /** 推进整机直到帧缓冲就绪,返回 256×240×3 的 RGB 帧(复用同一块缓冲) */
  runFrame(): Uint8Array {
    let frameDone = false
    const catchUp = (dots: number) => {
      for (let i = 0; i < dots; i++) {
        if (this.ppu.tick()) frameDone = true
      }
    }
    while (!frameDone) {
      catchUp(this.cpu.step() * 3) // CPU 1 周期 = PPU 3 dot
      if (this.bus.runPendingDma()) {
        catchUp(513 * 3) // OAM DMA 偷走 513 个 CPU 周期
      }
      if (this.ppu.takeNmi()) this.cpu.nmi()
    }
    return this.ppu.frameBuffer
  }
}
