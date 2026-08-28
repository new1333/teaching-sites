---
title: format：一次正则替换的全文翻译器
---

# format：一次正则替换的全文翻译器

`YYYY-MM-DD` 你大概天天写，但这段字符是怎么被逐段翻译出来的？答案优雅得有点意外：整场格式化就是一次 `String.replace`，配合一条精心设计的正则。这一章把这次替换拆开看，顺便解决两个常见疑问——`[YYYY]` 为什么能原样输出、下午一点的 `a` 为什么是小写 pm。

## 占位符替换的主干

占位符替换（token replacement，用正则逐段匹配格式串里的占位符并换成对应值的格式化方式）。它在 dayjs 里的全部骨架是三段：

```js
// iamkun/dayjs@0f6c19e:src/constant.js
export const REGEX_FORMAT = /\[([^\]]+)]|YYYY|YY|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g
```

```js
// iamkun/dayjs@0f6c19e:src/index.js
    const matches = (match) => {
      switch (match) {
        case 'YY':
          return String(this.$y).slice(-2)
        case 'YYYY':
          return Utils.s(this.$y, 4, '0')
        case 'M':
          return $M + 1
        case 'MM':
          return Utils.s($M + 1, 2, '0')
        case 'MMM':
          return getShort(locale.monthsShort, $M, months, 3)
        case 'MMMM':
          return getShort(months, $M)
        case 'D':
          return this.$D
        case 'DD':
          return Utils.s(this.$D, 2, '0')
        case 'd':
          return String(this.$W)
        case 'dd':
          return getShort(locale.weekdaysMin, this.$W, weekdays, 2)
        case 'ddd':
          return getShort(locale.weekdaysShort, this.$W, weekdays, 3)
        case 'dddd':
          return weekdays[this.$W]
        case 'H':
          return String($H)
        case 'HH':
          return Utils.s($H, 2, '0')
        case 'h':
          return get$H(1)
        case 'hh':
          return get$H(2)
        case 'a':
          return meridiemFunc($H, $m, true)
        case 'A':
          return meridiemFunc($H, $m, false)
        case 'm':
          return String($m)
        case 'mm':
          return Utils.s($m, 2, '0')
        case 's':
          return String(this.$s)
        case 'ss':
          return Utils.s(this.$s, 2, '0')
        case 'SSS':
          return Utils.s(this.$ms, 3, '0')
        case 'Z':
          return zoneStr // 'ZZ' logic below
        default:
          break
      }
      return null
    }

    return str.replace(C.REGEX_FORMAT, (match, $1) => $1 || matches(match) || zoneStr.replace(':', '')) // 'ZZ'
```

工作机制一句话：`str.replace(全局正则, 回调)`，每匹配一段占位符就调一次 `matches`，switch 查表给值。至于「不认识的占位符原样输出」，成因要分两层说清：正则根本不认识的字符（比如 Q）压根不会被匹配，replace 自然跳过、原文就此保留；而查表落空（default 返回 null）走的则是另一条路——短路链继续降级到兜底档。default 的真实用户是 ZZ：正则的 Z{1,2} 能匹配两个 Z，switch 里却只有 case 'Z'，于是 ZZ 查表落空、落到第三档 `zoneStr.replace(':', '')`，输出 +0800 这样的无冒号偏移。查表落空不是「保留原文」，是「降级兜底」。值的来源全是第 3 章的 `$` 缓存（`Utils.s` 是补零工具，`slice(-2)` 截 YY 的后两位）。语言相关的占位符（月名、星期名）经 `getShort` 从语言包取，取不到就全名切片——语言包只需提供它有的字段。

## 两个疑问的答案

**方括号为什么能逃逸？** 正则的第一个分支 `\[([^\]]+)]` 优先匹配方括号对并捕获内容，回调里的 `$1` 非空时直接返回捕获组——于是 `[YYYY]` 整段（连方括号）被替换成里面的字面量 `YYYY`。`$1 || matches(match) || ...` 这个短路顺序就是优先级：字面量 > 占位符 > 时区 ZZ。

