---
title: 历史是一张图:提交对象与 log
---

# 历史是一张图:提交对象与 log

敲完一次提交,你多半顺手再敲一下 git log——屏幕上立刻排出一列熟悉的卡片:一串 40 位天书打头,作者、日期跟上,消息缩进四格。天天见,却未必追问过:这份名单是从哪读出来的?.git 里翻一圈,并没有哪个文件写着「第一次提交、第二次提交」这样的清单。

更蹊跷的是另一件事。哪天你改写历史——给最早的提交补一句话,或者把几笔压缩成一笔——git 会照办,但改完之后,被动手脚的那一笔连同它之后的每一笔,哈希全部换人。你明明只动了最早那一笔,后代们凭什么跟着改名?「哈希全变」这四个字在日常操作里从不出现,偏偏在改写历史时必然出现。

两个问题共用一个答案,答案就藏在前三章一直在数的那 6 个对象里,唯一还没拆开的角色:提交记录。上一章收尾把账留到了这里,原话是「还欠 1 份提交记录——把根 tree 的哈希、作者、时间和消息打包成历史节点的东西」。本章就拆这一笔。先挖出一笔真提交,把它的内容逐行读清楚。再沿「父指针」把历史看成一张图,顺手推出「哈希全变」的因果链。最后落进 mini-git:commitTree 与 logWalk 两个函数,commit-tree 与 log 两条命令,输出与真 git 逐字符对拍。

## 先挖出一笔真的提交

开个新实验场。目录快照直接沿用第 3 章那套三层 fixture:内容固定,名字才固定,这条纪律到本章不变。

```bash
# 用法示例 · 建 commit-lab:沿用第 3 章的 fixture,先借真 git 的手
cd ..                                  # 来到课程根(mini-git-ts-course/)
mkdir commit-lab && cd commit-lab
git init -b main
printf 'hello world\n' > a.txt
printf 'note\n' > lib.txt
mkdir -p lib/deep
printf 'util\n' > lib/util.txt
printf 'hello world\n' > lib/deep/leaf.txt
git -c core.autocrlf=false add -A
git write-tree
# fa0086005716702a3661501fa32495bae7619b91
```

根 tree 还是 fa008600…,对象库里那 6 个对象与第 3 章一字不差(3 个 blob、3 个 tree 对象)。条目尾斜杠排序、文件模式那些规矩,也全是上一章的成品。现在把这份快照「提交」出去。不请 porcelain 出场,直接用底层命令 commit-tree:它收一棵 tree 的名字、可选的若干父提交、一条消息,身份与时间用环境变量声明。这正是本章要亲手实现的那条命令,先看真 git 怎么演。

```bash
# 用法示例 · 真 git commit-tree:身份与时间全部用环境变量钉死
export GIT_AUTHOR_NAME=mini-git GIT_AUTHOR_EMAIL=mini-git@example.com
export GIT_COMMITTER_NAME=mini-git GIT_COMMITTER_EMAIL=mini-git@example.com
export GIT_AUTHOR_DATE='@1700000000 +0800' GIT_COMMITTER_DATE='@1700000000 +0800'
git commit-tree fa0086005716702a3661501fa32495bae7619b91 -m '第一次提交'
# bf05977bd740a2b2fa530935475587501704d0cc
```

author 与 committer 各配一套环境变量,对应提交里的两行身份,下面马上讲到。1700000000 是 Unix 秒,折算是 2023 年 11 月 15 日早上六点十三分(北京时间)。本章全部时间戳都是它按每小时 3600 秒往上加——人造的时钟,谁跑都一样。

对象库里多了一个文件,把它整个读出来。

```text
$ git cat-file -p bf05977bd740a2b2fa530935475587501704d0cc
tree fa0086005716702a3661501fa32495bae7619b91
author mini-git <mini-git@example.com> 1700000000 +0800
committer mini-git <mini-git@example.com> 1700000000 +0800

第一次提交
```

本章第一个新词的实体就在眼前。**commit 对象(commit object)——一种纯文本对象,按行分五段:tree 行、零到多行 parent、author 与 committer 两行、一个空行、消息原文**。第 1 章预告过,那第 6 个对象的名字「多半和我的不同」,原因全在 cat-file -p 打出来的这几行里:它的内容记着人和时间。

有个轻松的对照。上一章拆 tree 时,又是十六进制转储又是 Buffer,一章才铺完台阶。这次一样都不用——提交的内容是文本,cat-file -p 不做任何渲染,吐出来的就是对象本体的字节。对象头照第 2 章的规矩照写,`commit <字节数>` 加一个 0 字节,之后照常 zlib 压缩、照常落成松散对象。变的只在内容这一侧:目录快照是二进制,提交记录是文本。

