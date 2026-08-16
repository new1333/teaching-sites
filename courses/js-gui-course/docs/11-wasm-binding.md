---
title: 真机篇（上）：WebAssembly——第一次真的跨语言
---

# 真机篇（上）：WebAssembly——第一次真的跨语言

这本书有个一直没挑明的坑：到目前为止，**我们的「原生世界」是 TypeScript 演的**。第 4 章的 binding、第 5 章的窗口管理器，全跑在同一个 JS 引擎里——序列化边界是「假装拷贝」，注册表两端是同一种语言。跟着做下来你可能隐约觉得哪里不对劲：说好的「JS 调用另一个语言」，从头到尾没离开过 JS 世界。原理结构没错（真实框架确实是那个形状），但你还没亲眼见过「调用真的落到另一种语言的机器码上」。这一章跨过去：用 WebAssembly 当那门「另一个语言」，因为它的边界语义和我们第 4 章手写的一模一样，且任何装了 Node 的机器都能当场验证——不需要装编译器。

## 为什么 wasm 是理想的「真机替身」

WebAssembly 是一门真实的编译目标语言：C、Rust、AssemblyScript 都能编成它，产物是二进制字节码，由引擎里的 wasm 虚拟机执行——和 V8 执行 JS 是两个世界。它与我们课程主题的关系比看上去深：**wasm 就是一个「被嵌入的运行时」，宿主（JS 引擎）通过明确的边界跟它交换 i32/i64/float，两边不共享对象、不共享 GC**。你在第 3 章学的「引擎 vs 宿主」、第 4 章的「序列化边界」，在 JS↔wasm 这条边上原样成立。

## 手工组装一个 wasm 模块

通常你会用 C/Rust 编译出 wasm，但为了「零工具链可验证」，我们手工组装一个 41 字节的模块——每个字节都看得见，这反而是理解「另一个语言到底是个什么东西」的最好机会：

```ts
// src/wasm/realBinding.ts · WASM_MODULE_BYTES（每行一个节区）
export const WASM_MODULE_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // \0asm 版本 1
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, // type 节：(i32, i32) -> i32
  0x03, 0x02, 0x01, 0x00,                       // func 节：函数 0 用类型 0
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export 节："add" -> 函数 0
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, // code 节：get0 get1 i32.add end
])
```

翻译成人话：开头 8 字节是魔数与版本；type 节声明「有一个函数类型：两个 i32 进、一个 i32 出」；func 节说「函数 0 是这个类型」；export 节把函数 0 以名字 `"add"` 暴露出来——**这就是 wasm 世界的 binding 注册表**，名字对函数的映射，与第 4 章 `registry.set('win.create', fn)` 同构；最后的 code 节是函数体：取参数 0、取参数 1、`i32.add`（操作码 `0x6a`）、返回。加载只要两行：

```ts
// src/wasm/realBinding.ts · loadNativeMath
export async function loadNativeMath(bytes = WASM_MODULE_BYTES): Promise<NativeMath> {
  const { instance } = await WebAssembly.instantiate(bytes)
  const exports = instance.exports as { add(a: number, b: number): number }
  return { add: exports.add }
}
```

## 边界上会发生什么：类型即关卡

跑 `add(21, 21)` 得 42——真的在 wasm 虚拟机里算的，不是 TS。但真正的教学时刻是这个：

```ts
// tests/wasm-binding.test.ts · 值语义
expect(m.add(21.9, 0.2)).toBe(21)
```

JS 里 `21.9 + 0.2` 是 22.1；wasm 侧返回 21。因为边界按**对方声明的类型**解释你的参数：`add` 要的是 i32，浮点在跨界的瞬间被截断成 21 和 0。这就是「另一个语言」的含义——那边有自己的类型系统，不迁就你这边的动态类型。第 4 章的 `serialize` 拒收函数、这里的 i32 截断、真实 N-API 的类型转换（JS number ↔ C double/int64）、Electron 传参报 `conversion failed`——**全是同一条规则在不同边界上的投影：值按对方的规矩过境，对象和引用止步**。

再看一条断言：`WASM_MODULE_BYTES.slice()` 复制一份，两个副本各自实例化、各自能算——模块是纯数据，可以随意拷贝分发。你下载的每个 wasm 产物（乃至某些「native 模块」）本质就是这样一个字节数组，这一章之后它对你就不再神秘。

## 接回第 4 章的桥

最后一步把两条线焊上：把真原生函数挂进第 4 章的 binding 注册表——

```ts
// tests/wasm-binding.test.ts · 桥对真原生函数一视同仁
const m = await loadNativeMath()
const bridge = createBridge()
bridge.register('native.add', (a: number, b: number) => m.add(a, b))
expect(bridge.invoke('native.add', 20, 4)).toBe(24)
```

第 4 章的桥是按「JS 函数」设计的，而 wasm 函数本身就是可调用的对象，直接能挂。这一刻课程的模拟部分和真实世界对上了榫：**注册表不在乎对面是 TS、是 wasm、还是 C++——它只管名字到函数的映射和过境规则**。真实 Electron 里 `win.create` 最终落到 C++ 的路径，与 `native.add` 落到 wasm 字节码的路径，结构上无法区分。

## 小结

这一章做了三件事：手工组装（并逐字节解释）了一个真 wasm 模块；在 JS↔wasm 边界上实测了值语义（i32 截断、纯数据可复制）；把真原生函数挂回了自制 binding 桥。「另一个语言」从概念变成了可以 `node` 一跑的机器码。下一章把「真机」贯彻到底：用系统 DLL 真的弹一个窗口，再把我们自制内核接上真实键盘，跑一个可以交互的完整应用。
