---
title: 每一行增删的来历:diff 算法
---

# 每一行增删的来历:diff 算法

挪动一段代码,git diff 的答案常常不是你想的那个。你把三行函数从文件中部搬到文件尾,屏幕亮出来的是删三行加三行——同样的三行,红一遍绿一遍,「挪动」两个字只字未提。另一种熟悉的别扭:两处隔着好几行的小改,有时各报各的,有时却被合并成一个大块,还捎带上十几行你根本没碰过的上下文。红绿行的取舍看上去没有规律,像 git 心血来潮。

这些行到底是按什么规则算出来的?前两部分攒下的零件里,其实还轮不上回答这个问题——第 5 章的三态对比只能告诉你 a.txt 是「修改」,改动发生在文件内部,它一个字节都看不到。更要紧的是第 1 章埋下的那句话,当时证伪「git 存的是增量 diff」用的原话是:「省空间的秘诀不是『只存差异』,是『内容没变就沿用旧对象』。」快照模型自始至终没存过任何差异。那 git diff 每次输出的红绿行从哪来?只剩一个可能:每次都从两份完整快照之间现算。第三部分就从这个「现算」进场——会算差异,后面的合并才有裁判。第 6 章末尾欠的两笔账(detached HEAD 那笔游离提交的命运、refs 目录里那份引用清单上桌)分别在后面讲提交图上的祖先与协议握手时收,不归本章。

本章拆三层。先立规则:怎样的差异描述才算「最少」,行在其中的地位。再拆算法:最长公共子序列凭什么给出最少操作,拿纸笔推一遍动态规划。最后定格式:unified diff 的 @@ 头与上下文行各守什么,「合并成一个大块」的机关在哪。落进 mini-git,是 src/diff.ts 三个函数加一条 diff 命令,金样与真 git 对拍固化。

## 行是原子:先说清什么叫「最少」

比较两段文本,第一步不是算法,是定义。把旧文本 A 变成新文本 B,描述这个变化的说法有无穷多种:可以只说「改了第 2 行」;也可以说「删掉全部内容,重打一遍」;还可以说「删掉全部,重打一遍,再把标题行删了重加一次」。如果没有一个客观标准,「diff 算得准不准」就无从谈起——三种说法都对,只是啰嗦程度不同。git 采用的标准是最少操作:在只允许「删一整行」和「加一整行」两类动作的前提下,找出操作条数最少的那份描述。这个标准定下来,答案就唯一可算了(平手时再按固定偏好选,后面会看到)。

本章第一个新词由此登场。**编辑脚本(edit script)——把文本 A 变成文本 B 的一份操作清单,每条指令要么删掉 A 的某一行,要么插入 B 的某一行;行数最少的那份脚本,就是 diff 的算法产物。**注意定义里的主语和宾语:脚本的原子是行,不是字符。一行里改一个字母,在编辑脚本里也是「删整行、加整行」两条指令——整行换。

「diff 是逐字符比较的」——这个流传很广的直觉,值得先替它说句公道话。字符级的比较工具你天天在用:拼写检查的红波浪线、编辑器 merge 冲突时的单词高亮,都是字符粒度;git 自己也有 `--word-diff` 开关,把一行内的改动再拆到词。所以「比较=比字符」是个有真实出处的默认期待。恰好不成立的地方在粒度的选择上:git diff 的默认粒度是行,一行是它眼里不可拆的原子。这不是能力不济,是选择——行的长度不固定、边界清晰,「一行变了」对人和对补丁程序都是干净的信号;至于行内到底动了哪个词,那是另一层再加工。后果却很实在:改一个字母,整行红整行绿;行尾多打一个空格,也是整行换。

「diff 会理解代码语义,所以知道该挪哪块」——第二个直觉,公道话同样说得通。IDE 重构时确实会提示「检测到代码移动」,git 也有 `--color-moved` 选项把挪动过的行涂成另一种颜色,「diff 认得挪动」的印象有真实来源。边界在于:那些都是行级 diff 算完之后的再加工——先算出删三行加三行,再回头检查删的和加的是不是同一批行,是就换个颜色。核心算法从头到尾不理解函数、不理解语句,它只认行的文本。把三行工具函数从文件中部挪到文件尾,亲手跑一遍就知道:

```text
# 用法示例 · 挪动三行,真 git 的回答
$ git -c core.autocrlf=false diff --no-index mv-old.txt mv-new.txt
diff --git a/mv-old.txt b/mv-new.txt
index f29732f..ef4ae64 100644
--- a/mv-old.txt
+++ b/mv-new.txt
@@ -1,9 +1,9 @@
 a1
 a2
 a3
-M1
-M2
-M3
 z1
 z2
 z3
+M1
+M2
+M3
```

九行的文件,减号行三条、加号行三条,数目分毫不差。算法保住了 a1、a2、a3、z1、z2、z3 六行没动,把 M1 到 M3 判成「旧位置删掉、新位置重来」。「挪动等于等量增删」,这就是行原子性最有名的代价,本章演练与验证都会把它钉死成测试。

