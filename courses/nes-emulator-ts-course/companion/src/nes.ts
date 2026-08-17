// NES 整机：卡带 + 总线 + CPU + PPU + APU + 手柄的总装，1:3 主时钟心跳，
// 以及 frame() 一帧接口——课程终点的「第一次开机」。

import { Bus } from './bus'
import { CPU } from './cpu'
import { PPU } from './ppu'
import { APU } from './apu'
import { Controller, type ButtonName } from './controller'
import { parseINES } from './cartridge'

export class NES {
  readonly bus = new Bus()
  readonly ppu: PPU
  readonly apu = new APU()
  readonly controller = new Controller()
  readonly cpu: CPU

  constructor(cartBytes: Uint8Array) {
    const cart = parseINES(cartBytes)
    this.ppu = new PPU(cart.mirroring, cart.chrRom)
    this.bus.attachPpu(this.ppu)
    this.bus.attachApu(this.apu)
    this.bus.attachController(this.controller)
    this.bus.attachCartridge(cart)
    this.cpu = new CPU(this.bus)
    this.ppu.onNmi = () => this.cpu.nmi() // 收工铃接线
    this.cpu.reset()
  }

  // 跑一条 CPU 指令；它花了几拍，PPU 走三倍拍数、APU 走同拍数
  stepInstruction(): void {
    const cycles = this.cpu.step()
    this.apu.tick(cycles)
    for (let i = 0; i < cycles * 3; i++) this.ppu.tick()
  }

  // 从当前帧跑到帧尾（frameCount 前进一格）
  runFrame(): void {
    const start = this.ppu.frameCount
    while (this.ppu.frameCount === start) this.stepInstruction()
  }

  // 一帧接口：注入手柄按键、跑满一帧、交出画面帧缓冲与本帧音频采样
  frame(buttons?: Partial<Record<ButtonName, boolean>>): { frameBuffer: number[]; samples: number[] } {
    if (buttons) {
      for (const [name, pressed] of Object.entries(buttons)) {
        this.controller.setButton(name as ButtonName, pressed === true)
      }
    }
    this.runFrame()
    const samples = this.apu.sampleBuffer.splice(0) // 取走并清空，下一帧重新积累
    return { frameBuffer: this.ppu.frameBuffer, samples }
  }
}
