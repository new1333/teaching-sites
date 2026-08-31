---
title: 合并:以 base 为裁判的三方对齐
---

# 合并:以 base 为裁判的三方对齐

合并这件事,十回里有九回是在你背后自动完成的。你在 main 上敲一句 git merge dev,回车还没落,合并已经办完:两边的提交都进了新历史,文件里该有的改动一样不少,全程没人问过你。第十回画风突变:合并停在中途,再打开那个文件,代码中间糊着三行怪符号——<<<<<<< 打头,======= 居中,>>>>>>> 收尾,你的版本和同事的版本各占一边,谁也不肯让。这三行不是谁手滑敲进去的,是 git 亲手写进文件的。

它平时替你做主,凭的是什么?那九次它凭什么敢,这一次凭什么不敢?

答案的前两块零件,前两章都埋好了位置。第 7 章末尾留过一笔账。原话是:「这份脚本里睡着另一份身份——一张行对齐账:旧文本第几行对上新文本第几行,哪些行是单侧新增,一清二楚」。去处也点名了:「等到第 9 章写三方合并,裁判就是它」「你现在写下的 diffLines,就是那章合并算法的心脏」。本章第一件事,就是把这张账铺开用起来。

第二笔是第 8 章的旧账,原话是:「第 9 章的三方合并,裁判要的 base 就是 mergeBase 的返回值,判定表里『互不包含』的那个格子,该填上真合并的算法了。」base 怎么当裁判、互不包含的格子填什么,本章一并交卷。

本章三步走。先讲清为什么合并非要三份文本不可,少一份就判不动。再把行对齐账折算成一张判定表,把自动与冲突的分界线画死。最后落进 mini-git:src/merge.ts 的三个函数加一条 merge 命令,产物与真 git 逐字符对拍。

## 少一份底稿,就少一分证据

设想最寒酸的合并器:手里只有两个版本的文件,别的什么都没有。同一个位置,ours 写 left,对侧写 right——留哪个?翻遍这两份文本也找不出答案,因为「该留哪个」的证据根本不在文本里。版本新旧?两个都是刚改的。行多者赢?没有这种道理。这不是算法不够聪明,是信息不足:两份文本只能告诉你「不一样」,说不出「谁改的、各自改了什么」。

第三份文本补上的正是证据,这份底稿有个名字,第 8 章已经见过:base。有了它,「谁改了什么」立刻可判。底稿写着 left、ours 改成 LEFT、对侧原样——这行动过的人只有 ours;两边都写成同一个新样子——不谋而合;ours 写 LEFT、对侧写 RIGHT——两边都动过,证据到此为止。本章的主角由此登场。**三方合并(three-way merge)——以一份双方共同的老底为基准,分别算出两侧各自的改动;单方改过的自动采纳,双方动到同一处的交还给人。**两侧有名字:ours 是你所在的一侧,通常是 HEAD;theirs 是被合进来的一侧。这对名字不是抽象代称——它们就是冲突标记两翼那两个标签的原文,验证节你会亲眼看到。

反事实检验一下底稿的必要性:假如没有 base,合并器只剩两条路——要么每一处异文都报冲突,那九次顺利的合并也会全炸;要么按某条猜测规则悄悄选边,改动无声丢失。有了 base,「自动合入」才有正当性:采纳的每一行,背后都站着「只有一侧动过」这条证据。

base 从哪来,第 8 章已经备好答案:提交图上两边只要同源,最近公共祖先就是那份谁也没偏袒的老底,mergeBase 一问便知。第三部分至此闭合成环:第 7 章会算改动,第 8 章会在图上找到老底,本章把两者接起来判案。至于两段历史根本不同源、mergeBase 返回 null 的情形,mini-git 当场报错——没有底稿就没有裁判,这个结论在上面已经推过了。

## 行对齐账:编辑脚本的第二职业

第 7 章的 diffLines 吐出一串编辑脚本:context、delete、insert 三种指令,由最长公共子序列回溯而来。当时这串脚本只被渲染成 unified diff 的 hunk 给人看;这一章它直接上岗干活。所谓行对齐账,就记在脚本的行号里:哪几行两边都有、哪些行单侧出现,账目一清二楚。

先看账怎么折。以 base 的行为轴,对一侧算一次 diffLines,把一段连续的删、插指令折算成一个「改动区」:base 第 from 行起(含)、第 to 行(不含)被替换成了 lines 那几行。纯插入没有吃掉任何 base 行,from 与 to 相等,是个零宽的区。区与区之间,必隔着至少一行没动过的 base 行。

拿纸折一遍。底稿七行 one 到 seven;ours 把第 2 行的 two 改成 TWO-OURS。diffLines 给的脚本是:保留 one、删 two、插 TWO-OURS、保留 three 到 seven。中间三条连续的非保留指令折成一个区:`{ from: 1, to: 2, lines: ['TWO-OURS'] }`。换 theirs 来记账:它在第 2 行后面插了一行 INSERTED,脚本折算成 `{ from: 2, to: 2, lines: ['INSERTED'] }`——零宽,意思是「落在第 2 行与第 3 行之间」。

两张账并排一比,判定表就长出来了:

| ours 的账 | theirs 的账 | 判决 |
| --- | --- | --- |
| 无区 | 无区 | base 行原样保留 |
| 有区 | 无区 | 采纳 ours |
| 无区 | 有区 | 采纳 theirs |
| 动 A 区 | 动 B 区,两区之间隔着 ≥1 行没动的 base 行 | 两边都采纳 |
| 动了 | 动得一模一样(同区同稿) | 采纳一份 |
| 动了 X 区 | 也动了 X 区,相触或交叠 | 冲突,写标记 |

