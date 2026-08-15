import { describe, expect, it } from 'vitest'
import { createAppRegistry, getInstance, registerInstance } from '../src/record'
import type { AppLike, InstanceLike } from '../src/types'

function createApp(name: string, uid: number): AppLike {
  return { uid, name }
}

function createInstance(name: string, uid: number): InstanceLike {
  return { uid, type: { name } }
}

describe('createAppRegistry', () => {
  it('注册应用后 apps 里有记录，记录含 id 与名字', () => {
    const registry = createAppRegistry()
    const main = createApp('main', 1)
    const record = registry.registerApp(main)
    expect(registry.apps.length).toBe(1)
    expect(record.app).toBe(main)
    expect(record.name).toBe('main')
    expect(record.id.length).toBeGreaterThan(0)
    expect(record.instanceMap).toBeInstanceOf(Map)
  })

  it('首个注册的应用自动成为活动应用', () => {
    const registry = createAppRegistry()
    const main = createApp('main', 1)
    registry.registerApp(main)
    expect(registry.activeAppRecord.app).toBe(main)
  })

  it('双应用并存互不干扰，setActive 可切换', () => {
    const registry = createAppRegistry()
    const main = createApp('main', 1)
    const sub = createApp('sub', 2)
    const mainRecord = registry.registerApp(main)
    const subRecord = registry.registerApp(sub)

    expect(registry.apps.length).toBe(2)
    expect(registry.activeAppRecord.app).toBe(main)

    registry.setActive(subRecord.id)
    expect(registry.activeAppRecord.app).toBe(sub)

    registry.setActive(mainRecord.id)
    expect(registry.activeAppRecord.app).toBe(main)
  })

  it('注销应用后从 apps 移除；活动应用被注销时自动落到剩余应用', () => {
    const registry = createAppRegistry()
    const main = createApp('main', 1)
    const sub = createApp('sub', 2)
    const mainRecord = registry.registerApp(main)
    const subRecord = registry.registerApp(sub)

    registry.unregisterApp(main)
    expect(registry.apps.length).toBe(1)
    expect(registry.activeAppRecord.app).toBe(sub)

    registry.unregisterApp(sub)
    expect(registry.apps.length).toBe(0)
    expect(mainRecord).toBeDefined()
    expect(subRecord).toBeDefined()
  })
})

describe('registerInstance', () => {
  it('返回唯一 id，且可凭 id 取回同一实例', () => {
    const registry = createAppRegistry()
    const app = createApp('main', 1)
    registry.registerApp(app)
    const card = createInstance('Card', 7)

    const id = registerInstance(app, card)
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(getInstance(app, id)).toBe(card)
  })

  it('同一实例重复登记复用同一 id，不重复入表', () => {
    const registry = createAppRegistry()
    const app = createApp('main', 1)
    registry.registerApp(app)
    const card = createInstance('Card', 7)

    const first = registerInstance(app, card)
    const second = registerInstance(app, card)
    expect(second).toBe(first)

    const record = registry.apps.find(r => r.app === app)!
    expect(record.instanceMap.size).toBe(1)
  })

  it('不同应用里 uid 相同的两个实例，id 互不冲突', () => {
    const registry = createAppRegistry()
    const main = createApp('main', 1)
    const sub = createApp('sub', 2)
    registry.registerApp(main)
    registry.registerApp(sub)

    const mainCard = createInstance('Card', 7)
    const subCard = createInstance('Card', 7)   // 与 mainCard 同名同 uid

    const mainId = registerInstance(main, mainCard)
    const subId = registerInstance(sub, subCard)

    expect(mainId).not.toBe(subId)
    expect(getInstance(main, mainId)).toBe(mainCard)
    expect(getInstance(sub, subId)).toBe(subCard)
    expect(getInstance(main, subId)).toBeUndefined()
  })

  it('同一应用内两个不同实例即便 uid 相同也能区分', () => {
    const registry = createAppRegistry()
    const app = createApp('main', 1)
    registry.registerApp(app)

    const a = createInstance('Row', 3)
    const b = createInstance('Row', 3)          // uid 撞号

    const idA = registerInstance(app, a)
    const idB = registerInstance(app, b)

    expect(idA).not.toBe(idB)
    expect(getInstance(app, idA)).toBe(a)
    expect(getInstance(app, idB)).toBe(b)
  })
})
