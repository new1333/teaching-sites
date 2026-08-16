// PPU(2C02)之一:CPU 侧寄存器、显存(命名表/调色板)、Loopy 滚动寄存器。
// 渲染与帧时序在后续章节长进来;本章先让「CPU 能正确地看见/写进显存」。

import { u8, u16 } from './util.js'
import { rgbOf } from './palette.js'
import type { Mirroring } from './ines.js'

function reverseBits(v: number): number {
  let r = 0
  for (let i = 0; i < 8; i++) r = (r << 1) | ((v >> i) & 1)
  return r
}

/** 图案存储后端:卡带 CHR-ROM(只读)或 CHR-RAM(可写) */
export interface ChrBackend {
  read(addr: number): number
  write(addr: number, val: number): void
}

/** 默认后端:8KB 可写 CHR-RAM(CHR-ROM 卡带接入时会被替换) */
export class ChrRam implements ChrBackend {
  mem = new Uint8Array(0x2000)
  read(addr: number): number {
    return this.mem[addr & 0x1fff]
  }
  write(addr: number, val: number): void {
    this.mem[addr & 0x1fff] = val
  }
}

export class Ppu {
  // ---- CPU 侧寄存器($2000-$2007)----
  ctrl = 0 // PPUCTRL:基命名表 / 增量 / 图案表选择 / 精灵高度 / NMI 使能
  mask = 0 // PPUMASK:背景与精灵开关、左侧裁剪、强调色
  vblank = 0 // STATUS bit7(帧时序章由 tick 置位/清零)
  sprite0Hit = 0 // STATUS bit6(精灵章置位)
  spriteOverflow = 0 // STATUS bit5
  oamAddr = 0
  private lastWritten = 0 // open bus:STATUS 低 5 位是「上次总线写入」的残影

  // ---- Loopy 滚动寄存器 ----
  v = 0 // 当前视频地址(渲染指针)
  t = 0 // 暂存地址($2005/$2006 写入目标,复制到 v)
  x = 0 // fine-X(0-7 像素级水平偏移)
  w = 0 // 双写指针:0 等待高位写,1 等待低位写

  // ---- 帧时序 ----
  /** NMI 线状态:置位后由整机主循环 takeNmi() 取走(取走即回落) */
  private nmiAsserted = false
  /** 奇偶帧交替:奇数帧且渲染开启时预渲染行少 1 个 dot */
  oddFrame = false

  // ---- 显存 ----
  /** 命名表:2KB(水平/垂直镜像)或 4KB(四屏卡带) */
  vram: Uint8Array
  /** 镜像方向(装机时由卡带决定,loadRom 可改写) */
  mirroring: Mirroring
  palette = new Uint8Array(32) // 调色板 RAM
  readBuffer = 0 // $2007 读缓冲(一拍延迟)
  /** 图案存储(图块表 $0000-$1FFF),默认 CHR-RAM */
  chr: ChrBackend = new ChrRam()

  // ---- 精灵(OAM 256 字节 = 64 精灵 × 4 字节)----
  oam = new Uint8Array(256)
  /** 下一行的 8 个精灵槽(二级 OAM 的软件形态;数组序 = OAM 优先级序) */
  private spriteUnits: {
    active: boolean
    x: number
    lo: number
    hi: number
    attr: number
    isSprite0: boolean
  }[] = Array.from({ length: 8 }, () => ({ active: false, x: 0, lo: 0, hi: 0, attr: 0, isSprite0: false }))

  // ---- 渲染流水线 ----
  /** 262 条扫描线 × 341 dot 的时间坐标;帧时序章会在此基础上加 VBlank/NMI */
  scanline = 0
  dot = 0
  frameBuffer = new Uint8Array(256 * 240 * 3) // 一帧 RGB 输出
  // 16 位移位寄存器:高 8 位是正在画的那块瓦片,低 8 位是下一块(fetch 完成后上载)
  private bgShiftLo = 0
  private bgShiftHi = 0
  private atShiftLo = 0
  private atShiftHi = 0
  // 本 fetch 组(8 dot)的四个锁存
  private ntLatch = 0
  private atLatch = 0
  private ptLoLatch = 0
  private ptHiLatch = 0

  constructor(mirroring: Mirroring) {
    this.mirroring = mirroring
    this.vram = new Uint8Array(mirroring === 'fourScreen' ? 0x1000 : 0x800)
  }