前四行就是「自动完成」的全部机关。合并不理解代码,它只对账:结果里每一行都有出处——要么没人动过,要么只有一侧动过,要么两侧动的地方分得开。第五行是两个人的默契,一份就够。真正的疑问在最后一行的分界:为什么挨着不行,非要中间隔一行没动的?

拿刚才折出的两张真实账目来审。ours 的区是 [1,2)(换掉第 2 行),theirs 的区是 [2,2)(插在第 2 行后面)。两区没有共享任何 base 行,按「只看交叠」的直觉似乎能自动合。但「插在第 2 行后面」这句话已经悬空了:第 2 行被 ours 换掉了,「后面」指旧第 2 行的后面,还是新第 2 行的后面?两种读法产出的文件不同,而且都说得通。合并器若硬挑一种,结果就依赖它内部先应用哪一侧——换个实现、换个次序,同一个仓库合出两份稿子。反过来,两区之间只要隔一行没动的 base 行,两处改动的位置在对方应用前后都不变,先算谁后算谁结果相同:交换律成立,自动采纳才是安全的。**所以边界只有一条:严格在前才自动,相触即冲突。**

这条边界不是 mini-git 的发明。真 git 的合并用的也是同一口径。官方手册只规定了冲突标记长什么样,没写判定边界;这条线是我们拿「替换紧挨插入」一类的用例与真 git 对拍钉下来的。对拍的结论:mini-git 相触即冲突,真 git 也冲突,连冲突块的内容都逐字符一致。验证节你会亲手再钉一遍。

## 七个字符的判决书

