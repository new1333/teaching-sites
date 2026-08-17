import { describe, it, expect } from 'vitest'
import { APU } from '../src/apu'
import { Noise } from '../src/apu/noise'
import { Controller } from '../src/controller'
import { NES } from '../src/nes'
import { makeNromCartridge } from '../src/fixtures'

describe('三角波通道', () => {
  it('32 步序列：15 递减到 0 再递增回 15（方歯的相反：没有音量旋钮）', () => {
    const apu = new APU()
    apu.writeReg(0x4015, 0x04) // 启用三角波
    apu.writeReg(0x4008, 0xff) // control=1、重载值 127：持续供能
    apu.writeReg(0x400a, 0x02) // timer=2：每 3 个 CPU 周期走一步
    apu.writeReg(0x400b, 0x00) // timer 高位 + 装载
    // 收集 32 步输出（每步间隔 timer+1 个周期）
    const seq: number[] = [apu.triangle.currentOutput()]
    for (let i = 0; i < 40; i++) {
      apu.tick(3)
      seq.push(apu.triangle.currentOutput())
    }
    expect(seq[0]).toBe(15)
    expect(seq[1]).toBe(14)
    expect(seq[15]).toBe(0)
    expect(seq[16]).toBe(0) // 两个 0 相邻（下坡顶与上坡底）
    expect(seq[17]).toBe(1)
  })

  it('线性计数器：control=0 时按 quarter 耗尽后静音，重新装载恢复', () => {
    const apu = new APU()
    apu.writeReg(0x4015, 0x04)
    apu.writeReg(0x4008, 0x01) // control=0、reload 值 1
    apu.writeReg(0x400a, 0x02)
    apu.writeReg(0x400b, 0x00) // 装载线性计数器 = 1
    expect(apu.triangle.currentOutput()).toBeGreaterThan(0) // 还有余量
    apu.tick(7457) // 一个 quarter 节拍：counter 1→0
    expect(apu.triangle.currentOutput()).toBe(0) // 被闸住
    apu.writeReg(0x400b, 0x00) // 重新装载
    expect(apu.triangle.currentOutput()).toBeGreaterThan(0)
  })
})

describe('噪声通道', () => {
  it('LFSR 确定性：同一初值同一模式，两次实例序列完全一致', () => {
    const a = new Noise()
    const b = new Noise()
    const seqA: number[] = []
    const seqB: number[] = []
    for (let i = 0; i < 20; i++) {
      a.clockLfsr()
      b.clockLfsr()
      seqA.push(a.lfsr)
      seqB.push(b.lfsr)
    }
    expect(seqA).toEqual(seqB) // 不是随机数：转盘齿轮，转多少圈都一样
  })

  it('模式位切换序列：mode 0 与 mode 1 的序列分道扬镳', () => {
    const long = new Noise()
    const short = new Noise()
    short.mode = true
    const seqLong: number[] = []
    const seqShort: number[] = []
    for (let i = 0; i < 16; i++) { // 前 8 步两种模式还没分叉，bit6 要等 1 移过去
      long.clockLfsr()
      short.clockLfsr()
      seqLong.push(long.lfsr)
      seqShort.push(short.lfsr)
    }
    expect(seqLong).not.toEqual(seqShort)
  })

  it('装载即出声：恒定音量 15 时 emit 在 0/15 间跳', () => {
    const apu = new APU()
    apu.writeReg(0x4015, 0x08) // 启用噪声
    apu.writeReg(0x400c, 0x9f) // 恒定音量 15
    apu.writeReg(0x400e, 0x04) // 周期档 4
    apu.writeReg(0x400f, 0x00) // 长度档 0
    let sawHigh = false
    let sawLow = false
    for (let i = 0; i < 1000; i++) {
      apu.tick(1)
      const v = apu.noise.emit()
      if (v === 15) sawHigh = true
      if (v === 0) sawLow = true
    }
    expect(sawHigh && sawLow).toBe(true)
  })
})

describe('手柄：$4016 移位协议', () => {
  it('strobe 后连读 8 次得 8 个键态（A B Sel Sta Up Dn Lt Rt），此后恒 1', () => {
    const pad = new Controller()
    pad.setButton('A', true)
    pad.setButton('Start', true)
    pad.write(0x01) // strobe 高：锁存
    pad.write(0x00) // strobe 落：准备移位
    expect(pad.read()).toBe(1) // A
    expect(pad.read()).toBe(0) // B
    expect(pad.read()).toBe(0) // Select
    expect(pad.read()).toBe(1) // Start
    expect(pad.read()).toBe(0) // Up
    expect(pad.read()).toBe(0) // Down
    expect(pad.read()).toBe(0) // Left
    expect(pad.read()).toBe(0) // Right
    expect(pad.read()).toBe(1) // 第 9 次起恒 1
  })

  it('不重新 strobe 时读数走完不回卷', () => {
    const pad = new Controller()
    pad.setButton('B', true)
    pad.write(0x01)
    pad.write(0x00)
    expect(pad.read()).toBe(0) // A 未按
    expect(pad.read()).toBe(1) // B
    // 中途按下新键、不 strobe：读到的仍是锁存快照
    pad.setButton('A', true)
    expect(pad.read()).toBe(0) // Select（快照里没按）
  })
})