## 最长公共子序列:公共行不动,剩下的就是脚本

标准立好了,「最少」怎么算?逐个枚举所有可能的脚本再挑最短,数量是天文数字,走不通。换个角度想:一份编辑脚本把 A 的行分成了两堆——被脚本判定「两边都有、不用动」的公共行,和被判定「删了又加」的行。反过来,只要先找出一份足够长的公共行清单,脚本就是它的直接补集:

- 公共行,一条指令都不花,原样保留;
- A 里不在公共清单中的行,每行一条删指令;
- B 里不在公共清单中的行,每行一条加指令。

设 A 有 n 行、B 有 m 行、公共清单长 L,操作总数就是 (n − L) + (m − L)。要操作最少,就要 L 最大。**最长公共子序列(longest common subsequence,LCS)——两个序列共有的、保持先后顺序的最长子序列;它长一分,编辑脚本就短两条指令,两者互为补集。**「子序列」三个字有讲究:公共行只要求顺序一致,不要求连续。A 是 alpha、beta、gamma、delta,B 是 alpha、gamma。那么 alpha、gamma 是公共子序列:顺序对得上,中间隔着被删的 beta 没关系,长 2。而 beta、gamma 不是——B 里没有 beta。「保持顺序」还排除了另一种贪心:拿行集合的交集当公共清单,顺序对不上时照抄会把文件洗乱。

反事实检验一下这个定义的必要性:假如挑了较短的公共清单,比如只认 alpha 一行,L 从 2 掉到 1,gamma 就得「删一条、加一条」平白多出两条指令。公共清单每短一行,操作数涨两条——「最长」不是形容词,是最少操作的充要条件。

### 纸上算一遍

LCS 怎么求?整个算法就一句话:大问题的答案由小子问题的答案拼成,子问题的答案存进表格,不重算——这套手法叫动态规划,名称知道即可,本章只需要它的表格。规则两条:比较 A 的第 i 行与 B 的第 j 行,相等,答案等于「各自跳过这行」的子问题加一;不等,答案等于「A 跳过这行」与「B 跳过这行」两个子问题里较大的那个。拿刚才的四行对两行当例子,表格从右下角空串起步往左上填,每格填「A 后缀与 B 后缀的 LCS 长度」:

| A\B | alpha | gamma | (空) |
| --- | --- | --- | --- |
| alpha | 2 | 1 | 0 |
| beta | 1 | 1 | 0 |
| gamma | 1 | 1 | 0 |
| delta | 0 | 0 | 0 |
| (空) | 0 | 0 | 0 |

抽查三格。左上角 (alpha, alpha):两行相等,取右下角的 1 再加 1,得 2——以 alpha 开头的两段文本,LCS 是 alpha 加 gamma。(beta, gamma):不等,取「跳过 beta」的 (gamma, gamma)=1 与「跳过 gamma」的 (beta, 空)=0 中较大者,1。(delta, gamma):不等,两边都是 0,填 0。全表填完,左上角的 2 就是总答案:LCS 长 2。

表格还能倒着读出脚本本身。从左上角出发:两行相等就走「保留」,顺带右下移一格;不等就看哪边跳过损失小——下格不小于右格就删 A 的行(往下移),否则加 B 的行(往右移);走到任何一边到头,剩下的一路删或一路加完。(alpha, alpha) 相等,保留 alpha。(beta, gamma) 不等,右格 (beta, 空) 是 0、下格 (gamma, gamma) 是 1,走下,删 beta。(gamma, gamma) 相等,保留 gamma。B 走到头,剩下的 delta 一路删。脚本四条:保留 alpha、删 beta、保留 gamma、删 delta。四行变两行,删两行,LCS 长 2,(4 − 2) + (2 − 2) = 2 条删指令,账目严丝合缝。