字段清单不是 mini-git 发明的,官方正本出自 [gitdatamodel(7)](https://git-scm.com/docs/gitdatamodel)。五个必填字段:tree、parent、author、committer、message。关于 parent 的取值,官方一句说全,分三段引。根提交:「The first commit in a repository has 0 parents」。普通提交:「regular commits have 1 parent」。合并提交:「merge commits have 2 or more parents」。author 与 committer 为什么分两行?分工不同:author 记「这段改动是谁写的」,committer 记「这笔提交是谁落进历史的」。平时两行相同;amend、rebase 这类操作只换 committer 不换 author——改写历史时日志里 AuthorDate 与 CommitDate 分家,根子就在这两行。

这里顺带清算一个直觉:「提交记录了当时的环境——谁在线、哪台机器、在哪个分支」。先替它说句公道话:第 2 章你亲眼见过,提交对象的名字跨机器各不相同,「内容里有人有事」的联想很自然;IDE 的历史卡片上,分支名、头像又总跟提交一起出现,看上去都像「提交的一部分」。边界在这:cat-file -p 打出来的就是这只对象的全部字节,数一数,六行。机器名、IP、路径、分支名,一个都没有。分支名尤其值得停一拍——第 1 章解剖过,分支是 .git/refs/heads 下那个 41 字节的小文件,它指向提交,提交却完全不认识它。同一笔提交可以被任何分支指、被贴标签、被搬到别的分支上接着用,因为它自己没写死归属。

## 历史是一张图,不是一条链

第二笔怎么造?再喊一次 commit-tree,多给一个 -p(parent),指名上一笔:

```bash
# 用法示例 · 链式两笔:第二笔以第一笔为父
export GIT_AUTHOR_DATE='@1700003600 +0800' GIT_COMMITTER_DATE='@1700003600 +0800'
C1=bf05977bd740a2b2fa530935475587501704d0cc
git commit-tree fa0086005716702a3661501fa32495bae7619b91 -p $C1 -m '第二次提交'
# 4e5eeac14bd4ba9f270ad6fea4858fa65f47c39b
```

parent 行出现了。第 2 个新词在此落地:**父提交(parent commit)——commit 对象里的 parent 字段;普通提交一个父,merge 提交两个,根提交零个**。cat-file -p 新提交,内容比上一笔只多一行 `parent bf0597…`,其余逐字相同:同一棵 tree、同一套身份、同样的排版。名字却从 bf0597… 换成 4e5eea…——内容寻址的老规矩,动一行就换名,这桩「小事」本章末尾要拿它做大文章。

再加一笔,链长成三节。把历史能长出的三种形状一次画全——箭头是 parent 指针,从子指向父:

```text
链:     C3 → C2 → C1            每笔记住上一笔的名字

分叉:   C2A → C1 ← C2B          两笔各自认 C1 当父;C1 不记任何孩子

合并:   C2A ← M → C2B           M 的内容里两行 parent,一行抄一个名字
        (C2A、C2B 各自仍指向 C1)
```

图上最值得停一拍的是方向:孩子记父,父不记孩子。做个反事实:假如反过来,父记孩子,会发生什么?造出 C2 时,C1 得改写自己的内容、把 C2 的名字补进去——可对象只进不改,内容一改就是另一个名字,原来的 C1 当场作废,链条跟着散架。何况父落地时孩子还没出生,名字无处可抄。所以指针只能朝一个方向:出生晚的记住出生早的。这个方向顺带解释了「一个父对多个孩子」的不对称:任何一笔提交出生时,它的父已经齐了,至多两三个;孩子却可以有任意多个,而且全部分布在未来——记父是有限的信息,记子是无底洞。

分叉之后怎么合流?靠一笔记两个父的提交。真造一组:

```bash
# 用法示例 · 分叉再合并:两个同刻的分支提交,加一笔双父提交
T=fa0086005716702a3661501fa32495bae7619b91
export GIT_AUTHOR_DATE='@1700003600 +0800' GIT_COMMITTER_DATE='@1700003600 +0800'
C2A=$(git commit-tree $T -p $C1 -m '左侧分支提交')   # 4be7b24bd163591878b10519bdcb3fc8b2ed9bfe
C2B=$(git commit-tree $T -p $C1 -m '右侧分支提交')   # 55e2ac93dc1b4fa6dd9974a57b62eb3e81e5b429
export GIT_AUTHOR_DATE='@1700010800 +0800' GIT_COMMITTER_DATE='@1700010800 +0800'
git commit-tree $T -p $C2A -p $C2B -m '合并两支'
# 325b55d8cd52888b7a935cbda3d0e9ccfa6516e6
```

看看合并提交 M 的全部内容:

```text
$ git cat-file -p 325b55d8cd52888b7a935cbda3d0e9ccfa6516e6
tree fa0086005716702a3661501fa32495bae7619b91
parent 4be7b24bd163591878b10519bdcb3fc8b2ed9bfe
parent 55e2ac93dc1b4fa6dd9974a57b62eb3e81e5b429
author mini-git <mini-git@example.com> 1700010800 +0800
committer mini-git <mini-git@example.com> 1700010800 +0800

合并两支
```

与第一笔提交逐行同款,只多了一行 parent。「merge 和普通提交是两种不同的存储」——这个直觉也值得先替它说句公道话。merge 的操作体验确实特别:冲突现场、双父、GUI 里画成菱形,第 1 章的实验也让你见过 git 内部有不少特殊路径,以为它是一种特殊对象很自然。但存储层面没有第二种:cat-file -t 对 M 回的也是 commit;字节格式与普通提交同一套,差别只有 parent 行的行数,官方那句清单已经说死——0 个、1 个、2 个及以上。第三部分写合并算法时,双亲只是算法的输入,落库仍是同一只 commit 对象。

链、分叉、合流,三种形状摆齐,该给这张图起正式的名字了。第 3 个新词:**提交图(commit graph)——以提交为节点、父指针为边的有向无环图;分支、合并、变基都只是在这张图上的操作**。「有向」你已经推过:边从子指向父,方向由出生顺序锁死。「无环」再推一下:造一笔提交时,父必须已经存在——等会儿 mini-git 的实现里有一道存在性检查,过不了当场报错;而要成环,得让先出生的对象内容里写上后出生对象的名字,时间上做不到。环不存在,「祖先」和「后代」这两个词才永远说得清。

### log 不是读清单,是走图

回到开篇第一问:log 那串名单从哪来?

先替「顺序存在某个列表文件里」的直觉说句公道话。.git 里确实有个 logs/ 目录——第 1 章见过,reflog,「引用移动的流水账」,它就是一份只追加的日志文件。GitHub 的提交列表、IDE 的历史面板,看上去也都是存好的清单。拿「清单」想象历史,日常完全够用。但三条证据说明 log 不是这么读的。其一,官方文档写明了读法:从分支引用的那笔提交出发,原话是「Git will start at the commit ID the branch references」。接下来顺着看——「and then look at the commit's parent(s), the parent's parent, etc.」。翻译:从这笔提交的父、父的父,一路看下去。其二,log 可以从任何一笔开始:`git log <某笔哈希>` 只列这笔的祖先,换个起点,输出就变;一份存死的清单没法同时服务所有起点。其三,也是最硬的:本章稍后 mini-git 用十几行代码写出 log,全程没写过任何清单文件——**顺序不需要存盘,它能从图上现算**。至于 logs/ 目录,它记的是「引用何时指过哪」,是引用的流水账,不是提交历史;第 1 章那句翻旧账用的就是它,两者的分工别混。

顺序本身呢?log 默认新的在前、老的在后,按提交时间(committer 时间戳)降序——真 git 的默认口径如此。同刻的两笔谁先,真 git 没有白纸黑字的承诺;mini-git 会把这条规则自己定死、写进测试:同刻按发现序,遍历时父一先于父二。演练里这条规则还会被真 git 在同一份图上对拍印证——同序,但那是「恰好一致」,不是契约。

## 改一笔,后代哈希全变

现在正面回答开篇第二问。因果链一共三步,每一步都是前几章攒下的旧知识:

1. 后代的内容里抄着祖先的名字。C2 的字节里明晃晃写着一行 `parent bf0597…`,40 个字符一字不少。这不是引用,也不是「指向」,就是把父提交的整个名字抄进了自己的内容。
2. 内容变了,名字必变。第 2 章的担保:名字是「对象头 + 内容」整体的 SHA-1,动一个字节,名字雪崩换人。
3. 传染只沿 parent 边向后。C1 换名后,C2 的 parent 行从此是另一串字节,C2 跟着换名;C3 的 parent 行里抄的又是 C2 的名字,C3 再跟着换;一路传到最新一笔。

把链条做实一点。改写 C1 的消息,再把整条链原样重建(验证一节你会亲手跑),得到的局面是:

| 提交 | 内容里变了的行 | 名字 |
| --- | --- | --- |
| C1 | 消息行 | bf0597… → 04b04e… |
| C2 | parent 行,40 个字符 | 4e5eea… → 307988… |
| C3 | parent 行 | 273a31… → 2161a1… |

C2 的新版消息、时间戳、tree 与旧版逐字相同,唯一差别是 parent 那一行,名字照样整个换人。**后代换名不是因为它们做错了什么,只是它们的字节里抄着祖先的名字。**

慢着——「C1 换名」这个说法本身就不成立。官方文档的原话:「Like all other objects, commits can never be changed after they're created」。翻译:提交一经造出,永不修改。连 amend 也一样,原文说它「creates a new commit with the same parent」——amend 造的是一笔新提交,不是修改旧的那笔。所以「改写历史」的真相是:沿因果链另存一串全新的提交,旧的那串原地不动、一个字节不少,cat-file 照样读得出来。真正变化的只有一件事——分支引用从旧链搬去新链。引用怎么搬家、搬家后旧链为什么就成了没人引用的对象,第二部分讲引用的那一章正面展开;第 1 章破坏实验里那个「add 过但没提交」的中间版对象,和这里的旧链,是同一种命运。

反向推一遍,因果链才算吃透。改写只传染后代:C1 改了,C2、C3 换名;但 C1 的父(如果有)纹丝不动——祖先的字节里不抄后代的名字。分叉图上同理:改 C2A,换名的只有 C2A 自己、M(M 的 parent 行里有 C2A)和 M 的后代;C2B 与 C1 的字节谁也没碰谁。这也是 rebase 天生要「重放」的原因:它就是把一串提交换一个基座逐笔重造,每笔都拿新名字。**改一笔,波及的恰好是「字节里直接或间接抄着它名字」的那串后代,一个不多,一个不少。**

## 演练:从红到绿

手术清单先交代。companion 这轮:src/objects.ts 与 src/trees.ts 一行未改,commit 与 blob、tree 走同一条落盘路。三份旧测试一字未动。新增 src/commits.ts 与 tests/commits.test.ts(22 条)。src/cli.ts 动四处:commit-tree 与 log 两个子命令、身份环境变量读取、log 渲染。最舒服的是 cat-file:一行未改。cat-file -p 对非 tree 对象本来就把内容按 utf8 原文吐回,而 commit 的内容恰是文本——第 2 章铺的路,这一章白捡。

测试的牙齿照例是金样,这次六颗新哈希加一份原文金样,全部是真 git 对同一批固定输入算出、逐字符固化:

```ts
// tests/commits.test.ts · 金样常量
// 金样哈希:真 git commit-tree 对同一批固定输入(同 tree、同身份、同时间戳、同消息)算出并固化。
// 「同消息」包括收尾换行——真 git 的 -m 会补一个;库函数按原文收,所以测试里显式写 \n。
const ROOT_TREE = 'fa0086005716702a3661501fa32495bae7619b91' // 第 3 章三层 fixture 的根
const C1 = 'bf05977bd740a2b2fa530935475587501704d0cc' // 根提交,ts 1700000000
const C2 = '4e5eeac14bd4ba9f270ad6fea4858fa65f47c39b' // 第二次提交,ts 1700003600
const C3 = '273a317c713b8e6450d5bb7e4eeaafe320827599' // 第三次提交,ts 1700007200
const SIDE_A = '4be7b24bd163591878b10519bdcb3fc8b2ed9bfe' // 左分支提交,ts 1700003600
const SIDE_B = '55e2ac93dc1b4fa6dd9974a57b62eb3e81e5b429' // 右分支提交,同刻 1700003600
const MERGE = '325b55d8cd52888b7a935cbda3d0e9ccfa6516e6' // 双父合并提交,ts 1700010800
```

展示块之外还有第七样,不是哈希,是原文:把真 git 写出的 C1 的全部字节钉成字符串,当解析金样——拿一只真提交做考卷。金样跨机器成立的前提,是身份与时间全部由调用方注入:库函数 commitTree 直接收 author 参数,函数体里一个时钟都不碰。唯一摸得到机器时间的是 CLI 层身份缺省值里的 Date.now(),测试用它之前先拿 MINI_GIT_TIMESTAMP 钉死。第 2 章「算名字不需要任何 git 状态」的纪律,这一轮落在了提交身上。

照例先立只会抛错的骨架:src/commits.ts 类型与函数签名齐全,函数体一律抛「尚未实现」,让红落在能力缺失上:

```text
# 用法示例 · 红的关键几行
 × commitTree:提交对象落库 > 根提交哈希金样:零父,author 与 committer 两行同身份
   → 尚未实现:commitTree
 × logWalk:提交图遍历 > 链式:从 C3 出发,时间倒序 C3 → C2 → C1,消息逐个恢复
   → 尚未实现:commitTree   ← 该测试先经 commitTree 造提交,红因落在第一只缺牙上
 Tests  21 failed | 41 passed (62)
```

21 条红,红因清一色「尚未实现」;40 条旧测试全绿,公共行为没有回退。22 条新测试里有一条居然是绿的——「缺 -m、缺起点、没 init,给可读的报错」:它只测参数守卫,还没走到提交能力,红它就冤了,和第 3 章那条 init 守卫同款待遇。开始填肉。

### encodeCommit 与 parseCommit:文本的双向门

先看拼装。提交的内容是纯文本,一个模板串就够:

```ts
// src/commits.ts · 拼装:字段变文本
/** 拼一行身份:「author mini-git <mini-git@example.com> 1700000000 +0800」。 */
function identityLine(kind: 'author' | 'committer', who: CommitIdentity): string {
  return `${kind} ${who.name} <${who.email}> ${who.timestamp} ${who.timezone}`
}

/** 把提交字段拼成对象文本:tree/parent/author/committer 头部、一个空行、消息原文。 */
export function encodeCommit(commit: Commit): string {
  const lines = [`tree ${commit.tree}`]
  for (const p of commit.parents) {
    lines.push(`parent ${p}`)
  }
  lines.push(identityLine('author', commit.author), identityLine('committer', commit.committer), '', commit.message)
  return lines.join('\n')
}
```

逐行对上 cat-file -p 看到的样子:tree 行开路,parent 有几个抄几个,author 与 committer 各一行,空一行,消息原文。两个细节值得点破。其一,消息原样进文本,不补换行、不去尾——真 git 的 -m 会替消息补一个收尾换行,mini-git 把这道修饰放在 CLI 层,库函数只收原文,「同内容同名」才算得干净。其二,身份行里名字、邮箱、Unix 秒、时区四个字段用空格分隔;时区原样保留 +0800 这种四位串,不做换算——换算就会把「本机时区」掺进内容,金样立刻飘了。

解析是拼装的逆运算,骨架与 parseTree 同一个路数,只是这次切的是文本行。

```ts
// src/commits.ts · 解析:头部逐行认领(节选)
/** 把提交对象的文本拆回字段;parent 行按出现顺序进数组。 */
export function parseCommit(body: Buffer): Commit {
  const text = body.toString('utf8')
  const blank = text.indexOf('\n\n')
  if (blank < 0) {
    throw new Error('commit 已损坏:找不到头部与消息之间的空行')
  }
  let tree: string | null = null
  const parents: string[] = []
  let author: CommitIdentity | null = null
  let committer: CommitIdentity | null = null
  for (const line of text.slice(0, blank).split('\n')) {
    if (line.startsWith('tree ')) {
      tree = line.slice(5)
    } else if (line.startsWith('parent ')) {
      parents.push(line.slice(7))
    } else if (line.startsWith('author ')) {
      author = parseIdentityLine(line.slice(7))
    } else if (line.startsWith('committer ')) {
      committer = parseIdentityLine(line.slice(10))
    } else {
      // mini-git 不解析 gpgsig、encoding 等可选头部:遇到就当损坏,差异清单里登记
      throw new Error(`commit 已损坏:头部出现了不认识的行 '${line}'`)
    }
  }
```

空行是头部与消息的分界,indexOf('\n\n') 一刀切。头部逐行按前缀认领,parent 出现几行收几行、顺序保留——这个顺序后面有用,「父一先于父二」靠它。循环之外还有几道检查:tree 缺失或不是 40 位、parent 不是 40 位、author 或 committer 缺行,各判各的损坏,与 readObject 校验对象头是同一种洁癖。消息取空行之后的全部原文,一个字符不修饰。唯一如实声明的边界:真 git 的提交可能带 gpgsig 签名、encoding 这些可选头部,mini-git 不认识,遇到就判损坏,这条差异记进附录。

### commitTree:先验货,再落库

```ts
// src/commits.ts · 写入:提交对象落库
/** 校验 tree 与 parents 都真实存在后,把提交对象写进对象库,返回提交名。 */
export function commitTree(gitDir: string, input: CommitInput): string {
  if (readObject(gitDir, input.tree).type !== 'tree') {
    throw new Error(`commit-tree:对象 '${input.tree}' 不是 tree,没法当作提交的目录快照`)
  }
  for (const p of input.parents) {
    if (readObject(gitDir, p).type !== 'commit') {
      throw new Error(`commit-tree:对象 '${p}' 不是 commit,没法当作父提交`)
    }
  }
  const commit: Commit = { ...input, committer: input.committer ?? input.author }
  return writeObject(gitDir, 'commit', Buffer.from(encodeCommit(commit), 'utf8'))
}
```

先验货,后落库:tree 必须真实存在且是 tree,每个父必须真实存在且是 commit,过不了当场报错。这道检查同时是上一节「无环」的施工保证——父必须已经出生,环在物理上就造不出来。最后一行是第 2 章的 writeObject 原样复用:对象头写 commit,落盘走松散对象那条老路,与 blob、tree 同一个家。committer 不给就与 author 相同,mini-git 的 CLI 永远只配一套身份。真 git 里 amend 只换 committer 的场景,要等 mini-git 长出 amend 才谈得上,先记在差异的账上。

### logWalk:广度收集,时间排队

```ts
// src/commits.ts · 遍历:从起点沿 parent 边收全部可达提交
export function logWalk(gitDir: string, head: string): LogEntry[] {
  const seen = new Set<string>()
  const found: LogEntry[] = []
  const queue = [head]
  while (queue.length > 0) {
    const hash = queue.shift()!
    if (seen.has(hash)) {
      continue
    }
    seen.add(hash)
    const commit = requireCommit(gitDir, hash)
    found.push({ ...commit, hash })
    queue.push(...commit.parents)
  }
  return found.sort((a, b) => b.committer.timestamp - a.committer.timestamp) // sort 稳定:同刻保持发现序
}
```

两步走。第一步收集:从起点出发,读出它的 parent 们排进队列,一个个认领。seen 这个集合管「每个只收一次」——分叉图上两条路最终都走到 C1,第二次撞见时直接跳过,这就是双父遍历里公共根只出现一次的机制。队列先进先出,父一总比父二先入队、先认领,同刻规则的来源就在这。第二步排序:按 committer 时间戳降序;现代引擎的 sort 是稳定排序,同刻的两笔保持第一步的发现序。规则完整表述就一句:时间戳大的在前;同刻,先发现的在前,父一先于父二。测试里专门钉着「时钟倒挂」的用例——子比父还早时,输出里父排在前面:排序只认时间,不看图形状。

CLI 这边的接线收进折叠:

<details>
<summary>点开看:identityFromEnv、cmdLog 与 renderLogEntry(src/cli.ts 本轮改动,节选)。</summary>

```ts
// src/cli.ts · 身份、log 命令与 log 渲染(节选)
/** 身份与环境:mini-git 不偷看任何机器状态,名字/邮箱/时间全部由环境变量声明。 */
function identityFromEnv(): CommitIdentity {
  const stamp = process.env.MINI_GIT_TIMESTAMP
  return {
    name: process.env.MINI_GIT_AUTHOR_NAME ?? 'mini-git',
    email: process.env.MINI_GIT_AUTHOR_EMAIL ?? 'mini-git@example.com',
    timestamp: stamp !== undefined ? Number(stamp) : Math.floor(Date.now() / 1000),
    timezone: process.env.MINI_GIT_TZ ?? '+0800',
  }
}

function cmdLog(cwd: string, args: string[]): string {
  const [head] = args
  if (args.length !== 1) {
    throw new Error('用法:mini-git log <起点提交>;从这一个提交出发往回走')
  }
  return logWalk(requireGitDir(cwd), head).map(renderLogEntry).join('\n\n')
}

/** 一条 log:段落形状对齐真 git;日期列印 Unix 秒与时区原文,不换算本地日历。 */
function renderLogEntry(c: LogEntry): string {
  const body = c.message.endsWith('\n') ? c.message.slice(0, -1) : c.message
  const lines = [
    `commit ${c.hash}`,
    `Author: ${c.author.name} <${c.author.email}>`,
    `Date:   ${c.author.timestamp} ${c.author.timezone}`,
    '',
  ]
  for (const line of body.split('\n')) {
    lines.push(`    ${line}`)
  }
  return lines.join('\n')
}
```

cmdCommitTree 的参数解析与 hash-object 同款:一个 tree 位置参数、可反复出现的 -p、一个 -m,缺谁报谁。-m 的消息在这一层补收尾换行,对齐真 git -m 的做法;库函数仍收原文。renderLogEntry 的段落形状对齐真 git——commit 行、Author 行、Date 行、空行、缩进四格的消息,多行消息逐行缩进。Date 行打的是 author 时间戳,真 git 默认格式显示的也是作者时间;排序按 committer 时间戳,与真 git 默认排序口径一致。mini-git 里两行永远同值,这个区分先摆在这,免得日后与真 git 对拍时糊涂。

</details>

跑全量门槛:

```text
# 用法示例 · 全量门槛
$ pnpm typecheck        ← 无输出即 0 错误
$ pnpm test
 ✓ tests/smoke.test.ts (3 tests)
 ✓ tests/objects.test.ts (18 tests)
 ✓ tests/trees.test.ts (19 tests)
 ✓ tests/commits.test.ts (22 tests)

 Test Files  4 passed (4)
      Tests  62 passed (62)
```

22 条新测试按三类图形铺开:链式(倒序与消息恢复)、分叉(两支各自回溯到同一个根)、双父(一次遍历走完两支、公共根恰好出现一次、整库对象数钉死)。另有「改一笔重建链,三代名字全换、旧对象一个不少」的断言、原文解析金样与一批报错行为。

## 亲手验证:先猜,再跑

还在 commit-lab 的话清场重来,这次全用你自己的 git:

```bash
# 用法示例 · 清场,改用 mini-git 造历史
cd commit-lab && rm -rf .git a.txt lib lib.txt
MG=../companion/node_modules/.bin/tsx
CLI=../companion/src/cli.ts
$MG $CLI init
printf 'hello world\n' > a.txt
printf 'note\n' > lib.txt
mkdir -p lib/deep
printf 'util\n' > lib/util.txt
printf 'hello world\n' > lib/deep/leaf.txt
$MG $CLI write-tree
# fa0086005716702a3661501fa32495bae7619b91
```

第一猜,对拍加改写。先造三连链。身份一个环境变量都不用配:mini-git 的缺省身份恰好就是金样那套。时间每笔钉一次。

```bash
# 用法示例 · mini-git 造链:时间钉死,输出应与真 git 一致
export MINI_GIT_TIMESTAMP=1700000000
C1=$($MG $CLI commit-tree fa0086005716702a3661501fa32495bae7619b91 -m '第一次提交')
export MINI_GIT_TIMESTAMP=1700003600
C2=$($MG $CLI commit-tree fa0086005716702a3661501fa32495bae7619b91 -p $C1 -m '第二次提交')
export MINI_GIT_TIMESTAMP=1700007200
C3=$($MG $CLI commit-tree fa0086005716702a3661501fa32495bae7619b91 -p $C2 -m '第三次提交')
echo $C1 $C2 $C3
$MG $CLI log $C3
```

动手前先写预测:三个哈希与本章开头真 git 造出的那三个,是逐字符相同、部分相同,还是毫无关系?log 会打出几段,谁在最上面?写完再跑。

对答案:三个名字逐字符相同——同一棵 tree、同一套身份、同一批时间戳、同一批消息(含收尾换行),内容寻址没有第二种答案。log 打出三段,C3 在最上:

```text
# 用法示例 · mini-git log $C3 的输出
commit 273a317c713b8e6450d5bb7e4eeaafe320827599
Author: mini-git <mini-git@example.com>
Date:   1700007200 +0800

    第三次提交

commit 4e5eeac14bd4ba9f270ad6fea4858fa65f47c39b
Author: mini-git <mini-git@example.com>
Date:   1700003600 +0800

    第二次提交

commit bf05977bd740a2b2fa530935475587501704d0cc
Author: mini-git <mini-git@example.com>
Date:   1700000000 +0800

    第一次提交
```

想让真 git 当场认账,补一个空骨架让它复读:

```bash
# 用法示例 · 真 git 在同一对象库上复读
git init -q -b main .
git log --oneline $C3
# 273a317 第三次提交
# 4e5eeac 第二次提交
# bf05977 第一次提交
```

然后是本章的招牌实验:改写第一笔。C1 的消息补三个字,C2、C3 的消息、时间、tree 全部原样重建。

```bash
# 用法示例 · 改写第一笔:后代原样重建
export MINI_GIT_TIMESTAMP=1700000000
C1B=$($MG $CLI commit-tree fa0086005716702a3661501fa32495bae7619b91 -m '第一次提交(修订)')
export MINI_GIT_TIMESTAMP=1700003600
C2B=$($MG $CLI commit-tree fa0086005716702a3661501fa32495bae7619b91 -p $C1B -m '第二次提交')
export MINI_GIT_TIMESTAMP=1700007200
C3B=$($MG $CLI commit-tree fa0086005716702a3661501fa32495bae7619b91 -p $C2B -m '第三次提交')
echo $C1B $C2B $C3B
find .git/objects -type f | wc -l
$MG $CLI cat-file -t $C3
```

三个预测先落纸。C1B 与 C1 不同,这没有悬念。C2B 呢——它的消息、时间戳、tree 与 C2 逐字相同,名字变不变?对象库变成几个文件,10、11 还是 12?旧 C3 还能 cat-file 吗?跑。

对答案:C1B=04b04e…、C2B=307988…、C3B=2161a1…,三个全换。C2B 的内容与 C2 只差一行——parent 里的 40 个字符,第 2 章的雪崩在「抄来的名字」上照样生效。对象库 12 个:旧的 9 个一个没少,tree 是同一棵直接复用,新增的只有 3 笔 commit。cat-file -t $C3 照样回 commit——旧历史活得好好的,改写历史改的是「接下来引用谁」,不是旧对象本身;第 1 章地图里那句对象库「只进不改」,这里第二次兑现。

第二猜,分叉与双亲。从原 C1 再分两支,同刻;然后一笔双父的合并。先猜三个数:log 从合并提交出发打出几段?C1 出现几次?同刻的左右两支谁排前面?第三个考的是本章声明的规则,答得出「父一先于父二」再动手。

```bash
# 用法示例 · 分叉合并:两个同刻分支提交 + 一笔双父
export MINI_GIT_TIMESTAMP=1700003600
SA=$($MG $CLI commit-tree fa0086005716702a3661501fa32495bae7619b91 -p $C1 -m '左侧分支提交')
SB=$($MG $CLI commit-tree fa0086005716702a3661501fa32495bae7619b91 -p $C1 -m '右侧分支提交')
export MINI_GIT_TIMESTAMP=1700010800
MGH=$($MG $CLI commit-tree fa0086005716702a3661501fa32495bae7619b91 -p $SA -p $SB -m '合并两支')
$MG $CLI log $MGH | head -5
find .git/objects -type f | wc -l
```

对答案:四段——MERGE、左、右、C1。C1 只出现一次,两条路都在它身上会合,seen 集合把第二次撞见拦下了。左在前:SA 是父一、先入队。对象库 15 个文件:第一猜的 12 个之上只多三笔 commit,tree 仍是同一棵直接复用。真 git 在同一份图上怎么排,直接对拍。

```bash
# 用法示例 · 同图对拍:真 git 的默认序与日期口径
git log --oneline $MGH
git log -1 $MGH
```

--oneline 四行的次序与 mini-git 逐行相同,左侧在前——mini-git 自定的同刻规则与真 git 的默认行为在这份图上恰好一致(真 git 对同刻次序没有承诺)。第二条命令则露出两处如实的差异。一处是日期:真 git 的 Date 行是换算过的日历,`Date:   Wed Nov 15 09:13:20 2023 +0800`,mini-git 打原文 `Date:   1700010800 +0800`。另一处是双父提交多出来的一行 `Merge: 4be7b24 55e2ac9`。渲染不做换算,是为了让输出能被固定时间戳的测试逐字符钉住;这两条连同 gpgsig 可选头部不解析,都记进差异附录。

第三猜,定向破坏。指认一行:src/commits.ts 里 logWalk 末尾的排序比较器,把 `b.committer.timestamp - a.committer.timestamp` 改成 `a.committer.timestamp - b.committer.timestamp`——两个字母对调,时间变成升序。收集、去重、遍历、渲染全部一行不动。先写预测:pnpm test 红几条?「同刻规则:先发现的在前」那条红不红?跑。

对答案:恰好 5 条红——链式、分叉、双父三条遍历序,「排序看时间戳不看图形状」,加 log 整段金样。公共起点只有一个:时间方向反了,新提交排到了下面。而「同刻规则」那条居然还绿:它断言的只是「左在右之前」,这个次序由发现序决定,与时间方向无关——它守的是同刻时的排队规则,不守时间本身的方向。把比较器改回原样再跑,62 条全绿,复原确认。

## 收束:历史是遍历出来的,改写是另存出来的

开篇两问一起收口。log 的名单不是读出来的清单:从起点提交出发,沿 parent 边把可达的提交收齐,按时间戳排队,屏幕上的每张卡片都是现算的。所以任意一笔都能当起点,同刻怎么排也轮不到某个文件说了算。哈希全变也不是惩罚:后代的字节里抄着祖先的名字,祖先一旦换内容,抄本从 parent 行起就成了新字节、新名字,沿因果链传到最新一笔。旧的那串一个没少,只是不再被引用——改写历史从来都是另存新链,不是修改旧链。

第 1 章 6 对象的账,到这里全部结清:3 份文件内容(第 2 章)、2 份目录记录(第 3 章)、1 份提交记录(本章),三种角色你都亲手造过、亲手拆过,第一部分收官。快照模型的物理实体三件套——blob、tree、commit——在对象库里互相指认,构成 .git 里全部的历史。但日常的一条 git commit 背后还欠着一块。mini-git 的 write-tree 扫的是工作区,真 git 吃的是暂存区,第 3 章登记过这笔差异。而且眼下造一笔提交要手抄 tree 哈希、手钉时间戳,真 git 的 add + commit 一次办完——中间隔着的正是那个还没拆开的 index 文件,下一章就拆它。

零件柜里这一章添的东西不多。三个词:commit 对象、父提交、提交图。四个函数:encodeCommit、parseCommit、commitTree、logWalk。两条命令:commit-tree 与 log——提交对象的名字已与真 git 逐字符对拍,log 段落同款、日期口径如前声明。倒是 Buffer 六手一次没上场,提交是纯文本。至此对象库里二进制与文本两种货色都齐了,第二部分的 index 文件头会马上把它们请回来。

四道迁移题,先押答案再展开,卡住按提示回查。

<details>
<summary>1. 你 amend 了一笔 5 个提交之前的旧提交,它后面还压着 10 笔后代。amend 之后,哪些提交换了哈希?原来那 11 笔对象还在对象库里吗?凭什么?</summary>

换名的是被改的那笔加全部 10 笔后代——每笔后代的字节里都直接或间接抄着祖先的名字。原来那 11 笔全在:提交只进不改,amend 是另存一笔新提交,旧链原地未动;它们只是暂时没人引用,而对象库不删对象。回查「改一笔,后代哈希全变」。
</details>

<details>
<summary>2. 两笔提交的 committer 时间戳完全相同。mini-git 的 log 让谁排前面?依据哪段代码?真 git 对这个问题是什么态度?</summary>

先发现的在前,父一先于父二。依据是 logWalk 的两步:队列先进先出保证父一先入队先认领,稳定排序保证同刻不重排。真 git 默认按提交时间降序,但同刻次序没有写成契约;mini-git 把自定规则钉死在测试里,并在这份 fixture 上与真 git 对拍一致。回查演练的 logWalk。
</details>

<details>
<summary>3. 反事实:假如提交存的是「孩子指针」——每笔记住它后面那笔的名字,而不是父。造一笔新提交时要不要动旧对象?从最新一笔出发,还能列出历史吗?</summary>

要:旧对象得补写新孩子的名字,可对象只进不改,一改就换名,前史全部作废。也列不出历史:最新那笔还没有孩子,指针一步都没得走;孩子指针只能从老往新走,而 log 要的是从新往旧。记父的方向由「出生晚的才能记住出生早的」锁死。回查「历史是一张图,不是一条链」。
</details>

<details>
<summary>4. 同事断言:「提交里存了它在哪个分支上做的,不然 IDE 怎么显示分支名?」对吗?IDE 那行分支名从哪来?</summary>

不对。提交的全部字节就那几行,没有分支名;分支是 refs/heads 下指向提交的小文件,提交不认识引用。IDE 显示的分支名是反查出来的——看这笔提交落在哪些分支的可达范围里;同一笔提交可以被多个分支包含,「它属于谁」本来就是引用侧的答案。回查「先挖出一笔真的提交」。
</details>
