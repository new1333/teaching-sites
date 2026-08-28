// 探针总线：在锁定 ref（.course/repo，commit 0f6c19e）的源码上跑全部断言。
// 每组探针 = 行为断言（跑真实源码）+ 结构断言（源码文本含预期形态）。
// 正文对本库的每个机制断言，与这里绿一一对应。
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const repo = new URL('../../.course/repo/', import.meta.url)
const src = (p) => new URL(p, repo).href
const text = (p) => readFileSync(new URL(p, repo), 'utf8').replace(/\r\n/g, '\n') // git 在 Windows 检出为 CRLF，结构断言按 LF 归一

const d = (await import(src('src/index.js'))).default
const zhCn = (await import(src('src/locale/zh-cn.js'))).default
const weekOfYear = (await import(src('src/plugin/weekOfYear/index.js'))).default

const eq = (label, actual, expected) => ({ label, ok: Object.is(actual, expected), detail: `${JSON.stringify(actual)} (期望 ${JSON.stringify(expected)})` })
const includes = (label, file, needle) => ({ label, ok: text(file).includes(needle), detail: `${file} 未含 ${JSON.stringify(needle.slice(0, 60))}` })

const chapters = []

// ch01 入口工厂与 clone 防御
{
  const a = d('2026-08-28')
  const rewrapped = d(a)
  chapters.push(['ch01 入口工厂', [
    eq('字符串入参得到 Dayjs 实例（鸭子标记）', a.$isDayjsObject, true),
    eq('Dayjs 再入参返回克隆而非原对象', rewrapped === a, false),
    eq('克隆与原对象值相等', rewrapped.valueOf() === a.valueOf(), true),
    includes('工厂里有 isDayjs 分支', 'src/index.js', 'if (isDayjs(date)) {\n    return date.clone()\n  }'),
    includes('工厂最终 new Dayjs(cfg)', 'src/index.js', 'return new Dayjs(cfg)')
  ]])
}

// ch02 parseDate 四路解析
{
  chapters.push(['ch02 parseDate', [
    eq('null → Invalid Date', d(null).isValid(), false),
    eq('无参 → 今天（有效）', d().isValid(), true),
    eq('ISO 短横线字符串走正则', d('2026-08-28').format('YYYY-MM-DD'), '2026-08-28'),
    eq('斜杠与单位数月日也走正则', d('2026/8/28').format('YYYY-MM-DD'), '2026-08-28'),
    eq('正则拆不动的交给 new Date 兜底', d(new Date('2026-08-28T10:00:00')).isValid(), true),
    includes('REGEX_PARSE 定义在 constant', 'src/constant.js', 'REGEX_PARSE = /^(\\d{4})[-/]?(\\d{1,2})?[-/]?(\\d{0,2})'),
    includes('兜底分支是 new Date(date)', 'src/index.js', 'return new Date(date) // everything else')
  ]])
}

// ch03 init 预计算缓存
{
  const a = d('2026-08-28T15:04:05.678')
  chapters.push(['ch03 init 缓存', [
    eq('$y 预计算等于 year()', a.$y, a.year()),
    eq('$M 预计算等于 month()', a.$M, a.month()),
    eq('$D 预计算等于 date()', a.$D, a.date()),
    eq('$W 预计算等于 day()', a.$W, a.day()),
    eq('2026-08-28 是周五', a.$W, 5),
    includes('getter 注册表逐项挂 $ 变量', 'src/index.js', "['$ms', C.MS],")
  ]])
}

// ch04 不可变性
{
  const a = d('2026-08-28')
  const b = a.add(1, 'day')
  const c = a.set('year', 2000)
  chapters.push(['ch04 不可变', [
    eq('add 后原实例日期不变', a.date(), 28),
    eq('add 返回新实例且值已变', b.date(), 29),
    eq('add 不返回原对象', b === a, false),
    eq('set 后原实例年份不变', a.year(), 2026),
    eq('set 返回新实例且已改', c.year(), 2000),
    includes('set 走 clone().$set', 'src/index.js', 'set(string, int) {\n    return this.clone().$set(string, int)\n  }'),
    includes('add 的天数路径经 wrapper', 'src/index.js', 'return Utils.w(d.date(d.date() + Math.round(n * number)), this)')
  ]])
}

