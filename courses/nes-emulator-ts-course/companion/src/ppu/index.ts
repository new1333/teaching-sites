// PPU 2C02：画师的档案室。本章装它的三块记忆（nametable×2、调色板、OAM）
// 与 $2000-$2007 八个寄存器窗口；渲染与时序在后续章长进来。

export type Mirroring = 'horizontal' | 'vertical'

export class PPU {
  readonly vram = new Uint8Array(0x800) // 2KB：两块 nametable，按卡带镜像方向共用
  readonly paletteRam = new Uint8Array(0x20) // 32 格调色板
  readonly oam = new Uint8Array(0x100) // 64 个精灵 × 4 字节

  // 八个寄存器里需要长期保存的状态
  ctrl = 0 // $2000 写入：自增步长(bit2)、NMI 使能(bit7) 等
  mask = 0 // $2001 写入：渲染开关
  vblank = false // status bit7：本章由外部（第 10 章时序）置位
  sprite0Hit = false // status bit6：第 9 章置位
  private statusLatch = 0 // $2002 低 5 位残影（真机行为，写入值滞留）

  private v = 0 // 15 位 VRAM 指针（$2005/$2006 两步写入共用）
  private writeToggle = false // 两次写入节奏的第一/第二步开关
  private oamAddr = 0 // OAM 指针

  // 扫描线状态机：一帧 262 线 × 341 拍 = 89342 个 PPU 周期
  scanline = 0 // 0-239 可见区，240 进 VBlank，241-260 歇息窗，261 预取
  cycle = 0 // 当前扫描线内的拍子（0-340）
  totalCycles = 0
  frameCount = 0
  onNmi?: () => void // VBlank 开始且 PPUCTRL bit7 开着时拉铃（第 10 章接入 CPU）

  constructor(
    readonly mirroring: Mirroring,
    private chrRom: Uint8Array = new Uint8Array(0) // 卡带图案区（$0000-$1FFF 只读）
  ) {}

  tick(): void {
    this.cycle++
    this.totalCycles++
    if (this.cycle === 341) {
      this.cycle = 0
      this.scanline++
      if (this.scanline === 240) {
        // 一帧画完，进 VBlank 窗口：帧缓冲此刻定格有效
        this.renderBackground()
        this.renderSprites()
        this.vblank = true
        if ((this.ctrl & 0x80) !== 0) this.onNmi?.()
      } else if (this.scanline === 261) {
        // 预取线：收工铃的余音散去，哨兵复位
        this.vblank = false
        this.sprite0Hit = false
      } else if (this.scanline === 262) {
        this.scanline = 0
        this.frameCount++
      }
    }
  }

  // CPU 侧寄存器读写（经总线转发进来，addr 已归到 0-7）
  readReg(addr: number): number {
    switch (addr & 7) {
      case 2:
        return this.readStatus()
      case 4: {
        const v = this.oam[this.oamAddr]
        this.oamAddr = (this.oamAddr + 1) & 0xff // 读 $2004 同样推进指针
        return v
      }
      case 7:
        return this.readVramData()
      default:
        return 0 // 其余寄存器只写不读
    }
  }

  writeReg(addr: number, val: number): void {
    val &= 0xff
    this.statusLatch = val // 真机：任何寄存器写入都会滞留在总线上
    switch (addr & 7) {
      case 0:
        this.ctrl = val
        break
      case 1:
        this.mask = val
        break
      case 3:
        this.oamAddr = val
        break
      case 4:
        this.oam[this.oamAddr] = val
        this.oamAddr = (this.oamAddr + 1) & 0xff
        break
      case 5:
        this.writeToggle = !this.writeToggle // 滚动寄存器，第 8 章用
        break
      case 6:
        if (!this.writeToggle) {
          this.v = (this.v & 0x00ff) | ((val & 0x3f) << 8)
        } else {
          this.v = (this.v & 0xff00) | val
        }
        this.writeToggle = !this.writeToggle
        break
      case 7: {
        this.writeVramData(val)
        break
      }
    }
  }

  // $2007 写：按 v 落盘，再按 ctrl 步长自增
  writeVramData(val: number): void {
    const addr = this.v & 0x3fff
    if (addr >= 0x3f00) {
      this.writePalette(addr, val)
    } else if (addr >= 0x2000) {
      this.vram[this.ntIndex(addr)] = val
    }
    // $0000-$1FFF 是 CHR 图案区，第 8 章接卡带读取，PPU 不写它
    this.v = (this.v + this.increment()) & 0x7fff
  }

  // $2007 读
  readVramData(): number {
    const addr = this.v & 0x3fff
    const val = addr >= 0x3f00
      ? this.readPalette(addr)
      : addr >= 0x2000
        ? this.vram[this.ntIndex(addr)]
        : this.chrRom[addr] // $0000-$1FFF：卡带 CHR 图案区
    this.v = (this.v + this.increment()) & 0x7fff
    return val
  }

  // 整帧背景渲染：nametable 960 格 → 每格查 16 字节图案 → 双位平面合并出 0-3
  // 色号 → 调色板间接 → 256×240 个 NES 色号（0-63）。滚动偏移第 10 章接入。
  readonly frameBuffer: number[] = new Array<number>(256 * 240).fill(0)
  // 背景每像素的 0-3 色号底账：精灵合成与 sprite 0 hit 都要查「背景是否透明」
  readonly bgColorIdx = new Uint8Array(256 * 240)