判定表判到冲突,接下来是把冲突写成人和工具都认得的样子。格式的正本在官方文档 [git-merge](https://git-scm.com/docs/git-merge) 的「HOW CONFLICTS ARE PRESENTED」一节。原话拆两截读。前半:「The area where a pair of conflicting changes happened」——一对相冲突的改动所在这块地方。后半:「is marked with markers `<<<<<<<`, `=======`, and `>>>>>>>`」——用这三个标记围出来。三个标记各七个字符,长得刻意扎眼:正常代码里不会连排七个小于号,谁一眼都能扫到。同节还交代了两侧的归属,原话也拆两截。前半:「The part before the `=======` is typically your side」——中线之上是你的版本。后半:「and the part afterwards is typically their side」——之下是对方的版本。本章第二个新词就此落定。**冲突标记(conflict marker)——合并器写进冲突现场的三行围栏:七字符开栏、七字符中线、七字符收栏,把两侧各自的改稿原样圈在一起。**

落到文件里,七行底稿两侧改了同一行之后,冲突现场长这样:

```text
教学示意 · 同一行双侧双改的冲突块(演练与验证都拿它当金样)
one
<<<<<<< HEAD
TWO-OURS
=======
2-THEIRS
>>>>>>> dev
three
four
five
```

栏上与栏下的标签,口径要当场钉死。文档示例里两翼写的是 yours、theirs 一类的示例名;今天真 git 实际写什么,拿实机对拍最可靠。在分支上做合并,ours 侧恒写 HEAD 这个字面量,不是分支名。theirs 侧写 merge 参数的原文:给分支名就写分支名,给 40 位哈希就写全 40 位。mini-git 照此办事,mergeBlobs 收一对标签参数,命令层固定传 `{ ours: 'HEAD', theirs: target }`——你在终端敲的是谁,收栏上就写谁。

「冲突是 git 算错了」——这条直觉先得一句公道话。冲突出场的方式确实像故障:终端打着 CONFLICT 字样、命令以失败收场、构建变红,和编译错误同等待遇;教程也总在教「减少冲突」,听感上它是该消灭的东西。但把判定表倒过来看,冲突恰恰是算对了的那一格:双方都动过同一区域,证据到此为止,任何「自动选边」都是无证据判决。反事实更能说明问题:假如 git 在这一格悄悄采纳一侧,theirs 在这个区域的改动就无声消失了,而版本控制的第一职责恰恰是不丢改动。冲突标记把两侧原稿连同标签一起摆进文件,是把决定权和证据一并交还给你。它没算错——它算得足够清楚,清楚到知道这一格不该自己拍板。

## 树、提交,与那笔双父

文件之上还有两层装配。第一层是目录。两边的 tree 对象各自摊平成「路径 → 模式加指纹」的清单,逐路径过同一张判定表。问法换成三问:两侧一致吗?ours 与 base 一致吗?theirs 与 base 一致吗?前两问任一为真,答案直接出来;三问全否,这个文件交给 mergeBlobs 行级对账。清单里查不到的路径按内容为空处理——「一侧删文件、一侧改文件」与「两侧各自新建同一个文件」都自然归进同一格:前者得到一个 ours 侧为空的冲突块,后者的冲突块罩住整个文件。文件模式不单独判:ours 有模式用 ours 的,否则用 theirs 的,这条从简登记在差异附录。

带标记的合并稿往哪放?照样写成 blob,按内容寻址落进对象库。SHA-1 是名字,对象头是 `blob <字节数>` 加一个零字节,躺成 objects/xx 下的松散对象——与任何一份普通内容平权。对象库不区分「真内容」和「带标记的稿子」,同名即同内容。这带来一个干净的性质:冲突现场可被反复检出而不走样,cat-file 读它和读任何文件一样。

第二层是提交。mergeCommits 接手第 8 章判定表的三个格子。第一格,theirs 可达自 ours:返回 up-to-date,一个字节都不动。第二格,ours 可达自 theirs:返回 fast-forward,命令层挪引用、检工作区,不造提交——短路复用的正是 isAncestor 那把尺子。第三格,互不包含,才轮到真合并:mergeBase 取 base,树级合并,成了就写提交。写提交用的是第 4 章的老函数 commitTree,新意只有一处——parents 数组塞了两个元素。本章第三个新词落定。**merge 提交(merge commit)——带两个父提交的提交:第一条父边指向 ours 的旧尖端,第二条指向 theirs;除此之外,与普通提交逐字段相同。**实验场里那笔合并提交 cat-file 出来是:tree 一行、parent 两行、author、committer、空行、消息,没有一个多余的字段。快照模型的规矩也没破——它的 tree 指向合并结果的整棵快照,正是 mergeTrees 的产物。

「merge 提交和普通提交存储方式不同」,这条直觉先给足面子:log 里它顶着 Merge 开头的消息,图形工具把它画成菱形的底角,pull 一次冒一个,存在感确实特殊。证伪只要一次 cat-file:普通提交四行头,合并提交五行头,多的那一行就是第二条 parent。mini-git 侧的证据更硬——生成它的是同一个 commitTree,差异只在入参数组的长度。对象库里没有第二种 commit 对象,只有父提交条数不同的 commit 对象。

还有一条流传更广的:「git 会自动采纳较新一方的修改」。公道话:双向同步工具确实这么干,网盘与备份软件按修改时间取新是常规操作。git 里也真有时间戳——第 8 章 mini-git 在 criss-cross 的并列候选里挑 base,用的就是 committer 时间——「git 按新取舍」有真实的出处。不成立的地方在证据链:行级合并的输入里根本没有时间。mergeBlobs 的参数是 base、ours、theirs、labels——三份文本加一对标签,谁也没带钟。把 theirs 那笔提交的时间拨早再合,判决也不会变:这个函数想看时间也没得看。同区域双改时,两侧都比 base 新,「较新」在两个都新的东西之间没有裁判权。时间戳在合并这件事里只干过一样活:在并列的 base 候选里挑一个——那是多个等价答案里的取一,不是取舍的证据。

## 演练:从红到绿

动刀范围先交底。新增 `src/merge.ts`:导出 mergeBlobs、mergeTrees、mergeCommits 三个函数。私底下还养着两件:changeRegions 把编辑脚本折算成改动区,writeMergedTree 把清单写成合并树。新增 `tests/merge.test.ts`,二十一条。`src/cli.ts` 接一条 merge 子命令,文件尾新增 cmdMerge。第 6 章的 restoreWorktree 把主体抽成 restoreToTree,供合并结果落盘复用;旧函数一行逻辑没变,只是分了层。帮助文本、switch、import 各添一笔。八份旧测试一字未动,其余七个源文件一字未动。又是纯文本的一章,十六进制转储收进抽屉,Buffer 只在合并稿落库时出场。

先立只会抛错的骨架,三个函数体一律抛「尚未实现」,cli 接好线,跑全量:

```text
# 用法示例 · 红的关键几行
 × mergeBlobs:行对齐账上的判定 > 两侧改不同区域:两处改动都自动合入,全文无任何标记;哪侧在前都一样
   → 尚未实现:mergeBlobs
 × mergeBlobs:行对齐账上的判定 > 相触即冲突:ours 改第 2 行、theirs 在其后插入,挨着就没人敢自动定夺(严格在前才自动)
   → 尚未实现:mergeBlobs
 × mergeCommits:第 8 章判定表的三个格子 > 分叉真合并:产出的提交带两个父,顺序恰为 [ours, theirs]
   → 尚未实现:mergeCommits   ← 树还没折,先撞上裁判
 × mini-git merge 命令 > ff 短路:落后方合领先方只挪引用,不造提交——对象库一个对象都没多
   → 尚未实现:mergeCommits
 Tests  20 failed | 149 passed (169)
```

二十条红,红因清一色「尚未实现」。绿的 149 条里,148 条旧测试,外加本章一条守参数关口的绿:detached HEAD、不存在的分支、参数个数,它们的关口在进库之前,自己就守得住——与第 7 章那条参数校验绿测试同款。开始填肉。

### changeRegions:把脚本折成账

```ts
// src/merge.ts · changeRegions
function changeRegions(base: readonly string[], side: readonly string[]): Region[] {
  const regions: Region[] = []
  let cur: Region | null = null
  let i = 0 // 已数过的 base 行数:下一条指令的落点
  for (const op of diffLines(base, side)) {
    if (op.op === 'context') {
      if (cur !== null) {
        regions.push(cur)
        cur = null
      }
      i++
    } else if (op.op === 'delete') {
      cur ??= { from: i, to: i, lines: [] }
      i++
      cur.to = i // 删掉的 base 行收进区里
    } else {
      cur ??= { from: i, to: i, lines: [] }
      cur.lines.push(op.text) // 插入行记在区的替换内容里;落点就是当前的 i
    }
  }
  if (cur !== null) {
    regions.push(cur)
  }
  return regions
}
```

游标 i 数的是已经吃掉的 base 行。context 把当前区封箱、i 前进;delete 开箱并吃掉一行;insert 只往箱里添行,i 不动——所以纯插入的区零宽,锚在「第 i 行之前」。有个细节值得停一秒:第 7 章回溯时给每条指令记的 aLine、bLine,这里一个都没用——区自己记得住位置,行号那笔账是给渲染层留的。

### mergeBlobs:主循环就是判定表

```ts
// src/merge.ts · mergeBlobs 主循环(拼版:开头的终稿短路、折账与 sideLines 小函数在终态源文件里,主循环完整)
  while (oi < oursRegions.length || ti < theirsRegions.length) {
    const o = oursRegions[oi]
    const t = theirsRegions[ti]
    if (t === undefined || (o !== undefined && o.to < t.from)) {
      // theirs 已走完,或 ours 的改动严格在前:单方改动,自动采纳
      out.push(...baseLines.slice(i, o.from), ...o.lines)
      i = o.to
      oi++
    } else if (o === undefined || t.to < o.from) {
      out.push(...baseLines.slice(i, t.from), ...t.lines)
      i = t.to
      ti++
    } else if (identicalRegion(o, t)) {
      // 双侧改得一模一样:采纳一份,不算冲突
      out.push(...baseLines.slice(i, o.from), ...o.lines)
      i = o.to
      oi++
      ti++
    } else {
      // 相触或交叠:冲突块。区间两头取并集,把两侧与它相触的改动全部吞进来。
      const from = Math.min(o.from, t.from)
      let to = Math.max(o.to, t.to)
      const oStart = oi // 本块吞进的 ours 区,从下标 oStart 到 oi;theirs 同理
      const tStart = ti
      oi++
      ti++
      for (;;) {
        const next = oursRegions[oi] ?? theirsRegions[ti]
        if (next === undefined || next.from > to) {
          break // 后面的改动与本块不相触,留给下一轮
        }
        to = Math.max(to, next.to)
        if (next === oursRegions[oi]) {
          oi++
        } else {
          ti++
        }
      }
      out.push(...baseLines.slice(i, from))
      out.push(`<<<<<<< ${labels.ours}`, ...sideLines(oursRegions.slice(oStart, oi), from, to), '=======')
      out.push(...sideLines(theirsRegions.slice(tStart, ti), from, to), `>>>>>>> ${labels.theirs}`)
      conflicts++
      i = to
    }
  }
  out.push(...baseLines.slice(i))
  return { merged: out.length === 0 ? '' : `${out.join('\n')}\n`, conflicts }
```

四个分支,对应判定表的后四行。前两个分支的判断里藏着那条边界:`o.to < t.from` 是严格小于——ours 的区必须结束在 theirs 的区开始之前,挨上不算。判断顺序也保证了双方都剩区时,总能挑出严格靠前的那个先落地。第三个分支是不谋而合,采纳一份、两边的指针各进一格。第四个分支开冲突。它先记下两侧数组的起点下标,再把与区间相触的一切改动吞进来——那个 `for (;;)` 的停条件同样是 `next.from > to`,相触就吞。随后 sideLines 把这块区间在该侧账上的样子写出来:该侧没动过的 base 行原样带出,动过的换成改后的行。删对改的冲突块里 ours 侧因此是空的,theirs 侧还带着它没动过的邻居行。结尾统一补一个收尾换行:mini-git 沿用第 7 章的假定,文本以换行收尾;真 git 在干净合并里会保留缺失的收尾换行,这条边界情形登记差异附录。

### mergeTrees 与 mergeCommits:两层装配

<details>
<summary>点开看:mergeTrees 全文(src/merge.ts)。</summary>

```ts
// src/merge.ts · mergeTrees
export function mergeTrees(
  gitDir: string,
  base: string,
  ours: string,
  theirs: string,
  labels: MergeLabels = { ours: 'HEAD', theirs: 'theirs' },
): TreeMerge {
  const baseFiles = flattenTree(gitDir, base)
  const oursFiles = flattenTree(gitDir, ours)
  const theirsFiles = flattenTree(gitDir, theirs)
  const text = (sig: FileSig | undefined): string => (sig === undefined ? '' : readObject(gitDir, sig.hash).body.toString('utf8'))
  const same = (a: FileSig | undefined, b: FileSig | undefined): boolean =>
    (a === undefined) === (b === undefined) && a?.hash === b?.hash && a?.mode === b?.mode
  const files: { path: string; mode: number; hash: string }[] = []
  const conflicts: string[] = []
  const paths = [...new Set([...oursFiles.keys(), ...theirsFiles.keys(), ...baseFiles.keys()])].sort()
  for (const path of paths) {
    const so = oursFiles.get(path)
    const st = theirsFiles.get(path)
    const sb = baseFiles.get(path)
    if (same(so, st)) {
      if (so === undefined) {
        continue // 两侧一致地没有该路径:删除,不进清单
      }
      files.push({ path, mode: so.mode, hash: so.hash })
    } else if (same(so, sb)) {
      if (st !== undefined) {
        files.push({ path, mode: st.mode, hash: st.hash }) // 只有 theirs 动过:采纳 theirs
      }
    } else if (same(st, sb)) {
      if (so !== undefined) {
        files.push({ path, mode: so.mode, hash: so.hash }) // 只有 ours 动过:ours 说了算
      }
    } else {
      const merged = mergeBlobs(text(sb), text(so), text(st), labels)
      files.push({
        path,
        mode: so?.mode ?? st!.mode,
        hash: writeObject(gitDir, 'blob', Buffer.from(merged.merged, 'utf8')), // 带标记的合并稿也是内容,照样按内容寻址落库
      })
      if (merged.conflicts > 0) {
        conflicts.push(path)
      }
    }
  }
  return { tree: writeMergedTree(gitDir, files), conflicts }
}
```

</details>

same 三问的次序有讲究:先问「两侧一致」,再问「谁与 base 一致」,都为假才进对账。三份清单取并集扫一遍,每个路径各归各的格子;查无此路径当空文本,删对改与两侧各自新建因此不需要专门的分支。writeMergedTree 走 writeTreeFromIndex 的老路把清单拼成 tree,stat 字段全填零。序列化只读路径、模式与哈希三项,零值不影响产物,还省了一份重复的递归。

```ts
// src/merge.ts · mergeCommits
export function mergeCommits(gitDir: string, ours: string, theirs: string, options: MergeOptions): MergeOutcome {
  if (isAncestor(gitDir, theirs, ours)) {
    return { kind: 'up-to-date' }
  }
  if (isAncestor(gitDir, ours, theirs)) {
    return { kind: 'fast-forward', to: theirs }
  }
  const base = mergeBase(gitDir, ours, theirs)
  if (base === null) {
    throw new Error(`merge:'${ours.slice(0, 7)}' 与 '${theirs.slice(0, 7)}' 没有公共祖先——两段不相连的历史,给不出 base`)
  }
  const treeOf = (commit: string): string => {
    const { type, body } = readObject(gitDir, commit)
    if (type !== 'commit') {
      throw new Error(`merge:对象 '${commit.slice(0, 7)}' 不是 commit(它是 ${type}),没法当合并的一方`)
    }
    return parseCommit(body).tree
  }
  const merged = mergeTrees(gitDir, treeOf(base), treeOf(ours), treeOf(theirs), options.labels)
  if (merged.conflicts.length > 0) {
    return { kind: 'conflicted', tree: merged.tree, conflicts: merged.conflicts }
  }
  const commit = commitTree(gitDir, {
    tree: merged.tree,
    parents: [ours, theirs],
    author: options.author,
    message: options.message ?? `Merge\n`,
  })
  return { kind: 'merged', commit, tree: merged.tree }
}
```

头两行是第 8 章判定表的前两格,一行一格,把第 8 章立起的可达性当尺子再量两遍:可达集一问,up-to-date;再一问,fast-forward。base 为 null 当场报错。三笔提交各自取出 tree 才交给 mergeTrees——合并的输入是树,提交只是树的挂名人与图的节点。冲突非空就不写提交,把树与清单原样交回,落盘的事归命令层。

<details>
<summary>点开看:cmdMerge 全文(src/cli.ts;四种结局各自的输出与落盘动作)。</summary>

```ts
// src/cli.ts · cmdMerge
function cmdMerge(cwd: string, args: string[]): string {
  const usage = '用法:mini-git merge <分支名 | 40 位提交名>;恰好一个目标,不收开关'
  if (args.length !== 1 || args[0].startsWith('-')) {
    throw new Error(usage)
  }
  const gitDir = requireGitDir(cwd)
  const head = readHead(gitDir)
  if (head.kind !== 'ref' || !head.ref.startsWith('refs/heads/')) {
    throw new Error(`merge:HEAD 不在分支上(detached)——mini-git 只在分支上合并,合并结果要有引用可推进`)
  }
  const branch = head.ref.slice('refs/heads/'.length)
  const ours = resolveHead(gitDir)
  if (ours === null) {
    throw new Error(`merge:当前分支 '${branch}' 还没生过提交,没有可合的底`)
  }
  const [target] = args
  let theirs: string
  if (HASH_RE.test(target)) {
    theirs = target
  } else {
    const found = readRef(gitDir, `refs/heads/${target}`)
    if (found === null) {
      throw new Error(`merge:分支 '${target}' 不存在;现有分支:${listBranches(gitDir).join('、') || '无'}`)
    }
    theirs = found
  }
  const outcome = mergeCommits(gitDir, ours, theirs, {
    labels: { ours: 'HEAD', theirs: target }, // git 的标签口径:ours 恒 HEAD,theirs 写 merge 参数原文
    message: `Merge ${HASH_RE.test(target) ? `commit '${target}'` : `branch '${target}'`}\n`,
    author: identityFromEnv(),
  })
  switch (outcome.kind) {
    case 'up-to-date':
      return 'Already up to date.'
    case 'fast-forward':
      updateRef(gitDir, head.ref, outcome.to)
      restoreWorktree(gitDir, cwd, outcome.to)
      return `Fast-forward:${branch} ${ours.slice(0, 7)}..${outcome.to.slice(0, 7)}(只挪引用,无新提交)`
    case 'merged':
      updateRef(gitDir, head.ref, outcome.commit)
      restoreToTree(gitDir, cwd, outcome.tree)
      return `合并完成:${branch} ${outcome.commit.slice(0, 7)}(双父 ${ours.slice(0, 7)} + ${theirs.slice(0, 7)})`
    case 'conflicted': {
      restoreToTree(gitDir, cwd, outcome.tree)
      const lines = [`自动合并失败:${outcome.conflicts.length} 个文件带着冲突标记写进了工作区与暂存区:`]
      lines.push(...outcome.conflicts.map((p) => `  ${p}`))
      lines.push('手工编辑解决后 mini-git add + mini-git commit 收尾;mini-git 不记 MERGE_HEAD,收尾提交是单父提交(HEAD 未动)')
      return lines.join('\n')
    }
  }
}
```

</details>

命令层全是旧零件的再会面。ours 的尖端从 resolveHead 沿符号引用链解到提交名;detached 状态直接拒绝——合并结果要有引用可推进,不在分支上的合并没处落。目标解析与 checkout 同款双口径:40 位哈希直用,名字去 refs/heads 下查。四种结局,四种动作。up-to-date 原样照抄真 git 的那行原文。fast-forward 挪引用加检出,不造提交。merged 推进引用,检出结果树。conflicted 只检出带标记的树,引用纹丝不动。冲突现场同时落进 index 文件——工作区、暂存区、HEAD 三方一比,第 5 章的三态对比立刻能报出「已暂存的修改」,你改平标记再 add、commit,收尾提交是普通单父提交。真 git 在这里会写 MERGE_HEAD,让收尾提交自动带上第二个父;mini-git 不做,口径已在输出文本里声明,差异附录集中登记。

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
 ✓ tests/merge.test.ts (21 tests)
 ✓ tests/commits.test.ts (22 tests)
 ✓ tests/graph.test.ts (22 tests)

 Test Files  9 passed (9)
      Tests  169 passed (169)
```

二十一条分四组。mergeBlobs 七条:不同区域自动合入(含谁前谁后都一样)、同行双改金样、不谋而合、相触即冲突、两处冲突计数与成对标记、删对改金样、标签口径与两侧新建。mergeTrees 四条:跨文件全合入、同区域进冲突清单、单侧增删、双侧新建的同与不同。mergeCommits 三条:两问换算两格结局、双父顺序恰为 [ours, theirs]、不相连报错。命令七条:跨文件合并与双父、同文件不同区域、同区域冲突落盘与 status 口径、冲突收尾单父、ff 的对象数守恒、up-to-date、detached 与各路报错。

金样不是拍脑袋写的。三个冲突金样,先与真 git 逐字符比对一致才固化。成器之后又跑了一轮随机对拍,118 组随机改动。干净合并 78 组,全部一致。冲突 40 组中 38 组逐字节一致;2 组冲突块的边界与真 git 不同,根子在底层 diff 的最小编辑脚本本就不唯一——第 7 章登记过的平手口径,不是合并逻辑的分歧。这轮随机样例里,「冲突还是干净」的判定没有一组不一致;但要把话说窄:文件里存在大量重复行时,平手口径确实可能把对齐挪到别处,极端构造下连判定都可能翻转。这一类与底层 diff 的口径一并登记进差异附录。

## 亲手验证:先猜,再跑

开新实验场:

```bash
# 用法示例 · 建 merge-lab:七行底稿,分叉后两边各改一处
cd ..                                  # 来到课程根(mini-git-ts-course/)
mkdir merge-lab && cd merge-lab
MG=../companion/node_modules/.bin/tsx
CLI=../companion/src/cli.ts
$MG $CLI init
printf 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n' > f.txt
printf 'readme\n' > g.txt
$MG $CLI add f.txt g.txt
MINI_GIT_TIMESTAMP=1700000000 $MG $CLI commit -m '第一次提交'
$MG $CLI branch dev
printf 'one\nTWO-OURS\nthree\nfour\nfive\nsix\nseven\n' > f.txt
$MG $CLI add f.txt
MINI_GIT_TIMESTAMP=1700003600 $MG $CLI commit -m 'main 的改动'
$MG $CLI checkout dev
printf 'one\ntwo\nthree\nfour\nfive\nSIX-THEIRS\nseven\n' > f.txt
printf 'readme\nmore\n' > g.txt
$MG $CLI add f.txt g.txt
MINI_GIT_TIMESTAMP=1700003600 $MG $CLI commit -m 'dev 的改动'
$MG $CLI checkout main
```

此刻的图:main 与 dev 都从同一笔第一提交分出来,main 改了 f.txt 的第 2 行,dev 改了第 6 行外加 g.txt。第一猜,干净合并。动手前押三样:merge 的输出那句「双父」后面跟的两个短哈希是谁和谁;f.txt 的终稿第 2 行与第 6 行各是什么;g.txt 几行。写下再跑:

```bash
# 用法示例 · 自动合入
MINI_GIT_TIMESTAMP=1700007200 $MG $CLI merge dev
# 合并完成:main dbd4a5e(双父 feced84 + 9ec5b36)
cat f.txt
# one
# TWO-OURS
# three
# four
# five
# SIX-THEIRS
# seven
cat g.txt                                # readme + more,两行
```

对答案:双父是 main 的旧尖端 feced84 加 dev 的尖端 9ec5b36——第 8 章判定表「互不包含」的那格,今天填上了。f.txt 两处改动都在,中间三行原样;g.txt 两行,dev 的追加被采纳。main 的引用已经指到合并提交上,dev 纹丝没动。请真 git 来验货,它读的是同一个对象库和引用:

```bash
# 用法示例 · 真 git 读出这笔双父提交
git -c core.autocrlf=false log --oneline main | cat
# dbd4a5e Merge branch 'dev'
# feced84 main 的改动
# 9ec5b36 dev 的改动
# ca8ed9a 第一次提交
$MG $CLI cat-file -p "$(cat .git/refs/heads/main)"
# tree 2db22e426b50d6500e017c4d99c4829f69d78265
# parent feced8493f6479399d12315b1b034fbc7b8e7d8f
# parent 9ec5b36b10cca5f8e092a182a5671165423be667
# author mini-git <mini-git@example.com> 1700007200 +0800
# committer mini-git <mini-git@example.com> 1700007200 +0800
# (空行)
# Merge branch 'dev'
```

真 git 把这笔合并提交排在最前,两条父边都走得通——「merge 提交存储不同」在这里当场证伪:五行头,与普通提交只差一行 parent。

第二猜,冲突与对拍。换个实验场重来,这次两边动同一个地带:main 把第 2 行的 two 改成 TWO,dev 在第 2 行后面插一行 INSERTED。动手前押三样:冲突块里中线之上几行、之下几行;merge 之后 status 的哪一段会出现 f.txt;`git merge-file` 的退出码是几。真 git 把文件级三方合并做成了底层命令 [git-merge-file](https://git-scm.com/docs/git-merge-file),正好当裁判。它的退出码,文档原话拆两截。前半:「The exit value of this program is negative on error」。后半:「and the number of conflicts otherwise」——翻译:出错为负,否则就是冲突块数。押完再跑:

```bash
# 用法示例 · 相触冲突:mini-git 与真 git 各判一次
cd .. && mkdir merge-lab2 && cd merge-lab2
$MG $CLI init
printf 'one\ntwo\nthree\nfour\nfive\n' > f.txt
$MG $CLI add f.txt
MINI_GIT_TIMESTAMP=1700000000 $MG $CLI commit -m '第一次提交'
$MG $CLI branch dev
printf 'one\nTWO\nthree\nfour\nfive\n' > f.txt
$MG $CLI add f.txt
MINI_GIT_TIMESTAMP=1700003600 $MG $CLI commit -m 'main 改第 2 行'
$MG $CLI checkout dev
printf 'one\ntwo\nINSERTED\nthree\nfour\nfive\n' > f.txt
$MG $CLI add f.txt
MINI_GIT_TIMESTAMP=1700003600 $MG $CLI commit -m 'dev 在第 2 行后插入'
$MG $CLI checkout main
$MG $CLI merge dev
# 自动合并失败:1 个文件带着冲突标记写进了工作区与暂存区:
#   f.txt
# 手工编辑解决后 mini-git add + mini-git commit 收尾;mini-git 不记 MERGE_HEAD,收尾提交是单父提交(HEAD 未动)
cat f.txt
# one
# <<<<<<< HEAD
# TWO
# =======
# two
# INSERTED
# >>>>>>> dev
# three
# four
# five
$MG $CLI status
# 已暂存的变更(暂存区 相对 HEAD):
#   修改:f.txt
```

对答案:中线之上只有 TWO,ours 的改稿。之下两行,two 与 INSERTED——theirs 没动第 2 行,只是紧跟着插了一行,所以它的原行也被带进现场。status 报「已暂存的变更」:带标记的稿子已经写进了暂存区清单,而 HEAD 还停在旧尖端。注意两笔提交的时间戳同为 1700003600——谁也不比谁新,冲突照判。现在请真 git 的合并器判同一组文本:

```bash
# 用法示例 · git merge-file 对拍同一组三份文本
printf 'one\ntwo\nthree\nfour\nfive\n' > base.txt
printf 'one\nTWO\nthree\nfour\nfive\n' > ours.txt
printf 'one\ntwo\nINSERTED\nthree\nfour\nfive\n' > theirs.txt
git merge-file -L HEAD -L base -L dev ours.txt base.txt theirs.txt
echo $?                                   # 1:一个冲突块
cmp f.txt ours.txt && echo 两份产物逐字节一致
# 两份产物逐字节一致
```

退出码 1,一个冲突块;`cmp` 无声通过,mini-git 写进工作区的冲突稿与真 git 的合并器产物逐字节相同——包括两翼标签:HEAD 与 dev。收尾也顺手做完:把稿子改成两边都要的样子,再走一遍老流程。

```bash
# 用法示例 · 冲突收尾:改平标记,add + commit
printf 'one\nTWO\nINSERTED\nthree\nfour\nfive\n' > f.txt
$MG $CLI add f.txt
MINI_GIT_TIMESTAMP=1700007200 $MG $CLI commit -m '解决冲突:两改都留'
# [main 5f4d5e5] 解决冲突:两改都留
$MG $CLI cat-file -p "$(cat .git/refs/heads/main)" | grep -c '^parent'   # 1:单父提交,口径如此
```

第三猜,两格短路结局。再开一个实验场:一笔提交,一条 dev 分支,main 前进一笔。动手前押两样:在 main 上合 dev,对象库里对象数变不变;在 dev 上合 main 呢,dev 的引用会指到哪、对象数又变不变。写下再跑:

```bash
# 用法示例 · up-to-date 与 fast-forward
cd .. && mkdir merge-lab3 && cd merge-lab3
$MG $CLI init
printf 'a\n' > f.txt
$MG $CLI add f.txt
MINI_GIT_TIMESTAMP=1700000000 $MG $CLI commit -m '第一次提交'
$MG $CLI branch dev
printf 'a\nb\n' > f.txt
$MG $CLI add f.txt
MINI_GIT_TIMESTAMP=1700003600 $MG $CLI commit -m 'main 前进'
find .git/objects -type f | wc -l        # 6
$MG $CLI merge dev
# Already up to date.
$MG $CLI checkout dev
$MG $CLI merge main
# Fast-forward:dev c519739..22fe2e5(只挪引用,无新提交)
find .git/objects -type f | wc -l        # 6:一个对象都没多
cat .git/refs/heads/dev                  # 22fe2e5...,与 main 同尖
cat f.txt                                # a 加 b:工作区检成了目标
```

对答案:两次合并前后对象数都是 6。up-to-date 本来就无物可合;fast-forward 只把 dev 的引用文件写成了 main 的尖端——一行 41 字节的事,没有新 commit、新 tree、新 blob。第 8 章那句「挪指针就等于合并」,今天成了你亲手跑出来的输出。

第四猜,定向破坏。指认一处:src/merge.ts 的 mergeBlobs 主循环里,两个严格小于——`if (t === undefined || (o !== undefined && o.to < t.from))` 与 `} else if (o === undefined || t.to < o.from) {`——把这两处 `<` 各改成 `<=`。其余全部不碰,changeRegions、mergeTrees、命令层原样。先写下预测:二十一条新测试红几条?「同行双改金样」那条红不红?命令组的「同区域双改」呢?ff 那条呢?跑。

对答案:恰好 3 条红——「相触即冲突」「标签口径(两侧新建)」与树级「双侧新增同一文件」。倒下的全是靠零宽区与相邻区吃饭的:`<=` 把「相触」放行成自动合并,替换挨着插入的两侧被直接拼在一起,add/add 的两个零宽区谁也不严格在谁前,冲突块整个消失。不红的有三层。同行双改一族——包括命令组那条——两侧的区本来就在同一批 base 行上真交叠,`<` 与 `<=` 都拦得住,它们守的是判定表「双方动到同一区域」这个格子本身。ours 与 theirs 终稿相同的那条,在函数第一行就短路返回,主循环根本不进。ff 与 up-to-date 两条守在提交图那一层,行级边界够不着它们。把两个 `<=` 改回 `<`,169 条全绿,复原确认。

## 收束:决定不了的地方,git 交还证据

那九次自动完成,git 不是在替你做主,它是在查账。base 对 ours 一张行对齐账,base 对 theirs 一张。每一行的来历翻得清清楚楚:没人动过的保留,单方动过的采纳,动得不谋而合的采纳一份。查到双方动到同一区域,它搁笔,把两侧原稿连同标签写进文件。三行怪符号不是故障残骸,是一份落进工作区的判决书:哪行是谁的写得明白,落槌的权力留给你。冲突与自动合入,从来是同一张判定表上的相邻两行,不是两种运气。

这章入手的东西,一只手数得完。三个词:三方合并、冲突标记、merge 提交。一个新文件 src/merge.ts,装着 mergeBlobs、mergeTrees、mergeCommits。一条命令 merge,能自动时产双父提交,冲突时把现场写进工作区与暂存区。第 7 章那张行对齐账、第 8 章判定表的最后一格,两笔旧账当面结清。ff 与 up-to-date 的判定原样长在 mergeCommits 的头两行,图那层的尺子一行没改。从简口径照例就地声明、差异附录集中登记。冲突块不做细化与相邻归并,标签固定 HEAD 与参数原文;index 只登记带标记稿一份,不写 MERGE_HEAD,冲突以文本报告不走退出码。另有不检查未提交改动、模式冲突不检测、收尾换行沿用第 7 章的假定。

第三部分至此收官:会算每一行的来历,会在图上找到老底,会以老底为裁判合并。下一部分把仓库搬上线,那里压着两笔早登记在案的旧账。refs 目录里那份分支清单,第 10 章握手时原样变成引用发现的输出。isAncestor 那把 ff 尺子,第 11 章去远端上岗,把关 push 吃的 non-fast-forward。本地这半边的故事讲完了,剩下的对话都发生在网络上。

离场三问,输入全是新的。先自己走一遍,再展开核对;卡住按提示回查。

<details>
<summary>1. 十行底稿,ours 删掉第 3 到 7 行,theirs 只把第 5 行改成 fix。按判定表这是哪一格?冲突块两侧各带出什么?</summary>

ours 的区是 [2,7)(吃掉五行),theirs 的区是 [4,5),后者整个落在前者内部——交叠,冲突格。冲突区间取并集 [2,7):ours 侧空,五行全没了;theirs 侧带出的是行 3、行 4 原文,fix,再加行 6、行 7 原文——它只动过第 5 行,区间里其余 base 行原样带出。所以中线上空无一物,之下一连五行。回查「行对齐账」一节的折账法与 sideLines 的讲解。
</details>

<details>
<summary>2. theirs 的时间戳拨早再合,判决会变吗?哪些行为真的随时间戳变?</summary>

判决不变:mergeBlobs 收不到时间,想看也没得看。会变的只有外围两处——log 按时间戳排序的显示顺序,以及第 8 章 mergeBase 在并列候选里按时间戳挑 base:后者影响的也只是「拿哪份底稿当裁判」,不是某一格的判决。回查「较新一方」的证伪段与第 8 章的多候选取法。
</details>

<details>
<summary>3. dev 刚被 fast-forward 到 main 的尖端,马上后悔了。不造任何新提交,能把 dev 退回快进前的位置吗?凭的是什么?</summary>

能。ff 那一格只做了一件事:把 refs/heads/dev 这个引用文件里的哈希写成 main 的尖端——没有造提交,dev 的旧尖端那笔提交原封不动躺在对象库里。把 dev 的引用写回旧哈希——第 6 章一个写引用的动作——再把工作区 checkout 回去,就全身而退了;连历史都不用改写。这也是 ff 与真合并最实在的差别:真合并好歹造了一笔双父提交,要撤就得动历史。回查第 8 章 fast-forward 一节与本章 ff 短路。
</details>
