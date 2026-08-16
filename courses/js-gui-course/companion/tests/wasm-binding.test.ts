import { describe, it, expect } from 'vitest'
import { loadNativeMath, WASM_MODULE_BYTES } from '../src/wasm/realBinding'
import { createBridge } from '../src/runtime/bridge'

describe('真的跨语言：WebAssembly 模块里的原生函数', () => {
  it('内置 wasm 二进制合法，导出 add 函数', async () => {
    const m = await loadNativeMath()
    expect(typeof m.add).toBe('function')
  })

  it('add 真的在 wasm 里算：21 + 21 = 42', async () => {
    const m = await loadNativeMath()
    expect(m.add(21, 21)).toBe(42)
  })

  it('值语义：JS 的浮点数跨进 i32 世界会被截断（边界按对方类型解释）', async () => {
    const m = await loadNativeMath()
    expect(m.add(21.9, 0.2)).toBe(21) // wasm 侧只见 i32：21.9→21, 0.2→0
  })

  it('挂上第 4 章的桥：binding 注册表对真原生函数一视同仁', async () => {
    const m = await loadNativeMath()
    const bridge = createBridge()
    bridge.register('native.add', (a: number, b: number) => m.add(a, b))
    expect(bridge.invoke('native.add', 20, 4)).toBe(24)
  })

  it('wasm 没有通道 smuggling：bytes 是纯数据，可以复制后各自实例化', async () => {
    const bytes = WASM_MODULE_BYTES.slice() // 复制一份
    const a = await loadNativeMath()
    const b = await loadNativeMath(bytes)
    expect(a.add(5, 5)).toBe(10)
    expect(b.add(5, 5)).toBe(10)
  })
})
