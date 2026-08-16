// 真机 demo：bun src/app/native-window.mjs [--msgbox]
// 用 Bun FFI 直接调 Windows 系统 DLL——这是字面意义的「JS 接入原生 GUI」：
// 没有框架、没有模拟，user32.dll 的 MessageBoxW 在屏幕上弹出一个真窗口。
// （默认只做非阻塞验证调用；--msgbox 才真弹窗，确认后返回）
import { dlopen, suffix, ptr } from 'bun:ffi'

const user32 = dlopen(`user32.${suffix}`, {
  // int MessageBoxW(HWND, LPCWSTR text, LPCWSTR caption, UINT uType)
  MessageBoxW: { args: ['i32', 'pointer', 'pointer', 'u32'], returns: 'i32' },
})
const kernel32 = dlopen(`kernel32.${suffix}`, {
  GetTickCount: { args: [], returns: 'i64' },
})

const utf16 = (s) => ptr(Buffer.from(`${s}\0`, 'utf16le'))

const tick = kernel32.symbols.GetTickCount()
console.log(`[ffi] kernel32.GetTickCount() = ${tick}   ← 真·跨语言调用成功（C 返回的整数）`)

if (process.argv.includes('--msgbox')) {
  const ret = user32.symbols.MessageBoxW(
    0,
    utf16('这扇窗口不是 HTML——它来自 user32.dll 的 MessageBoxW'),
    utf16('JS 接入原生 GUI'),
    0, // MB_OK
  )
  console.log(`[ffi] MessageBoxW 返回 ${ret}（1 = 用户点了确定）`)
} else {
  console.log('[ffi] 加 --msgbox 参数，会真的弹出一扇系统窗口')
}
