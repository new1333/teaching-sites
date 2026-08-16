// 真机篇：真的跨语言。这不是模拟——下面的字节码是真 WebAssembly 模块，
// add 函数编译自 wasm 字节码（本可用 C/Rust 编出，这里手工组装等价产物），
// 由 JS 引擎的真 wasm 虚拟机执行。JS 与它之间是实打实的语言边界。
//
// 模块结构（wasm 二进制的节区）：
//   magic+version | type: (i32,i32)->i32 | func: 1 个 | export: "add" | code: local.get0 local.get1 i32.add

/** 手工组装的 wasm 模块：导出 add(a: i32, b: i32): i32 */
export const WASM_MODULE_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // \0asm 版本 1
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, // type 节：(i32, i32) -> i32
  0x03, 0x02, 0x01, 0x00,                       // func 节：函数 0 用类型 0
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export 节："add" -> 函数 0
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, // code 节：get0 get1 i32.add end
])

export interface NativeMath {
  add(a: number, b: number): number
}

// Node/浏览器都内置 WebAssembly；TS 的纯 ES lib 没带类型，这里声明我们用到的最小面
declare const WebAssembly: {
  instantiate(bytes: Uint8Array): Promise<{
    instance: { exports: Record<string, (...args: number[]) => number> }
  }>
}

/** 实例化 wasm 模块，拿到真原生函数（bytes 可传副本——模块是纯数据） */
export async function loadNativeMath(bytes: Uint8Array = WASM_MODULE_BYTES): Promise<NativeMath> {
  const { instance } = await WebAssembly.instantiate(bytes)
  const exports = instance.exports as { add(a: number, b: number): number }
  return { add: exports.add }
}
