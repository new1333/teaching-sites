---
title: locale：L 与 Ls 的一张注册表
---

# locale：L 与 Ls 的一张注册表

一个容易让人怀疑自己眼睛的现象：没有 import 中文语言包时，`dayjs().locale("zh-cn")` 不报错也不生效——静默回落，机制藏在 `split("-")` 里。这一章读 dayjs 的多语言系统：一张全局注册表、一条解析链、两档切换粒度。读懂之后，语言系统的任何「怪现象」你都能推出来。

## 一张表和两个变量

```js
// iamkun/dayjs@0f6c19e:src/index.js
let L = 'en' // global locale
const Ls = {} // global loaded locale
Ls[L] = en
```

全部多语言状态就是这两行：`L` 记「当前默认语言」是谁，`Ls` 是注册表模式（registry pattern，用一张表登记全部可用项、按名取用的组织方式）——键是语言码、值是语言包对象。出生时表里只有英文。所谓「加载语言包」，本质就是往这张表里加一行；所谓「切换语言」，就是改 L 指向谁。没有继承、没有原型链、没有事件——一张纯对象表承担全部状态，查起来也只是属性访问。

语言包长什么样？看中文包的开头：

```js
// iamkun/dayjs@0f6c19e:src/locale/zh-cn.js
const locale = {
  name: 'zh-cn',
  weekdays: '星期日_星期一_星期二_星期三_星期四_星期五_星期六'.split('_'),
```

一个普通对象：自带名字（name，注册表用它做键）、星期与月名数组、序数词函数、weekStart（周从周几起，中文习惯周一）。上一章 `format('dddd')` 从语言包取 weekdays，这一章你看到了数据的家。

## parseLocale：一条带回退的解析链

```js
// iamkun/dayjs@0f6c19e:src/index.js
const parseLocale = (preset, object, isLocal) => {
  let l
  if (!preset) return L
  if (typeof preset === 'string') {
    const presetLower = preset.toLowerCase()
    if (Ls[presetLower]) {
      l = presetLower
    }
    if (object) {
      Ls[presetLower] = object
      l = presetLower
    }
    const presetSplit = preset.split('-')
    if (!l && presetSplit.length > 1) {
      return parseLocale(presetSplit[0])
    }
  } else {
    const { name } = preset
    Ls[name] = preset
    l = name
  }
  if (!isLocal && l) L = l
  return l || (!isLocal && L)
}
```

这条链回答「给一个语言码（或语言包），用哪个」。字符串入参走左边：先查注册表（命中就用）；带了语言包对象就顺带注册；都没命中且码里有连字符，就**去掉后缀递归再试**——`zh-cn` 没加载就试 `zh`。这就是「静默回落」的出处：一条明确的降级路径。但注意递归这行有个容易漏看的细节：`parseLocale(presetSplit[0])` 没有把 isLocal 传下去——回落的终点因此不是「保持实例原语言」，而是可能落回全局默认 L；更微妙的是，若降级目标（如 zh）恰好已注册，这一跳还会顺手改写全局 L。这是常规路径之外、实例切换唯一能影响全局的缝隙，读库时值得用探针亲手验证一遍，而不是想当然。对象入参走右边：直接注册并用它的 name。

最末两行是切换粒度的机关：`isLocal` 为真时只返回结果、不动全局 L。谁传 true？实例方法 `locale()`。

```js
// iamkun/dayjs@0f6c19e:src/index.js
  locale(preset, object) {
    if (!preset) return this.$L
    const that = this.clone()
    const nextLocaleName = parseLocale(preset, object, true)
    if (nextLocaleName) that.$L = nextLocaleName
    return that
  }
```

实例级切换克隆自己、只改克隆的 `$L`——常规路径下全局与实例互不污染：`dayjs.locale(zhCn)` 改默认，`d.locale('en')` 只改这一个实例，而且照例返回新实例（第 4 章的承诺延伸到语言切换）。唯一的例外就是上一段说的递归回落那道缝。构造函数里那句 `parseLocale(cfg.locale, null, true)` 同理——出生时解析语言但绝不动全局。

## 为什么不做「完整 i18n 系统」

读到这里你可能会问：为什么不内置全部 143 个语言包？为什么没有 Intl 集成、没有复数规则引擎？答案藏在包体积的定位里——dayjs 以 2KB 为设计上限，语言包按需加载、插件按需安装，注册表只负责「来了就登记」而不负责「替你决定要什么」。这与 moment 时代「全量内置 + locale 全局单例」的方案形成鲜明对照：moment 切语言是全局副作用，dayjs 把全局与实例两档切换分开、默认全部惰性。小，不是少做功能，是每个机制都停在最小完整形态。

这张注册表还顺带解释了一个工程事实：语言包文件互相独立、结构相同（一个带 name 的普通对象），所以社区贡献一个新语言只需提交一个文件、零内核改动——好数据结构自带贡献指南。你设计任何「可扩展集合」时，想想 Ls 这张表：状态一个纯对象、解析一条链、写入一个入口，扩展面就此收敛。

## 验证：亲手跑探针

```bash
cd companion && npm test   # ch07 组 7 条断言
```

探针按「全局切换、实例隔离、静默回落」三幕验证：默认 en、传对象切全局得 zh-cn、实例切换后全局仍是切换值、实例切英文 format 出 Friday、未加载的 `xx-yy` 静默保持英文；结构断言核对 split 回退与 `Ls[L] = en` 初始化。动手部分：把 zh-cn 语言包 import 后全局切换，再 `format('dddd')`，亲眼看星期名从 Friday 变星期五——然后只给某个实例切英文，确认其他实例不受影响。

## 小结与自查

多语言 = 一张注册表（Ls）+ 一个默认指针（L）+ 一条带回退的解析链（parseLocale）+ 一个 isLocal 开关分出全局与实例两档切换。静默回落是设计而不是疏忽：语言码天然分层（zh-cn → zh），注册表查不到就往上层降级。下一章是本课最后一个机制，也是这套简洁设计的最大受益者：插件系统如何拿到「类 + 工厂 + 工具集」三张通行证。

- 自查一（预测）：全局语言是 zh-cn（未单独注册 zh）、实例语言是 en 时，`inst.locale('zh-TW')` 之后实例是什么语言？

<details><summary>看答案</summary>

zh-cn——zh-TW 降级试 zh 落空，l 为空，最终回落到全局默认 L（zh-cn），而不是保持实例原语言 en；根因是递归调用丢了 isLocal（回查解析链一段的细节）。可以再推一步：若 zh 已单独注册，这次调用还会把全局 L 改成 zh——用探针验证这两条。

</details>

- 自查二：为什么构造函数调用 parseLocale 要传 `isLocal = true`？

<details><summary>看答案</summary>

实例出生只应解析自己的语言，不应顺手改掉全局默认——每个 Dayjs 的构造都改全局会是灾难（回查「最末两行」一段）。

</details>

术语见[术语表](./glossary)；文件索引见[源码地图速查](./source-map)。