  /** 推进一个 dot;一帧(89342 dot)走完时返回 true */
  tick(): boolean {
    const rendering = (this.mask & 0x18) !== 0
    const visible = this.scanline < 240
    const preRender = this.scanline === 261

    // 帧时序信号:VBlank 的起止与 NMI 拉线
    if (this.scanline === 241 && this.dot === 1) {
      this.vblank = 1
      if (this.ctrl & 0x80) this.nmiAsserted = true
    }
    if (preRender && this.dot === 1) {
      this.vblank = 0
      this.sprite0Hit = 0
      this.spriteOverflow = 0
    }

    // 像素先于移位读取(读-后-移):bit15 恰好是当前瓦片最左未画的像素
    if (visible && this.dot >= 2 && this.dot <= 257) this.renderPixel()

    if ((visible || preRender) && rendering) {
      const c = this.dot
      if ((c >= 2 && c <= 257) || (c >= 321 && c <= 337)) {
        this.shiftBg()
        switch ((c - 1) & 7) {
          case 0: {
            this.loadBgShifters()
            // 图块号:命名表基址 | v 的表内偏移
            this.ntLatch = this.ppuRead(0x2000 | (this.v & 0x0fff))
            break
          }
          case 2: {
            // 属性字节:属性表基址 | v 的表位 | 象限内偏移,再按 (coarseX,coarseY) 的奇偶取 2 位
            const at = this.ppuRead(0x23c0 | (this.v & 0x0c00) | ((this.v >> 4) & 0x38) | ((this.v >> 2) & 0x07))
            this.atLatch = (at >> (((this.v >> 4) & 4) | (this.v & 2))) & 3
            break
          }
          case 4:
            this.ptLoLatch = this.ppuRead(this.bgPatternBase() | (this.ntLatch << 4) | ((this.v >> 12) & 7))
            break
          case 6:
            this.ptHiLatch = this.ppuRead(this.bgPatternBase() | (this.ntLatch << 4) | ((this.v >> 12) & 7) | 8)
            break
          case 7:
            this.incHorz()
            break
        }
      }
      if (c === 256) this.incVert()
      if (c === 257) {
        this.v = (this.v & ~0x041f) | (this.t & 0x041f) // 水平位回抄 t(位10 + coarseX)
        this.evaluateSprites(this.scanline + 1) // 为下一条线备货
      }
      if (preRender && c === 1) {
        this.sprite0Hit = 0 // 标志在预渲染行开头清零
        this.spriteOverflow = 0
      }
      if (preRender && c >= 280 && c <= 304) {
        this.v = (this.v & ~0x7be0) | (this.t & 0x7be0) // 垂直位回抄 t(fineY + coarseY + 位11)
      }
    }

    // 推进时间坐标(奇数帧且渲染开启:预渲染行少最后一个 dot)
    this.dot++
    const skipLastDot = this.scanline === 261 && this.dot === 340 && this.oddFrame && rendering
    if (this.dot > 340 || skipLastDot) {
      this.dot = 0
      this.scanline++
      if (this.scanline > 261) {
        this.scanline = 0
        this.oddFrame = !this.oddFrame
        return true // 一帧完成
      }
    }
    return false
  }

  /** 取走 NMI 请求;有则返回 true(整机主循环据此调用 CPU 的 nmi()) */
  takeNmi(): boolean {
    if (this.nmiAsserted) {
      this.nmiAsserted = false
      return true
    }
    return false
  }

  private bgPatternBase(): number {
    return this.ctrl & 0x10 ? 0x1000 : 0
  }

  private shiftBg(): void {
    // 只在背景开启时移位——硬件上关背景连流水线都停
    if (this.mask & 0x08) {
      this.bgShiftLo = (this.bgShiftLo << 1) & 0xffff
      this.bgShiftHi = (this.bgShiftHi << 1) & 0xffff
      this.atShiftLo = (this.atShiftLo << 1) & 0xffff
      this.atShiftHi = (this.atShiftHi << 1) & 0xffff
    }
  }

  private loadBgShifters(): void {
    this.bgShiftLo = (this.bgShiftLo & 0xff00) | this.ptLoLatch
    this.bgShiftHi = (this.bgShiftHi & 0xff00) | this.ptHiLatch
    // 属性 2 位展开成全 0/全 1 的字节,与图案位平面同步移位
    this.atShiftLo = (this.atShiftLo & 0xff00) | (this.atLatch & 1 ? 0xff : 0x00)
    this.atShiftHi = (this.atShiftHi & 0xff00) | (this.atLatch & 2 ? 0xff : 0x00)
  }