**下午一点的 a 为什么是小写？** `a` 和 `A` 共用一个 meridiem 函数，第三参 isLowercase 控制；语言包没提供 meridiem 时用内置兜底（`hour < 12 ? 'AM' : 'PM'` 再按需转小写）。顺带注意 12 小时制的算法：`$H % 12 || 12`——0 点和 12 点都归 12，这是 12 小时制的经典陷阱，一行表达式处理完。

## 为什么不自己写循环

一个自然的疑问：为什么不用 split 加循环逐段拼接？试试就知道：占位符可以紧贴（YYYYMMDD）、可以藏在字面量中间、方括号还要成对逃逸——手写状态机几十行起步，而正则一条分支全办了。replace 的回调签名天然给出「捕获组 + 完整匹配」双通道，方括号逃逸与占位符查表共用一次扫描。dayjs 全库没有一处手写 parser，字符串的事全交给正则。识别这种「用对原语」的品味，比学会任何单个技巧更能提升你自己的代码——它决定你写出来的库是五十个函数，还是一个 switch、一条正则、一次 replace。

另一处藏着品味的地方是 `getShort` 的兜底链：`arr && (arr[index] || arr(this, str)) || full[index].slice(0, length)`——语言包给了短名就用短名，给了函数（某些语言的序数词与语境相关）就调函数，什么都没给就全名切片。三个层级一个表达式，语言包的作者只需提供自己有的字段。好的扩展点不是接口多，是缺省合理。这条兜底链还有个隐藏收益：en 语言包故意不提供 weekdaysShort 与 monthsShort（源码注释原话「We don't need ... in en.js locale」），全靠切片兜底。内核自己就是自己扩展机制的第一用户，缺省层的正确性天天被默认路径检验着。读到这种「自食其力」的设计，基本可以判断扩展点是真实用过的，而不是画给社区看的大饼。

## 验证：亲手跑探针

```bash
cd companion && npm test   # ch06 组 7 条断言
```

探针验证：YY 截断为 26、YYYY 补零、13 点的 a 是 pm、`[YYYY]` 输出字面量、带非占位符后缀的串正常；结构断言确认 REGEX_FORMAT 的方括号分支与回调的三级短路顺序。动手部分：在 node 里试 `format('[今天] YYYY')`，再用 `format('ZZ')` 观察 default 分支的兜底输出（先猜它是字面量 ZZ 还是 +0800 形态，再跑）。还剩一个没讲的占位符 Z 与 ZZ：去源码里找 zoneStr 的来源（Utils.z），对照时区偏移的正负号约定，补全你自己的占位符速查表——速查表见附录[源码地图速查](./source-map)。

## 小结与自查

format = 一条正则 + 一张 switch 查表 + 一次 replace：字面量逃逸靠捕获组优先，占位符查表；正则不认识的原样保留，查表落空的 ZZ 走兜底链。它没有循环拼接、没有分词器——用语言自带的原语把事情做完，是这个小库一贯的口味。到这里，单个实例从构造、解析、缓存、不可变到输出的完整链路你都读过了；下一章开始看它如何融入多语言世界，第 8 章看它如何被生态扩展。

- 自查一（预测）：`dayjs('2026-08-28').format('ZZ')` 输出什么？为什么不是字面量 ZZ？

<details><summary>看答案</summary>

形如 +0800 的无冒号偏移。Z{1,2} 匹配了 ZZ、查表只有 case 'Z'，落空后短路链降级到兜底档——注意与「正则不认识所以原样保留」区分（回查工作机制一段的两层成因）。

</details>

- 自查二：为什么 `YY` 用 `slice(-2)` 而不是 `substring(2)`？

<details><summary>看答案</summary>

三位数年份（如 5026）取后两位，从尾部截对任何位数都正确，从前部截假设了长度（回查 YY 分支）。

</details>

术语见[术语表](./glossary)；文件索引见[源码地图速查](./source-map)。
