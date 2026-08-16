// 作者侧验证:用 parseINES 解析 .course/roms 下的真实测试 ROM,打印卡带参数。
// 用法:npx tsx verify/list-roms.ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseINES } from '../src/ines.js'

const romDir = join(import.meta.dirname, '..', '..', '.course', 'roms')
for (const f of readdirSync(romDir).sort()) {
  const c = parseINES(readFileSync(join(romDir, f)))
  console.log(
    f.padEnd(24),
    'mapper=' + String(c.mapper).padEnd(2),
    c.mirroring.padEnd(12),
    'prg=' + String(c.prgRom.length).padEnd(6),
    'chr=' + (c.chrRom ? c.chrRom.length : 'RAM'),
  )
}