  /** 可见区像素输出(dot 2-257 → 屏幕列 dot-2):先背景,后精灵合成 */
  private renderPixel(): void {
    const x = this.dot - 2
    const y = this.scanline
    const bit = 0x8000 >> this.x

    // 背景层:2 位像素值 + 2 位属性
    let bgPix = 0
    let bgColorIdx = 0 // 调色板 RAM 索引(0 = universal)
    if (this.mask & 0x08) {
      const p0 = this.bgShiftLo & bit ? 1 : 0
      const p1 = this.bgShiftHi & bit ? 1 : 0
      const a0 = this.atShiftLo & bit ? 1 : 0
      const a1 = this.atShiftHi & bit ? 1 : 0
      bgPix = (p1 << 1) | p0
      const clipped = x < 8 && !(this.mask & 0x02)
      bgColorIdx = clipped || bgPix === 0 ? 0 : (((a1 << 1) | a0) << 2) | bgPix
    }

    // 精灵层:第一个碰到不透明像素的槽赢(OAM 序即优先级)
    let sprPix = 0
    let sprColorIdx = 0
    let fromSprite0 = false
    if (this.mask & 0x10) {
      for (const u of this.spriteUnits) {
        if (!u.active) continue
        const off = x - u.x
        if (off < 0 || off > 7) continue
        const sb = 7 - off
        const p = (((u.hi >> sb) & 1) << 1) | ((u.lo >> sb) & 1)
        if (p === 0) continue
        if (x < 8 && !(this.mask & 0x04)) break // 左侧裁剪:精灵视为透明
        // sprite 0 hit:精灵 0 与背景都不透明(且背景在渲染)即置位
        if (u.isSprite0 && bgPix !== 0 && this.mask & 0x08) this.sprite0Hit = 1
        const behind = (u.attr & 0x20) !== 0
        if (bgPix !== 0 && behind) break // 精灵在背景后:背景赢,精灵像素不显示
        sprPix = p
        sprColorIdx = 0x10 | ((u.attr & 3) << 2) | p
        fromSprite0 = u.isSprite0 && p !== 0
        break
      }
    }

    const color = sprPix !== 0 ? this.palette[sprColorIdx] : this.palette[bgColorIdx]
    void fromSprite0
    const gray = this.mask & 0x01 ? 0x30 : 0xff
    const [r, g, b] = rgbOf(color & gray)
    const i = (y * 256 + x) * 3
    this.frameBuffer[i] = r
    this.frameBuffer[i + 1] = g
    this.frameBuffer[i + 2] = b
  }

  /** 为下一条扫描线挑选精灵(OAM 前序扫描取前 8 个)并取图案 */
  private evaluateSprites(nextLine: number): void {
    if (nextLine >= 240) {
      for (const u of this.spriteUnits) u.active = false
      return
    }
    const height = this.ctrl & 0x20 ? 16 : 8
    let count = 0
    for (let i = 0; i < 64; i++) {
      const y = this.oam[i * 4]
      const dy = nextLine - y - 1 // OAM 的 y 是「屏幕行 - 1」
      if (dy < 0 || dy >= height) continue
      if (count < 8) {
        const tile = this.oam[i * 4 + 1]
        const attr = this.oam[i * 4 + 2]
        const row = attr & 0x80 ? height - 1 - dy : dy // 垂直翻转
        let addr: number
        if (height === 8) {
          addr = (this.ctrl & 0x08 ? 0x1000 : 0) | (tile << 4) | (row & 7)
        } else {
          // 8×16:表由瓦片号 bit0 选,上下两瓦片由 row bit3 选
          addr = ((tile & 1) << 12) | ((tile & 0xfe) << 4) | ((row & 8) << 1) | (row & 7)
        }
        let lo = this.chr.read(addr)
        let hi = this.chr.read(addr | 8)
        if (attr & 0x40) {
          lo = reverseBits(lo)
          hi = reverseBits(hi)
        }
        const u = this.spriteUnits[count]
        u.active = true
        u.x = this.oam[i * 4 + 3]
        u.lo = lo
        u.hi = hi
        u.attr = attr
        u.isSprite0 = i === 0
        count++
      } else {
        this.spriteOverflow = 1
      }
    }
    for (let k = count; k < 8; k++) this.spriteUnits[k].active = false
  }

  /** OAM DMA 单字节写入口(由 Bus 的 $4014 处理逐字节调用) */
  oamWrite(val: number): void {
    this.oam[this.oamAddr] = u8(val)
    this.oamAddr = u8(this.oamAddr + 1)
  }

  // ---- Loopy 滚动推进 ----

  private incHorz(): void {
    if ((this.v & 0x1f) === 31) {
      this.v = (this.v & ~0x1f) ^ 0x0400 // coarseX 31 → 0,并翻到水平相邻命名表
    } else {
      this.v++
    }
  }

