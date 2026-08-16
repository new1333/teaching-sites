// 可运行 demo：npm run demo（或 npx tsx src/app/demo.ts）
// TTY 下交互：+ 加一，q 退出；非交互环境自动放映三帧。
import { bootCounterApp, renderWindow, step } from './terminalApp'

const app = bootCounterApp()
const frame = () => renderWindow(app, 1)

if (process.stdin.isTTY && process.stdout.isTTY) {
  console.log('\x1b[2J\x1b[Hmini-Electron 终端 App —— [+] 加一  [q] 退出\n\n' + frame())
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', (buf: Buffer) => {
    const key = buf.toString()
    if (step(app, key) === 'quit') {
      console.log('\nbye')
      process.exit(0)
    }
    console.log('\x1b[2J\x1b[Hmini-Electron 终端 App —— [+] 加一  [q] 退出\n\n' + frame())
  })
} else {
  console.log('（非交互环境，自动放映：+ + + q）\n')
  for (const key of ['+', '+', '+', 'q']) {
    console.log(`--- 按 [${key}] ---`)
    console.log(frame())
    if (step(app, key) === 'quit') {
      console.log('loop 收到 quit，App 退出。')
      break
    }
  }
}
