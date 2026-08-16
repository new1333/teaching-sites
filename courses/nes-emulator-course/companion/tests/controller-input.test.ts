import { describe, it, expect } from 'vitest'
import { Bus } from '../src/bus.js'
import { Ppu } from '../src/ppu.js'
import { Controller, type NesButton } from '../src/controller.js'

function makeMachine() {
  const ppu = new Ppu('horizontal')
  const bus = new Bus(ppu)
  const controller = new Controller()
  bus.ioRead = (a) => (a === 0x4016 || a === 0x4017 ? controller.cpuRead(a) : 0)
  bus.ioWrite = (a, v) => controller.cpuWrite(a, v)
  return { bus, controller }
}

/** 按顺序读 8 次并返回位序列(0/1) */
const readButtons = (bus: Bus, port: number): number[] =>
  Array.from({ length: 8 }, () => bus.read(port) & 1)

// 硬件读取顺序:A B Select Start Up Down Left Right
const ORDER: NesButton[] = ['A', 'B', 'Select', 'Start', 'Up', 'Down', 'Left', 'Right']

describe('strobe 与移位读取', () => {
  it('按下 A 和 Start:strobe 后 8 次读出正确的位序列', () => {
    const { bus, controller } = makeMachine()
    controller.setButton(0, 'A', true)
    controller.setButton(0, 'Start', true)
    bus.write(0x4016, 0x01) // strobe 高:持续锁存
    bus.write(0x4016, 0x00) // strobe 落下:快照定格,开始移位
    const bits = readButtons(bus, 0x4016)
    expect(bits).toEqual([1, 0, 0, 1, 0, 0, 0, 0])
  })

  it('读取中途重新 strobe:位序从头开始', () => {
    const { bus, controller } = makeMachine()
    controller.setButton(0, 'Up', true)
    bus.write(0x4016, 0x01)
    bus.write(0x4016, 0x00)
    bus.read(0x4016) // 读走 A 位
    bus.read(0x4016) // 读走 B 位
    bus.write(0x4016, 0x01)
    bus.write(0x4016, 0x00) // 重新锁存
    const bits = readButtons(bus, 0x4016)
    expect(bits).toEqual([0, 0, 0, 0, 1, 0, 0, 0]) // 又从 A 开始,Up 在第 5 位
  })

  it('读满 8 位后硬件返回 1(不是 0)', () => {
    const { bus } = makeMachine()
    bus.write(0x4016, 0x01)
    bus.write(0x4016, 0x00)
    readButtons(bus, 0x4016)
    expect(bus.read(0x4016) & 1).toBe(1)
    expect(bus.read(0x4016) & 1).toBe(1)
  })

  it('strobe 高电平期间读,恒返回 A 键状态(持续刷新)', () => {
    const { bus, controller } = makeMachine()
    controller.setButton(0, 'A', false)
    bus.write(0x4016, 0x01) // strobe 保持高
    expect(bus.read(0x4016) & 1).toBe(0)
    controller.setButton(0, 'A', true)
    expect(bus.read(0x4016) & 1).toBe(1) // 高电平期间快照持续刷新
    bus.write(0x4016, 0x00)
    expect(bus.read(0x4016) & 1).toBe(1) // 落沿定格
  })

  it('第二手柄走 $4017,与一手柄互不串扰', () => {
    const { bus, controller } = makeMachine()
    controller.setButton(1, 'B', true) // 二手柄按 B
    bus.write(0x4016, 0x01)
    bus.write(0x4016, 0x00)
    expect(readButtons(bus, 0x4017)).toEqual([0, 1, 0, 0, 0, 0, 0, 0])
    expect(readButtons(bus, 0x4016)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]) // 一手柄全空
  })

  it('strobe 高电平写任意次,松开后位序都是完整一轮', () => {
    const { bus, controller } = makeMachine()
    controller.setButton(0, 'Left', true)
    bus.write(0x4016, 0x01)
    bus.write(0x4016, 0x01)
    bus.write(0x4016, 0x00)
    expect(readButtons(bus, 0x4016)).toEqual([0, 0, 0, 0, 0, 0, 1, 0])
    expect(ORDER[6]).toBe('Left')
  })
})