  private incVert(): void {
    if ((this.v & 0x7000) !== 0x7000) {
      this.v += 0x1000 // fineY +1
    } else {
      this.v &= ~0x7000
      let cy = (this.v >> 5) & 0x1f
      if (cy === 29) {
        cy = 0
        this.v ^= 0x0800 // 命名表行翻到垂直相邻表
      } else if (cy === 31) {
        cy = 0 // 30/31 两行不属于命名表,折回不翻表
      } else {
        cy++
      }
      this.v = (this.v & ~0x03e0) | (cy << 5)
    }
  }

  // ---- CPU 侧寄存器访问(经 Bus 每 8 字节镜像后进来,addr 已归到 0-7)----

  cpuRead(addr: number): number {
    switch (addr) {
      case 2: {
        const v = (this.vblank << 7) | (this.sprite0Hit << 6) | (this.spriteOverflow << 5) | (this.lastWritten & 0x1f)
        this.vblank = 0 // 读清 vblank
        this.w = 0 // $2005/$2006 双写指针复位
        return v
      }
      case 4:
        return this.oam[this.oamAddr]
      case 7: {
        const a = this.v & 0x3fff
        let out: number
        if (a >= 0x3f00) {
          out = this.palette[this.paletteIndex(a)]
          if (this.mask & 1) out &= 0x30 // 灰度模式只留亮度位
        } else {
          out = this.readBuffer
          this.readBuffer = this.ppuRead(a)
        }
        this.v = u16(this.v + this.addrIncrement())
        return out
      }
      default:
        return 0 // 其余寄存器写-only,读走 open bus(简化为 0)
    }
  }

  cpuWrite(addr: number, val: number): void {
    val = u8(val)
    this.lastWritten = val
    switch (addr) {
      case 0: // PPUCTRL:bit0-1 基命名表 → t 的 bit10-11
        // vblank 期间才开 NMI 也要拉线:使能沿重新触发
        if (val & 0x80 && this.vblank) this.nmiAsserted = true
        this.ctrl = val
        this.t = (this.t & 0x73ff) | ((val & 0x03) << 10)
        break
      case 1:
        this.mask = val
        break
      case 3:
        this.oamAddr = val
        break
      case 4:
        this.oam[this.oamAddr] = val
        this.oamAddr = u8(this.oamAddr + 1)
        break
      case 5: {
        // PPUSCROLL:第一次写 X,fine-X + coarse-X;第二次写 Y,fine-Y + coarse-Y
        if (this.w === 0) {
          this.x = val & 7
          this.t = (this.t & 0x7fe0) | (val >> 3)
        } else {
          this.t = (this.t & 0x0c1f) | ((val & 7) << 12) | ((val & 0xf8) << 2)
        }
        this.w ^= 1
        break
      }
      case 6: {
        // PPUADDR:先高 6 位(bit14 硬件上读不到),后低 8 位;低位写完把 t 复制进 v
        if (this.w === 0) {
          this.t = (this.t & 0x00ff) | ((val & 0x3f) << 8)
        } else {
          this.t = (this.t & 0x7f00) | val
          this.v = this.t
        }
        this.w ^= 1
        break
      }
      case 7:
        this.ppuWrite(this.v & 0x3fff, val)
        this.v = u16(this.v + this.addrIncrement())
        break
    }
  }

  private addrIncrement(): number {
    return this.ctrl & 0x04 ? 32 : 1
  }

  // ---- PPU 侧显存总线($0000-$3FFF)----

  ppuRead(addr: number): number {
    addr &= 0x3fff
    if (addr < 0x2000) return this.chr.read(addr)
    if (addr < 0x3f00) return this.vram[this.ntIndex(addr)]
    return this.palette[this.paletteIndex(addr)]
  }

  ppuWrite(addr: number, val: number): void {
    addr &= 0x3fff
    if (addr < 0x2000) {
      this.chr.write(addr, val)
    } else if (addr < 0x3f00) {
      this.vram[this.ntIndex(addr)] = u8(val)
    } else {
      this.palette[this.paletteIndex(addr)] = u8(val)
    }
  }

  /** 命名表镜像:逻辑 4 表 → 物理 2 表(或四屏直通) */
  private ntIndex(addr: number): number {
    const offset = addr & 0x03ff
    if (this.mirroring === 'fourScreen') return offset | (addr & 0x0c00)
    const table = (addr >> 10) & 3
    // 垂直:table 0/2 → 物理 0,table 1/3 → 物理 1;水平:0/1 → 0,2/3 → 1
    const phys = this.mirroring === 'vertical' ? table & 1 : table >> 1
    return (phys << 10) | offset
  }

  /** 调色板镜像:$3F10/14/18/1C 折回 $3F00/04/08/0C */
  private paletteIndex(addr: number): number {
    const i = addr & 0x1f
    return (i & 0x13) === 0x10 ? i & 0x0f : i
  }
}