这份表格有个绕不开的代价:行数乘行数。四行对两行,15 格;100 行对 100 行,一万格出头,Node 毫秒级;1000 行对 1000 行约一百万格,仍在毫秒到几十毫秒之间。再往上,10 万行对 10 万行是百亿格,内存先撑不住。真 git 默认用的是另一种求最小编辑的算法,叫 Myers,见 [git-diff](https://git-scm.com/docs/git-diff) 的 --diff-algorithm 一节。那里还能换用 patience、histogram 等算法。它的代价主要跟「差异大小」而不是「文件大小」挂钩,常见情形快得多。mini-git 选朴素的动态规划,是为了表格能画在书页上;两者求的都是最小编辑,只在平手处的取舍可能不同。与真 git 对拍逐字符一致有两层边界:最小脚本唯一的用例,怎么选都一样,天然一致;含平手的用例(下面的挪动、后面验证节的改一行),靠的是 mini-git 与真 git 同取「删在加前」的偏好才对上——这层安全边界连同差异口径,登记进附录。

## unified diff 与 hunk:把脚本裁成坐标明确的形状

编辑脚本算出来了,但它自己还不能直接给人看或给程序用。脚本只记改动行,不知道改动发生在文件的哪个地段——「删 beta」在 4 行的文件里好找,在 4000 行的文件里,同样叫 beta 的行可能有十处。渲染层要补的就是坐标,这就长成了本章后半的两个新词。

**unified diff——git 默认的差异输出格式:每个文件一段文件头,正文按改动地段切成若干块,行首的空格、减号、加号分别标上下文行、删除行、新增行。**格式的正本是官方文档 [diff-generate-patch](https://git-scm.com/docs/diff-generate-patch),首现给出处。@@ 头的语法细则出自 [diffutils 手册](https://www.gnu.org/software/diffutils/manual/)。**hunk——unified diff 中一段连续改动的块:一行位置头,加上下文行与增删行。**拿一个七行文件改第三行的输出,逐行标注:

```text
diff --git a/notes.txt b/notes.txt     ← 文件头:两边各是谁(路径前缀 a/ 与 b/)
--- a/notes.txt                        ← 旧一侧来自哪
+++ b/notes.txt                        ← 新一侧来自哪
@@ -1,6 +1,6 @@                        ← hunk 头:旧侧从第 1 行起共 6 行,新侧同样
 title                                 ← 行首空格:两边都有的上下文行
 intro
-body                                  ← 减号:旧文本第 3 行,被删
+BODY                                  ← 加号:新文本第 3 行,新加
 detail
 summary
 outro                                 ← end 没出现:第 3 行改动的 3 行窗口够不到它
```

@@ 头两对数字各是「起点,行数」,旧侧在前、新侧在后,起点从 1 数。这格 hunk 旧侧 6 行 = 前 2 行上下文 + 1 行删除 + 后 3 行上下文,新侧同样 6 行。三这个数字不是 mini-git 发明的,文档 [git-diff](https://git-scm.com/docs/git-diff) 的 -U 选项管的就是它。原话:「The number of context lines defaults to `diff.context` or 3 if the configuration variable is unset」。上下文行数默认 3,可调。diff-generate-patch 对文件头还有一句要紧的规定。原话:「even for a creation or a deletion, `/dev/null` is not used in place of the a/ or b/ filenames」。翻译过来:新建或删除的文件,diff --git 这行照样写真路径;换成空的那一侧,是下面那对 ---/+++ 行里的事。mini-git 照此办理:新文件写 `--- /dev/null`,删光写 `+++ /dev/null`。

@@ 头还有两个边角约定,都出自 diffutils 手册的 Detailed Description of Unified Format 一节——这套格式承自 GNU diff,git 沿用至今。其一,原话「If a hunk contains just one line, only its start line number appears」——一侧恰好只有一行时,「,1」省掉,单行文件互相改动写 `@@ -1 +1 @@`。其二,一侧行数为零时,起点写 0:空文件长出三行,旧侧无行可数,写 `@@ -0,0 +1,3 @@`;反过来整文件删光,写 `@@ -1,3 +0,0 @@`。

「上下文行是随机选的装饰」——第三个直觉,先把公道话讲足。对读 diff 的人,信息量确实全在红绿行,上下文行一没改动二没悬念,看上去就是排版陪衬;有人读 diff 直接跳过它们,也没耽误事。但上下文行干的正是「坐标」这份工,而且量是定死的。@@ 头里的行号只在「文件还停在 diff 生成那一刻」时可靠——补丁晚到几天,文件已经又改过,行号就对不上了。这时靠什么定位?靠上下文行:补丁程序在文件里搜索那几行原样出现的上下文,找到位置,改动落座。行数定为 3 也是给这套搜索留冗余:一两行上下文在文件里容易撞车,三行连续命中,位置基本唯一。所以上下文行不是装饰,是 diff 里最像锚的东西——删掉它们,@@ 头还在,补丁却几乎没法安全应用了。

### 「合并成一个大块」的机关

现在可以正面回答开篇第二个现象了。编辑脚本里,连续的删、加指令构成一个「改动组」,两组之间隔着一段上下文。渲染时每个改动组前后各带至多 3 行上下文——前组的尾巴向间隔里伸 3 行,后组的脑袋往回收 3 行。设两组之间隔着 g 行没变的行:3 + 3 = 6,g 不超过 6,两扇窗口在间隔里相遇,hunk 连成一块。g 达到 7,中间至少剩一行落在两扇窗口之外,谁也不覆盖,hunk 从这里断开,没被覆盖的行一个都不输出。推导链完整走一遍就是:行是原子 → 改动聚成组 → 每组带定长 3 的上下文窗口 → 窗口相连则合并。「相邻两处小改合并成一个大块」不是脾气,是 3 + 3 = 6 这道算术。

## 演练:从红到绿

手术清单先交代。新增 `src/diff.ts`,住四个东西:`splitLines` 把文本拆成行数组,`diffLines` 求编辑脚本,`renderUnified` 渲染 unified,常量 `CONTEXT_LINES` 记着 3。`src/cli.ts` 接一条 diff 子命令,只在文件尾新增 cmdDiff 与两行接线,帮助文本加一段,旧命令一行未动。新增 `tests/diff.test.ts`,二十条。六份旧测试一字未动,其余五个源文件一字未动。

先立只会抛错的骨架,跑全量:

```text
# 用法示例 · 红的关键几行
 × 编辑脚本:diffLines > 挪动三行 = 等量增删:先删后加,条数相等——算法不理解「挪动」(开篇现象)
   → 尚未实现:diffLines
 × unified 渲染:renderUnified > 两处改动隔着 6 行没变的行:上下文窗口相连,合并成一个 hunk
   → 尚未实现:diffLines
 × mini-git diff 命令 > 无参数 = 工作区对暂存区:add 之后再改,红绿行当场可见(金样全文)
   → 尚未实现:splitLines   ← 命令先撞上拆行这只缺牙
 Tests  19 failed | 107 passed (126)
```

十九条红,红因清一色「尚未实现」。绿的那 107 条里,106 条旧测试,外加本章一条——「不认识的开关与多余参数都报用法错误」:它的关口在调用库之前,参数检查自己就能守住。开始填肉。

### diffLines:表格加回溯

算法核心两段,填表和回溯,正好是「纸上算一遍」那节的直译:

```ts
// src/diff.ts · diffLines
export function diffLines(a: readonly string[], b: readonly string[]): EditOp[] {
  const n = a.length
  const m = b.length
  // dp[i][j] = a 的后缀 a[i:] 与 b 的后缀 b[j:] 的 LCS 长度;多一行一列的 0 哨兵
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: EditOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: 'context', aLine: i + 1, bLine: j + 1, text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ op: 'delete', aLine: i + 1, text: a[i] })
      i++
    } else {
      ops.push({ op: 'insert', bLine: j + 1, text: b[j] })
      j++
    }
  }
  for (; i < n; i++) {
    ops.push({ op: 'delete', aLine: i + 1, text: a[i] }) // 尾部多出的旧行:整段删
  }
  for (; j < m; j++) {
    ops.push({ op: 'insert', bLine: j + 1, text: b[j] }) // 尾部多出的新行:整段插
  }
  return ops
}
```

三处对应关系。填表那两行,就是「相等取右下加一,不等取较大」。回溯的 while,就是「相等保留、平手先删后插」。平手判断写成 `>=`,删指令便排在加指令前面——与真 git 输出里减号行在加号行之前是同一种偏好,挪动那个金样(先 -M1M2M3 后 +M1M2M3)靠的就是它。循环外的两段 for 收尾:一边先走完,另一边剩下一路删或一路加,对应「文件尾部整段截掉」和「文件尾部整段追加」。每条指令顺手记下行号——旧侧记 aLine、新侧记 bLine,渲染 @@ 头时不用再回头数。

### renderUnified:分组、开窗、合并

渲染把「合并成一个大块」的机关落成代码,承重的就是中间那个判断:

```ts
// src/diff.ts · renderUnified
export function renderUnified(ops: readonly EditOp[]): string {
  const groups = changeGroups(ops)
  if (groups.length === 0) {
    return '' // 没有改动就没有输出
  }
  const hunks: string[] = []
  let current = groups[0]
  for (let g = 1; g < groups.length; g++) {
    const gap = groups[g].from - current.to - 1 // 两组之间隔着的 context 条数
    if (gap <= 2 * CONTEXT_LINES) {
      current = { from: current.from, to: groups[g].to } // 窗口相连:并进当前 hunk
    } else {
      hunks.push(renderHunk(ops, current))
      current = groups[g]
    }
  }
  hunks.push(renderHunk(ops, current))
  return hunks.join('\n')
}
```

changeGroups 先扫出全部改动组——连续 delete/insert 段的下标区间。然后逐组归并:下一组与当前组间隔 gap 行上下文,gap 不超过 2 × 3 = 6 就并进来,超过就结算当前 hunk、开新的。单组怎么渲染在 renderHunk 里:窗口从组首往回最多裁 3 行、组尾往后最多 3 行,窗口内逐行加前缀,同时数出旧新两侧各自的起点与行数,拼成 @@ 头。条数恰为 1 省掉「,1」、为零写「起点,0」——前面引过的两条约定,都收在这一个函数里。

<details>
<summary>点开看:renderHunk 与 changeGroups(src/diff.ts 渲染的其余两件)。</summary>

```ts
// src/diff.ts · renderHunk
/** 渲染单个 hunk:窗口裁剪、@@ 头计数、逐行加前缀(空格 / - / +)。 */
function renderHunk(ops: readonly EditOp[], group: ChangeGroup): string {
  const from = Math.max(0, group.from - CONTEXT_LINES) // 窗口:改动前至多 3 行上下文
  const to = Math.min(ops.length - 1, group.to + CONTEXT_LINES) // 改动后至多 3 行
  let aStart = 0
  let aCount = 0
  let bStart = 0
  let bCount = 0
  const lines: string[] = []
  for (let k = from; k <= to; k++) {
    const op = ops[k]
    lines.push(`${op.op === 'context' ? ' ' : op.op === 'delete' ? '-' : '+'}${op.text}`)
    if (op.op !== 'insert') {
      // context 或 delete:旧文本里有一条
      if (aCount === 0) {
        aStart = op.aLine
      }
      aCount++
    }
    if (op.op !== 'delete') {
      // context 或 insert:新文本里有一条
      if (bCount === 0) {
        bStart = op.bLine
      }
      bCount++
    }
  }
  lines.unshift(`@@ -${range(aStart, aCount)} +${range(bStart, bCount)} @@`)
  return lines.join('\n')
}
```

计数按「行」不按「指令」:一条 delete 加一条 insert 是两条指令,却只算旧侧一行、新侧一行。range 是那个三行小函数——条数 1 省逗号,条数 0 写全。changeGroups 则是一趟线性扫描,遇到非 context 开组、遇到 context 收组,结尾补收最后一组。

</details>

### diff 命令:两把尺子

命令层只回答一个问题:拿哪两份东西来比。两把尺子的口径,文档 [git-diff](https://git-scm.com/docs/git-diff) 写得明白,量的正是 add 与 commit 之间的两道缝。不带参数,原话是「view the changes you made relative to the index」——看工作区相对暂存区的改动,也就是还没 add 的那部分。--cached 则是暂存区对 HEAD。同页还有一句要紧的:「If HEAD does not exist (e.g. unborn branches) and `<commit>` is not given, it shows all staged changes」。HEAD 还不存在时旧侧当空,全部算新增。mini-git 原样照办:无参数只比暂存区清单里登记过的路径,未跟踪文件不出现;--cached 在 unborn 分支上输出 `@@ -0,0` 的全加号。

```ts
// src/cli.ts · cmdDiff(拼版:省略参数检查与前半,取材部分完整)
const index = new Map(loadIndex(gitDir).map((e) => [e.path, e.hash]))
const blobText = (hash: string): string => readObject(gitDir, hash).body.toString('utf8')

// 两侧的「路径 → 文本」;undefined 表示这一侧没有该文件(新文件 / 被删文件)
let oldSide: Map<string, string | undefined>
let newSide: Map<string, string | undefined>
if (flags[0] === '--cached') {
  const head = resolveHead(gitDir)
  const headFiles =
    head === null
      ? new Map<string, { mode: number; hash: string }>() // unborn:HEAD 这侧是空的
      : flattenTree(gitDir, parseCommit(readObject(gitDir, head).body).tree)
  oldSide = new Map([...headFiles].map(([path, sig]) => [path, blobText(sig.hash)]))
  newSide = new Map([...index].map(([path, hash]) => [path, blobText(hash)]))
} else {
  oldSide = new Map([...index].map(([path, hash]) => [path, blobText(hash)]))
  newSide = new Map()
  for (const path of index.keys()) {
    const abs = join(cwd, path)
    newSide.set(path, existsSync(abs) ? readFileSync(abs, 'utf8') : undefined) // 文件没了 = 整文件删除
  }
}
```

这一段是旧零件的再会面,没有新机制。--cached 的旧侧拿 resolveHead——第 6 章那套符号引用解析——找到 HEAD 提交,再摊平它的 tree;新侧就是暂存区清单里的 blob。无参数一侧,旧侧是暂存区 blob,新侧直接读工作区文件,读不到就是整文件删除。每条路径各自 `diffLines`、`renderUnified`,渲染为空就跳过,不空就加上 diff --git 与 ---/+++ 三行头。读对象那一步也全是老规矩:`blobText` 拿 40 位 SHA-1 对象名,从松散对象里读回 blob、剥掉对象头,剩下的就是文件原文。顺带一提与前两章的反差:index 与 tree 拆的是二进制,十六进制转储与 Buffer 轮番上阵;这一章两边都是纯文本,一个字节都不用直接摸。第 5 章 status 报「修改」的那一跳,从这里起能钻进文件内部看个究竟。

<details>
<summary>点开看:cmdDiff 全文(src/cli.ts,含参数检查与文件头拼装)。</summary>

```ts
// src/cli.ts · cmdDiff
function cmdDiff(cwd: string, args: string[]): string {
  const usage = '用法:mini-git diff [--cached];至多一个开关,不收文件参数'
  const flags = args.filter((a) => a.startsWith('-'))
  const rest = args.filter((a) => !a.startsWith('-'))
  if (rest.length !== 0) {
    throw new Error(`${usage};登记在清单里的文件全比,不按路径筛`)
  }
  if (flags.length > 1 || (flags.length === 1 && flags[0] !== '--cached')) {
    throw new Error(`${usage};mini-git 只认 --cached 这一个开关`)
  }
  const gitDir = requireGitDir(cwd)
  const index = new Map(loadIndex(gitDir).map((e) => [e.path, e.hash]))
  const blobText = (hash: string): string => readObject(gitDir, hash).body.toString('utf8')

  // 两侧的「路径 → 文本」;undefined 表示这一侧没有该文件(新文件 / 被删文件)
  let oldSide: Map<string, string | undefined>
  let newSide: Map<string, string | undefined>
  if (flags[0] === '--cached') {
    const head = resolveHead(gitDir)
    const headFiles =
      head === null
        ? new Map<string, { mode: number; hash: string }>() // unborn:HEAD 这侧是空的
        : flattenTree(gitDir, parseCommit(readObject(gitDir, head).body).tree)
    oldSide = new Map([...headFiles].map(([path, sig]) => [path, blobText(sig.hash)]))
    newSide = new Map([...index].map(([path, hash]) => [path, blobText(hash)]))
  } else {
    oldSide = new Map([...index].map(([path, hash]) => [path, blobText(hash)]))
    newSide = new Map()
    for (const path of index.keys()) {
      const abs = join(cwd, path)
      newSide.set(path, existsSync(abs) ? readFileSync(abs, 'utf8') : undefined) // 文件没了 = 整文件删除
    }
  }

  const sections: string[] = []
  for (const path of [...new Set([...oldSide.keys(), ...newSide.keys()])].sort()) {
    const oldText = oldSide.get(path)
    const newText = newSide.get(path)
    const hunks = renderUnified(diffLines(splitLines(oldText ?? ''), splitLines(newText ?? '')))
    if (hunks === '') {
      continue // 同文本(含两边都没有)不输出
    }
    sections.push(
      [
        `diff --git a/${path} b/${path}`,
        `--- ${oldText === undefined ? '/dev/null' : `a/${path}`}`,
        `+++ ${newText === undefined ? '/dev/null' : `b/${path}`}`,
        hunks,
      ].join('\n'),
    )
  }
  return sections.join('\n')
}
```

</details>

跑全量门槛:

```text
# 用法示例 · 全量门槛
$ pnpm typecheck        ← 无输出即 0 错误
$ pnpm test
 ✓ tests/smoke.test.ts (3 tests)
 ✓ tests/objects.test.ts (18 tests)
 ✓ tests/diff.test.ts (20 tests)
 ✓ tests/trees.test.ts (19 tests)
 ✓ tests/index.test.ts (25 tests)
 ✓ tests/refs.test.ts (19 tests)
 ✓ tests/commits.test.ts (22 tests)

 Test Files  7 passed (7)
      Tests  126 passed (126)
```

二十条新测试分四组。拆行一条:切行、收尾换行与空文件。编辑脚本六条:同一文本全 context、改一行的金样数组、LCS 保序、挪动等量增删、行原子、三个空边界。渲染七条:七行文件的 hunk 金样(前 2 后 3、end 越界不现)、单行省「,1」、尾部追加的窗口回退、空对三行与三行对空、间隔 6 合并、间隔 7 拆开、相同文本空输出。命令六条:两把尺子的金样全文、整文件删除、unborn 全增、干净仓库双口径无输出、多文件排序、参数校验。所有金样在写进测试前先与真 git 对拍(下一节你也来一遍),逐字符一致后才固化。

## 亲手验证:先猜,再跑

开新实验场:

```bash
# 用法示例 · 建 diff-lab
cd ..                                  # 来到课程根(mini-git-ts-course/)
mkdir diff-lab && cd diff-lab
MG=../companion/node_modules/.bin/tsx
CLI=../companion/src/cli.ts
$MG $CLI init
printf 'title\nintro\nbody\ndetail\nsummary\noutro\nend\n' > notes.txt
$MG $CLI add notes.txt
MINI_GIT_TIMESTAMP=1700000000 $MG $CLI commit -m '初稿'
printf 'title\nintro\nBODY\ndetail\nsummary\noutro\nend\n' > notes.txt
```

第一猜,@@ 头的数字。跑之前先在纸上写下三样:旧侧「起点,行数」、新侧「起点,行数」、end 这行会不会出现。然后跑:

```bash
# 用法示例 · 无参数:工作区对暂存区
$MG $CLI diff
# diff --git a/notes.txt b/notes.txt
# --- a/notes.txt
# +++ b/notes.txt
# @@ -1,6 +1,6 @@
#  title
#  intro
# -body
# +BODY
#  detail
#  summary
#  outro
```

对答案:-1,6 +1,6,两侧各 6 行——2 行前上下文、1 行删、1 行加、3 行后上下文;end 不出现,改动在第 3 行,往后数 3 行窗口只到 outro。你写下的数字要是「-1,7 +1,7」,多半是把窗口当成了「整个文件」。窗口只裁改动附近,这正是 diff 比整文件对照短的原因。看完了把这一改收进暂存区,免得后面几猜的输出混进旧账:

```bash
# 用法示例 · 收进暂存区:worktree 与 index 重新一致,diff 归零
$MG $CLI add notes.txt && $MG $CLI diff
# (无输出)
```

第二猜,挪动。九行文件搬三行:

```bash
# 用法示例 · 挪动三行,等量增删
printf 'a1\na2\na3\nM1\nM2\nM3\nz1\nz2\nz3\n' > mv.txt
$MG $CLI add mv.txt
printf 'a1\na2\na3\nz1\nz2\nz3\nM1\nM2\nM3\n' > mv.txt
$MG $CLI diff
# diff --git a/mv.txt b/mv.txt
# --- a/mv.txt
# +++ b/mv.txt
# @@ -1,9 +1,9 @@
#  a1
#  a2
#  a3
# -M1
# -M2
# -M3
#  z1
#  z2
#  z3
# +M1
# +M2
# +M3
```

先猜减号几行、加号几行、顺序谁前谁后。对答案:各三行,减号在前——「删三行加三行」逐字兑现,输出里没有任何「移动」字样。算法保住了前后共六行,把挪动的三行判成旧位置删、新位置加。照例收尾:

```bash
$MG $CLI add mv.txt                       # 下一猜从干净的暂存区出发
```

第三猜,合并的门槛。动手前先押两个答案:改第 2 行和第 9 行(中间隔 6 行没变的行),diff 出几个 hunk？改成第 2 行和第 10 行(隔 7 行)呢——几个 hunk、第二个的起点是第几行？押完再跑。

```bash
# 用法示例 · 间隔 6 行:一个 hunk 还是两个?
for i in $(seq 1 20); do printf 'L%02d\n' "$i"; done > list.txt
$MG $CLI add list.txt
cp list.txt list.old.txt                  # 留一份旧版,等下请真 git 对拍
sed -i -e 's/^L02$/CHANGED-A/' -e 's/^L09$/CHANGED-B/' list.txt
$MG $CLI diff | grep '^@@'
# @@ -1,12 +1,12 @@                       ← 一个 hunk,六行间隔被上下文缝上了
```

间隔拉到 7 行的版本改第 2 行和第 10 行。清单里登记的还是原版,直接重写工作区文件:

```bash
# 用法示例 · 间隔 7 行:窗口够不着,拆开
for i in $(seq 1 20); do
  case $i in
    2) printf 'CHANGED-A\n' ;;
    10) printf 'CHANGED-B\n' ;;
    *) printf 'L%02d\n' "$i" ;;
  esac
done > list.txt
$MG $CLI diff | grep '^@@'
# @@ -1,5 +1,5 @@
# @@ -7,7 +7,7 @@
```

对答案:隔 6 行,一个 hunk,整块从第 1 行数到第 12 行。隔 7 行,两个 hunk,后一个从第 7 行起——改动在第 10 行,往前收 3 行窗口。请真 git 来对拍,它算的也是同一对文件:

```bash
# 用法示例 · 真 git 对拍同一对文件
git -c core.autocrlf=false diff --no-index list.old.txt list.txt | grep '^@@'
# @@ -1,5 +1,5 @@
# @@ -7,7 +7 +7,7 @@ L06                  ← 多了个尾巴,见下
```

hunk 的切分与数字完全一致。真 git 多出的两样,都是它比 mini-git 多做的事。每段前面有 index 一行,记着两侧的 blob 名。@@ 尾巴上可能挂一个 L06,那是「这段改动落在哪个函数」的提示——diff-generate-patch 文档写明的功能,靠语言规则从上文猜。mini-git 两样都不做,连同不认 -U 调上下文、不做二进制检测、假定文件以换行收尾(真 git 会补一行 `\ No newline at end of file`),一并登记进差异附录。

第四猜,定向破坏。指认一处:src/diff.ts 的 renderUnified 里,合并判断那行 `if (gap <= 2 * CONTEXT_LINES)`,把阈值改小一行——`2 * CONTEXT_LINES` 改成 `2 * CONTEXT_LINES - 1`。行拆分、diffLines 的填表与回溯、命令层,全部不碰。先写下预测:pnpm test 红几条?「间隔 7 行拆开」那条红不红?「参数校验」那条呢?跑。

对答案:恰好 1 条红——「间隔 6 行合并成一个 hunk」那条,它守的正是 3 + 3 = 6 这道算术边界。阈值改成 5,隔 6 行的窗口被判成够不着,单 hunk 金样对不上。不红的有三层。间隔 7 拆开那条,守的是「够不着就别硬连」,阈值改小只会让更多组拆开,拆的方向它乐见。挪动那条守的是编辑脚本本身,断言根本不过渲染这一关——即便渲染,它的间隔只有 3 行,也在改小后的阈值内。七行金样、命令那批,文件里只有一个改动组,连合并判断都轮不到执行。参数校验守在 CLI 关口,与渲染无关。把阈值改回去,126 条全绿,复原确认。

## 收束:diff 是现算的,规则只有两条

三个反直觉现象,一个根源。挪动显示成删三行加三行,因为 diff 以行为原子、只认行的文本——算法眼里没有「挪」,只有旧位置的三条删指令和新位置的三条加指令,合起来已是最少操作。相邻小改合并成一个大块,因为每个改动组前后各带定长的 3 行上下文窗口,间隔不超过 6 行时两扇窗口相遇——是算术,不是脾气。而这些红绿行谁也没存在对象库里。第 1 章说过,对象库靠内容寻址存全量快照;diff 每次都从两份完整文本之间现算。LCS 是公共行,补集是编辑脚本,渲染只负责把脚本裁成带坐标的形状。mini-git 的 status 从此有了下文:同一声「修改」,现在能钻进文件内部,数出每一行的来历。

本章进门的零件:四个词——编辑脚本、最长公共子序列、unified diff、hunk。一个新文件 src/diff.ts,splitLines、diffLines、renderUnified 三个函数加一个常量。一条命令 diff,带两把尺子:无参数量「工作区对暂存区」,--cached 量「暂存区对 HEAD」。日用层至此凑齐四条——add、status、commit、diff;另一头,hash-object 那批底层命令依旧在岗。一串从简口径已在正文就地声明:不做 index 行与函数名提示、上下文固定 3、不比文件模式、无二进制检测、文件尾假定有换行,差异附录集中登记。

留一笔账在这里。diffLines 吐出的编辑脚本,你今天只拿它当红绿行读;但这份脚本里睡着另一份身份——一张行对齐账:旧文本第几行对上新文本第几行,哪些行是单侧新增,一清二楚。等到第 9 章写三方合并,裁判就是它:base 对 ours 算一张账,base 对 theirs 算一张账,两张账对一对,「哪行只有一侧动过」当场判定。自动合入还是冲突标记,乃至最后落成的那笔带两个父提交的 merge,全看这张账。到时候 diff 就不止用来给人看了——你现在写下的 diffLines,就是那章合并算法的心脏。

三道换情境的题,答案押在纸上再展开;卡住了按提示回查。

<details>
<summary>1. 同事说他这回改了 40 行,git diff 只报一个 hunk;上一回只改了 6 行,反倒蹦出两个。按本章机制,hunk 的个数由什么决定?想让总行数更少,真 git 有什么办法?</summary>

hunk 个数与改动行数是两回事:个数由改动组分几处决定。40 行聚在一个改动组,就是一个 hunk,@@ 头写成 -a,44 +c,44 之类的形状,一个块全装下;6 行拆在相隔 7 行以上的两处,就是两个 hunk。想让总行数更少,真 git 的 -U1 把上下文从 3 行压到 1 行,窗口更容易断开,hunk 更碎但行数更省。mini-git 的 CONTEXT_LINES 固定 3,做不到,这条已登记差异附录。回查「unified diff 与 hunk」与「合并成一个大块」两节。
</details>

<details>
<summary>2. 把 diffLines 回溯里的平手判断 `>=` 改成严格大于 `>`,本章的「改一行」与「挪动」两个金样会怎么翻面？哪类输出完全不受影响？</summary>

翻面有两层。「改一行」金样里 beta 对 BETA 的那处分岔恰好打平,平手翻向后,+BETA 排到 -beta 前面。挪动金样翻得更彻底:算法改判「被挪的是 z 组」——+z1 +z2 +z3 插在中部,-z1 -z2 -z3 收在尾上,仍是等量增删。操作总数一条不变,两条路径的 LCS 长度相同,这正是「最小脚本不唯一、平手按偏好选」的实例。完全不受影响的是无平手用例:分岔处优劣严格,比如纯删一行、文件尾整段追加,脚本唯一,输出一字不动。这也是 mini-git 与真 git 在极端构造的用例上可能差一口气的原因,差异附录登记在案。回查「纸上算一遍」与 diffLines 小节。
</details>

<details>
<summary>3. 一个 2000 行的文件对另一个 2000 行的文件跑 mini-git diff,表格多大？两个文件只在头尾各差一行时,真 git 为什么通常快得多？</summary>

dp 表约 2001 × 2001,四百万格出头,毫秒量级——mini-git 照样算得动,代价跟「文件多大」走。真 git 默认的 Myers 算法,代价主要跟「差异多大」走:头尾各差一行,差异极小,它近乎沿着对角线直穿两张表,不用把四百万格填满。mini-git 选填全表,是拿表格可画在书页上换的,这笔账正文里换算过体感。回查「最长公共子序列」一节的代价段。
</details>