// ch05 startOf/endOf
{
  const zh = d('2026-08-30').locale(zhCn) // 2026-08-30 是周日
  const en = d('2026-08-30')
  chapters.push(['ch05 startOf/endOf', [
    eq('月初对齐到 1 号', d('2026-08-28').startOf('month').date(), 1),
    eq('月末日 = endOf(month).date() 即 daysInMonth', d('2026-02-10').daysInMonth(), 28),
    eq('en（weekStart 0）周日对齐回当天', en.startOf('week').format('YYYY-MM-DD'), '2026-08-30'),
    eq('zh-cn（weekStart 1）周日对齐回周一', zh.startOf('week').format('YYYY-MM-DD'), '2026-08-24'),
    eq('endOf 是 startOf(arg, false)', d('2026-08-28').endOf('month').format('YYYY-MM-DD'), '2026-08-31'),
    includes('week 对齐读 locale.weekStart', 'src/index.js', "const weekStart = this.$locale().weekStart || 0"),
    includes('daysInMonth 借 endOf(M) 实现', 'src/index.js', 'daysInMonth() {\n    return this.endOf(C.M).$D\n  }')
  ]])
}

// ch06 format
{
  const a = d('2026-08-28T13:04:05')
  chapters.push(['ch06 format', [
    eq('YY 截断后两位', a.format('YY'), '26'),
    eq('YYYY 补零到四位', d('5026-08-28').format('YYYY'), '5026'),
    eq('13 点的 a 是 pm', a.format('a'), 'pm'),
    eq('字面量方括号逃逸', a.format('[YYYY]'), 'YYYY'),
    eq('YYYY 带非格式后缀正常', a.format('YYYY!'), '2026!'),
    includes('REGEX_FORMAT 匹配方括号', 'src/constant.js', 'REGEX_FORMAT = /\\[([^\\]]+)]|YYYY|YY'),
    includes('替换回调用 $1 优先', 'src/index.js', "(match, $1) => $1 || matches(match) || zoneStr.replace(':', '')")
  ]])
}

// ch07 locale 注册表
{
  const before = d('2026-08-28').locale() // 'en'
  d.locale(zhCn)
  const afterGlobal = d('2026-08-28').locale()
  const instanced = d('2026-08-28').locale('en')
  d.locale('en') // 还原全局，避免污染后续探针
  chapters.push(['ch07 locale', [
    eq('默认全局语言是 en', before, 'en'),
    eq('dayjs.locale(obj) 切换全局', afterGlobal, 'zh-cn'),
    eq('实例级切换不污染全局（再包一层仍是全局语言）', d('2026-08-28').format('dddd') === 'Friday', true),
    eq('实例切换返回新实例且语言生效', instanced.format('dddd'), 'Friday'),
    eq('未加载的语言码（xx-yy）静默回落保持英文', d('2026-08-28').locale('xx-yy').format('dddd'), 'Friday'),
    includes('fallback 用 split 拆语言码', 'src/index.js', "const presetSplit = preset.split('-')"),
    includes('Ls 注册表初始化只装 en', 'src/index.js', "Ls[L] = en")
  ]])
}

// ch08 插件协议
{
  const probe = (await import(src('src/plugin/weekOfYear/index.js'))).default // 同 URL 动态导入返回同一模块实例
  chapters.push(['ch08 插件', [
    eq('extend 之后插件带上 $i 安装标记', (d.extend(weekOfYear), weekOfYear.$i), true),
    eq('再次 extend 同一插件仍幂等（$i 不重置、不重复安装）', (d.extend(probe), probe.$i), true),
    eq('2026-01-01 的 week() = 1', d('2026-01-01').week(), 1),
    eq('插件挂到原型：实例可调用', typeof d('2026-08-28').week, 'function'),
    includes('协议三参数 plugin(option, Dayjs, dayjs)', 'src/index.js', 'plugin(option, Dayjs, dayjs)'),
    includes('$i 幂等标记', 'src/index.js', 'if (!plugin.$i) { // install plugin only once'),
    includes('weekOfYear 拿的是原型', 'src/plugin/weekOfYear/index.js', 'const proto = c.prototype')
  ]])
}

let total = 0, passed = 0
const lines = []
for (const [name, checks] of chapters) {
  let ok = 0
  for (const c of checks) { total += 1; if (c.ok) { passed += 1; ok += 1 } else lines.push(`✗ ${name} ${c.label}: ${c.detail}`) }
  console.log(`  ${name}: ${ok}/${checks.length}`)
}
if (lines.length) console.log(lines.join('\n'))
console.log(`Test Files  ${lines.length ? 0 : chapters.length} passed (${chapters.length})`)
console.log(`     Tests  ${passed} passed${lines.length ? ` | ${total - passed} failed` : ''} (${total})`)
process.exit(lines.length ? 1 : 0)