  renderBackground(): number[] {
    const bgTable = (this.ctrl & 0x10) !== 0 ? 0x1000 : 0 // PPUCTRL bit4 选左右图案表
    for (let row = 0; row < 30; row++) {
      for (let col = 0; col < 32; col++) {
        const ntBase = 0 // 滚动未接：固定 nametable 0
        const tileIdx = this.vram[ntBase + row * 32 + col]
        // 属性表在 nametable 末尾的 64 格，每格管 32×32 像素（2×2 个 tile）
        const attr = this.vram[ntBase + 0x3c0 + (row >> 2) * 8 + (col >> 2)]
        const shift = ((row & 2) << 1) | (col & 2) // 象限选 2 bit
        const palette = (attr >> shift) & 3
        const base = bgTable + tileIdx * 16
        for (let y = 0; y < 8; y++) {
          const lo = this.chrRom[base + y]
          const hi = this.chrRom[base + 8 + y]
          for (let x = 0; x < 8; x++) {
            const bit = 7 - x
            const colorIdx = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1)
            // 色号 0 是透明：永远落通用背景色 $3F00
            const palAddr = colorIdx === 0 ? 0x3f00 : 0x3f00 + palette * 4 + colorIdx
            const fbIdx = (row * 8 + y) * 256 + col * 8 + x
            this.frameBuffer[fbIdx] = this.paletteRam[palAddr & 0x1f]
            this.bgColorIdx[fbIdx] = colorIdx
          }
        }
      }
    }
    return this.frameBuffer
  }

  // 精灵合成：逐扫描线收集覆盖的精灵（OAM 顺序、每线最多 8 个），
  // 高序号先画低序号后画（低序号在上）。透明不画；优先级位让路给非透明背景。
  renderSprites(): void {
    const height = (this.ctrl & 0x20) !== 0 ? 16 : 8
    const spriteTable = (this.ctrl & 0x08) !== 0 ? 0x1000 : 0
    for (let line = 0; line < 240; line++) {
      const active: number[] = []
      for (let s = 0; s < 64 && active.length < 8; s++) {
        const y = this.oam[s * 4]
        if (line > y && line <= y + height) active.push(s) // 显示行从 y+1 起
      }
      for (let k = active.length - 1; k >= 0; k--) {
        const s = active[k]
        const y = this.oam[s * 4]
        const tile = this.oam[s * 4 + 1]
        const attr = this.oam[s * 4 + 2]
        const x = this.oam[s * 4 + 3]
        const palette = attr & 3
        const behindBg = (attr & 0x20) !== 0
        const flipH = (attr & 0x40) !== 0
        const flipV = (attr & 0x80) !== 0
        const rowIn = line - (y + 1)
        const row = flipV ? height - 1 - rowIn : rowIn
        // 8x16：基址取偶数 tile，bit0 选左右表，下半块是基址 +1
        const patternAddr = height === 16
          ? ((tile & 1) ? 0x1000 : 0) + (tile & 0xfe) * 16 + (row >= 8 ? 16 : 0) + (row & 7)
          : spriteTable + tile * 16 + row
        const lo = this.chrRom[patternAddr]
        const hi = this.chrRom[patternAddr + 8]
        for (let i = 0; i < 8; i++) {
          const sx = x + i
          if (sx > 255) break
          const bit = 7 - (flipH ? 7 - i : i)
          const colorIdx = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1)
          if (colorIdx === 0) continue // 透明像素不落笔
          const fbIdx = line * 256 + sx
          const bgOpaque = this.bgColorIdx[fbIdx] !== 0
          if (s === 0 && bgOpaque && sx > 0 && sx < 255) {
            this.sprite0Hit = true // 0 号精灵撞上非透明背景：游戏的「画到这里了」哨兵
          }
          if (behindBg && bgOpaque) continue // 优先级位：非透明背景前让路
          this.frameBuffer[fbIdx] = this.paletteRam[0x10 + palette * 4 + colorIdx]
        }
      }
    }
  }

  private increment(): number {
    return (this.ctrl & 0b100) !== 0 ? 32 : 1
  }

  // nametable 镜像：四块逻辑 nametable 折进 2KB 物理
  private ntIndex(addr: number): number {
    const table = (addr >> 10) & 3 // 第几块逻辑 nametable（0-3）
    const offset = addr & 0x3ff
    const physical = this.mirroring === 'horizontal' ? [0, 0, 1, 1][table] : [0, 1, 0, 1][table]
    return physical * 0x400 + offset
  }

  // 调色板镜像：$3F10/$14/$18/$1C 是 $3F00/$04/$08/$0C 的背景色分身
  private writePalette(addr: number, val: number): void {
    const idx = this.paletteIndex(addr)
    this.paletteRam[idx] = val & 0x3f
  }

  private readPalette(addr: number): number {
    return this.paletteRam[this.paletteIndex(addr)] & 0x3f
  }

  private paletteIndex(addr: number): number {
    let idx = addr & 0x1f
    if (idx >= 0x10 && (idx & 3) === 0) idx &= 0x0f // $3F10→$3F00 等
    return idx
  }

  private readStatus(): number {
    const val =
      (this.vblank ? 0x80 : 0) |
      (this.sprite0Hit ? 0x40 : 0) |
      (this.statusLatch & 0x1f)
    this.vblank = false // 读一次即清
    this.writeToggle = false // 两步写入节奏也重置
    return val
  }

  // OAM DMA：CPU 把整页 256 字节灌进 OAM（由 Bus 在 $4014 处触发）
  oamDma(fetchByte: (i: number) => number): void {
    for (let i = 0; i < 256; i++) {
      this.oam[(this.oamAddr + i) & 0xff] = fetchByte(i)
    }
  }
}