describe('第一次开机：整机 frame() 集成（零外部输入）', () => {
  function bootCartridge(): Uint8Array {
    // 自产整机演示卡带：开 NMI → 每帧 VBlank 里铺画面、读手柄、发三通道声音
    const prg = new Array<number>(0x4000).fill(0)
    let p = 0
    const emit = (...bytes: number[]) => { prg.splice(p, bytes.length, ...bytes); p += bytes.length }
    // $8000 主程序
    emit(0xa9, 0x80, 0x8d, 0x00, 0x20)       // LDA #$80; STA $2000 开 NMI
    // wait: BIT $2002; BPL wait
    const waitAt = p
    emit(0x2c, 0x02, 0x20, 0x10, 0xfb)
    // --- VBlank 窗口：调色板 + nametable 格(0,0) ---
    emit(0xa9, 0x3f, 0x8d, 0x06, 0x20)       // LDA #$3F; STA $2006
    emit(0xa9, 0x00, 0x8d, 0x06, 0x20)       // LDA #$00; STA $2006
    emit(0xa9, 0x0f, 0x8d, 0x07, 0x20)       // 背景色 $0F
    emit(0xa9, 0x21, 0x8d, 0x07, 0x20)       // 调色板 0 的 1 号色 $21
    emit(0xa9, 0x20, 0x8d, 0x06, 0x20)       // $2006 ← $2000
    emit(0xa9, 0x00, 0x8d, 0x06, 0x20)
    emit(0xa9, 0x01, 0x8d, 0x07, 0x20)       // 格(0,0) = tile 1
    // --- 手柄：strobe + 读 A 存 $0300 ---
    emit(0xa9, 0x01, 0x8d, 0x16, 0x40)       // LDA #1; STA $4016
    emit(0xa9, 0x00, 0x8d, 0x16, 0x40)       // LDA #0; STA $4016
    emit(0xad, 0x16, 0x40, 0x8d, 0x00, 0x03) // LDA $4016; STA $0300（A 键态）
    // --- 三通道声音 ---
    emit(0xa9, 0x1f, 0x8d, 0x15, 0x40)       // $4015 = $1F：四通道全开
    emit(0xa9, 0x9a, 0x8d, 0x00, 0x40)       // pulse1：duty2 恒定音量 10
    emit(0xa9, 0xfd, 0x8d, 0x02, 0x40)
    emit(0xa9, 0x00, 0x8d, 0x03, 0x40)       // timer=$FD（A4）、长度档 0
    emit(0xa9, 0xff, 0x8d, 0x08, 0x40)       // triangle：control=1
    emit(0xa9, 0x82, 0x8d, 0x0a, 0x40)
    emit(0xa9, 0x00, 0x8d, 0x0b, 0x40)       // timer=$082、长度档 0
    emit(0xa9, 0x9f, 0x8d, 0x0c, 0x40)       // noise：恒定音量 15
    emit(0xa9, 0x04, 0x8d, 0x0e, 0x40)
    emit(0xa9, 0x00, 0x8d, 0x0f, 0x40)       // 周期档 4、长度档 0
    emit(0x4c, waitAt & 0xff, (waitAt >> 8) | 0x80) // JMP wait
    // $9000 NMI：帧计数 +1 后返回
    prg[0x1000] = 0xee // INC $0400
    prg[0x1001] = 0x00
    prg[0x1002] = 0x04
    prg[0x1003] = 0x40 // RTI
    // 向量表
    prg[0x3ffa] = 0x00; prg[0x3ffb] = 0x90
    prg[0x3ffc] = 0x00; prg[0x3ffd] = 0x80
    // CHR：tile 1 = 实心 1 号色
    const chr = new Array<number>(0x2000).fill(0)
    for (let y = 0; y < 8; y++) chr[0x10 + y] = 0xff // tile1 低平面全 1
    return makeNromCartridge({ prg, chr })
  }

  it('frame({A: true})：画面有图案、手柄读到 A、三通道出声、NMI 在跑', () => {
    const nes = new NES(bootCartridge())
    nes.frame({ A: true }) // 第一帧：VBlank 里铺数据（下一帧才显示——真实时序）
    const r1 = nes.frame({ A: true })
    // 画面：格(0,0) 的 tile 1 实心 1 号色 → 调色板 0 的 1 号色 $21
    expect(r1.frameBuffer[0]).toBe(0x21)
    expect(r1.frameBuffer[9 * 256 + 9]).toBe(0x0f) // 别处仍是背景色
    // 手柄：VBlank 里程序读到的 A 键态存进了 $0300
    expect(nes.bus.read(0x0300)).toBe(1)
    // 声音：pulse + triangle + noise 同时发声，采样流明显非静音
    const peak = Math.max(...r1.samples.map(Math.abs))
    expect(peak).toBeGreaterThan(0.1)
    // NMI 处理程序在跑：帧计数器已增长
    expect(nes.bus.read(0x0400)).toBeGreaterThan(0)
    // 零输入承诺：不需要任何外部 ROM，全程自产 fixture
  })

  it('frame() 不按键：$0300 记录 0（手柄路径反向验证）', () => {
    const nes = new NES(bootCartridge())
    nes.frame()
    expect(nes.bus.read(0x0300)).toBe(0)
  })
})
