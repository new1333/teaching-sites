---
title: 和真 git 对拍:你已经写了一个 git
---

# 和真 git 对拍:你已经写了一个 git

你的电脑上此刻装着两个 git。一个是你天天敲的正主;另一个是十一章亲手写出来的 mini-git,从 hash-object 一路长到 clone。两者打过不少照面——每章算金样、对输出,都借过正主的手。但正主从没把你的仓库从头到尾验过一遍货。本章办这场验收:用 mini-git 从零建一个仓库,init、add、commit、branch、checkout、merge 一路做完。然后把真 git 请进来,让它逐个读你的对象、走你的历史。会面的由头,是仓库圈流传很久的一句备份偏方:把 .git 文件夹整个拷走,就等于带走了整个仓库。第 1 章曾用真 git 仓库粗验过这句话,当时留了一句原话:「顺便说,『把 .git 文件夹拷走等于带走整个仓库』这件事,终章我们还要正儿八经地再验一次——用你自己写出来的 git。」今天到期。而它能不能兑现,系在同一个问句上:真 git 读得出你写的对象吗?

另一笔账也一起到期。第 1 章收尾时钉下:「三区域地图先钉在这,终章你会拿着写完的 mini-git,把 add、commit、branch、merge、push 每条日常命令逐一钉回地图上,给整本书收口。」本章后半兑现它:一张「日常命令 → 内部机制」的对照表,每条命令钉回你写过的具体函数与章节。最后清点 mini-git 没造的东西,并把全书那句主问题一次答完。

## 正主验货:mini-git 建仓库,真 git 来读

验证物是新文件 tests/interop.test.ts,十一条对拍。它与前面十章的测试有一处身份差别:前面 211 条不依赖机器上装没装真 git,这一章偏偏要以真 git 当裁判。所以先解决一个问题——没装 git 的机器跑这套测试,应该发生什么?答案写在文件开头:

```ts
// tests/interop.test.ts
/** 探测环境里有没有真 git 可用:找不到可执行文件(ENOENT)或跑不动,都算没有。 */
function gitAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 10_000, env }).status === 0
  } catch {
    return false
  }
}
```

探测只有一问:git --version 跑得动吗。两个方向的测试组都由它把门:

```ts
// tests/interop.test.ts
describe.skipIf(!gitAvailable())('正方向:mini-git 建仓库,真 git 验货', () => {
```

skipIf 是 vitest 的开关:条件成立时整组测试显示为 skipped,不算失败。守卫本身也有测试盯着:把 PATH 指向一个没有 git 的目录,探测必须返回 false。这样无 git 的机器上对拍是显式跳过,不是一片红。

正方向的场景与第 11 章同款,一步不多:一笔提交起步(a.txt 与 lib/b.txt 同笔),建 dev,main 与 dev 各自前进一笔,再合出第四笔。时间戳照旧钉死,于是四笔提交的名字全是金样,任何机器上逐字符相同。第 2 章「内容凭什么担保名字」的论证,在 merge 提交上最后兑现一次:

```ts
// tests/interop.test.ts
it('同一批输入,四笔提交的名字都是金样:跨机器逐字符相同(含 merge 提交)', () => {
  expect(c1).toBe('91ad33a8c5025a6630eaadc4e93e4104a0e3fcfc')
```

c1 是 91ad33a8,main 前进是 f5c9d68f,dev 前进是 fa63246a。merge 提交是 6de8bcd52a71e1dd776cf5b0e5c2fdaa7ab2e4a9。然后正主进场,五项验收,用的 cat-file、rev-parse、fsck 全是底层命令。第 1 章画的那条线,在正主这边同样成立。第一项,cat-file 逐个读:blob 的原文一字不差。tree 的条目清单与 mini-git 自己的渲染逐字符一致,连 100644 与 040000 的文件模式、Tab 分隔与条目排序都在内。第二项,log 走历史:四笔提交的次序与消息,与 mini-git 的 logWalk 完全一致,双父的 merge 提交排在最前。第三项,rev-parse 读引用:main、dev、HEAD 解出的哈希与 mini-git 的 readRef 同答;merge-base 也同答。第四项,拷走实验,下一节单独说。第五项最重:fsck --strict 全面体检,输出为空。对象逐个能解,tree 条目排序合法,引用完好,从引用出发的连通性无一断链。--strict 是正主最严的口径,规矩写在 [git-fsck 文档](https://git-scm.com/docs/git-fsck) 里。

如实交代一段红绿。这套测试没有「能力未实现」的红可吃:被测的每个机制,第 2 章到第 11 章都先红后绿过了关,本章是把验收攒成一场。它自己的首跑倒真红了两条,红因都是我写的断言口径:tree 的渲染不带收尾换行而真 git 的输出带;commit 对象的文本自带收尾换行,两边本该逐字符相等,我却多比了一个。改完两处,222 条全绿。这个红绿也说明对拍的坑从来不在机制,在字节边界——这正是十一章一直在练的眼力。

## 反方向:真 git 建的,mini-git 读回

只验一个方向还不算对拍。反方向由真 git 建仓库:git init、add、两次 commit,身份与日期用环境变量钉死。然后 mini-git 进场读,三条全中。

第一条,cat-file:mini-git 读出的提交原文,与真 git 自己的 cat-file -p 输出逐字符一致——tree 行、author 行、committer 行、空行、消息,一个字节不差。第二条最狠:mini-git 的 status 直接跑在真 git 的仓库上。它要解析真 git 写的 index 文件(含 mini-git 不认识的扩展段),摊平真 git 的 tree 对象,扫真 git 的工作区,再做三态对比——判定是「干净,2 个文件」。再改一处、添一处未跟踪,status 立刻分两段各归各报。第三条,hash-object:对同一文件,两边算出同一个名字。第 5 章说「真 git 生成的 index 字节金样可解析」时还是单点,现在是整条 status 链路横穿两种实现。

双向都通,原因不玄。对象怎么拼字节、名字怎么算、落在哪个路径,都是公开规范,正本写在 [gitformat-loose(5)](https://git-scm.com/docs/gitformat-loose)。mini-git 按规范拼对象头、取 SHA-1,再按「前 2 位目录、后 38 位文件名」落盘。算出的名字与真 git 相同,而名字本身就是存储地址。**兼容不是运气好,是内容寻址按规范执行后的数学结果。**

## 「拷走 .git」再验一次:历史全在,文件不在

第 1 章的反事实是:假如历史需要后台程序守着,把 .git 拷到别处就该失效。当时用真 git 的仓库验过一次;现在仓库是你写的,拷的每个对象也是你写的。测试做的事:把 .git 目录原样复制进一个空文件夹,只带着它跑真 git。

结果分两半。git log --oneline main 完整走完四笔,与原地逐字符相同——历史真的全在 .git 里,对象库加引用,一个字节不缺。另一半是 git status --short:只报两行「 D a.txt」「 D lib/b.txt」,把工作区文件全记成删除。这半边恰好把话说全:拷走 .git 带走的是全部历史,带不走你的文件——工作区是目录里的普通文件,不是 .git 的财产。备份偏方成立,但要加半句注脚:想在新位置连文件一起恢复,补一次 checkout,把 tree 对象检出来。

## 亲手验证:先猜,再跑

开实验场。先照测试的场景把 interop-lab 建起来:

```bash
# 用法示例 · 建 interop-lab:两笔起步,dev 前进一笔,main 合并 dev
cd ..                                  # 来到课程根(mini-git-ts-course/)
mkdir interop-lab && cd interop-lab
MG=../companion/node_modules/.bin/tsx
CLI=../companion/src/cli.ts
$MG $CLI init
mkdir lib
printf 'one\n' > a.txt
printf 'two\n' > lib/b.txt
$MG $CLI add a.txt
$MG $CLI add lib/b.txt
MINI_GIT_TIMESTAMP=1700000000 $MG $CLI commit -m '第一次提交'
$MG $CLI branch dev
printf 'one\ntwo\n' > a.txt
$MG $CLI add a.txt
MINI_GIT_TIMESTAMP=1700003600 $MG $CLI commit -m 'main 前进'
$MG $CLI checkout dev
printf 'two\ndev\n' > lib/b.txt
$MG $CLI add lib/b.txt
MINI_GIT_TIMESTAMP=1700007200 $MG $CLI commit -m 'dev 前进'
$MG $CLI checkout main
MINI_GIT_TIMESTAMP=1700010800 $MG $CLI merge dev
```

第一猜,正主读历史。回车前押两样:几行;每行的哈希是哪几个。时间戳全钉死,所以这题有唯一答案。押完跑:

```bash
# 用法示例 · 真 git 走 mini-git 的历史(autocrlf 口径沿用第 2 章)
git -c core.autocrlf=false log --oneline main
# 6de8bcd Merge branch 'dev'
# fa63246 dev 前进
# f5c9d68 main 前进
# 91ad33a 第一次提交
```

四行,与测试金样逐字符相同——你机器上也是这四个哈希。再顺手一枪:git -c core.autocrlf=false show main:a.txt,应原样吐出 one 加 two 两行。show 能按路径从 tree 一路解到 blob,正主认的是全套结构,不只认哈希。

第二猜,体检。押:git -c core.autocrlf=false fsck --strict 会输出几行。跑,答案是一行都没有——零输出即全过。你写第 3 章 tree 编码时逐字节对拍过的条目排序,在这里被正主按最严口径重新审了一遍。

第三猜,拷走。开一个空的 interop-backup,把 interop-lab 的 .git 目录原样复制进去(只拷 .git,工作区不带——上一节测试就是这么做的):`mkdir interop-backup && cp -r interop-lab/.git interop-backup/`。押:在新目录里 git log 几行;git status --short 几行、什么形状。跑完对答案:log 四行原样;status 两行「 D」。解释已在上一节:历史住在对象库与引用里,跟着 .git 走;工作区文件不跟。

第四猜,定向破坏。这次指认的不是代码行,是一个对象文件:.git/objects/81/ 下面那个 4f4a 开头的文件,身份是 main 前进那笔的 a.txt blob。删掉它之前押三样:git cat-file -p 814f4a42… 报什么;git log --oneline main 还能跑吗;git fsck 报什么。押完动手:

```text
# 用法示例 · 删掉一个 blob 后的三个现场
$ rm .git/objects/81/4f4a422927b82f5f8a43f8fab6d3839e3983f2
$ git -c core.autocrlf=false cat-file -p 814f4a422927b82f5f8a43f8fab6d3839e3983f2
fatal: Not a valid object name 814f4a422927b82f5f8a43f8fab6d3839e3983f2
$ git -c core.autocrlf=false log --oneline main
6de8bcd Merge branch 'dev'      ← 四行原样,一行没少
$ git -c core.autocrlf=false fsck
missing blob 814f4a422927b82f5f8a43f8fab6d3839e3983f2
```

对答案:cat-file 翻车;log 活得好好的;fsck 点名 missing blob。逐条解释。log 走历史只需要 commit 对象沿父提交追,tree 与 blob 它根本不碰,缺一个 blob 伤不到遍历。cat-file 直取对象,名字在对象库里找不到对应文件,当场 fatal。真 git 的接纳是有条件的:名字与内容必须对得上账。这正是第 2 章「SHA-1 既是名字又是封条」在正主那边的执行现场。fsck 做的是连通性巡检,从引用出发走 tree 条目,发现断链就报案。哪层守什么,一层一层各归各。

复原不用重建仓库,这步本身就是最后一场演出。那个 blob 的内容就是 one 加 two 两行字:

```bash
# 用法示例 · 凭内容把对象放回原位
printf 'one\ntwo\n' > fix.txt
$MG $CLI hash-object -w fix.txt     # 814f4a422927b82f5f8a43f8fab6d3839e3983f2
git -c core.autocrlf=false fsck     # 零输出:断链已接回
```

对象没了,内容还在,名字就还能算出来。hash-object -w 把同名对象原样落回原位,fsck 立刻归零。内容寻址的仓库里,所谓备份就是内容本身:文件丢了,名字还能从内容算回来。

第五猜,反方向。让正主自己建一个:

```bash
# 用法示例 · 真 git 建仓库,mini-git 来读
cd ..
mkdir interop-real && cd interop-real
git init
printf 'real\n' > x.txt
git -c core.autocrlf=false add -A
git -c user.name=mini-git -c user.email=mini-git@example.com \
  -c core.autocrlf=false commit -m '真 git 的第一笔'
```

押两样:mini-git status 说什么;mini-git cat-file -p 读出的提交原文,与真 git 的 cat-file -p HEAD 差几个字符。跑:

```bash
# 用法示例 · mini-git 读真 git 的仓库
$MG $CLI status
# 干净:工作区、暂存区与 HEAD 三方一致(1 个文件)
HASH=$(cat .git/refs/heads/*)
diff <($MG $CLI cat-file -p "$HASH") <(git -c core.autocrlf=false cat-file -p HEAD; echo) && echo 逐字符一致
# 逐字符一致
```

对答案:干净;零字符差——git 侧垫的那个 echo 要交代一句:mini-git 的 CLI 打印层会给输出补一个收尾换行,垫上才同形,这正是第 3 章说过的「坑在字节边界」。对象文本本身逐字符一致。git init 建的分支名可能是 main 也可能是 master,所以取哈希用通配读引用文件——分支叫什么不碍事,引用文件里那 40 位才是内容。

## 日常命令 → 内部机制:第 1 章的地图钉满

对拍收官,还最后一笔账。第 1 章给的三区域地图——工作区、暂存区、对象库,add 与 commit 各搬一跳——当时只画了半张:你不知道清单是什么文件、历史长什么形状、分支凭什么瞬间建成。现在全书写完,把日常命令逐条钉上去,每条都落到你亲手写过的函数:

| 日常命令 | 内部到底动了什么 | 你写过的零件 |
| --- | --- | --- |
| add | 文件内容落成 blob 对象;「路径 → 对象名」登记进暂存区 | writeObject(第 2 章)+ index 登记(第 5 章) |
| commit | 清单冻结成 tree 对象,包一层 commit 对象,分支引用改写到新哈希 | writeTreeFromIndex(第 5 章)+ commitTree(第 4 章)+ updateRef(第 6 章) |
| status | 工作区、暂存区、HEAD 两两比对,分四类报告 | classifyStatus 的三态对比(第 5 章) |
| diff | 行级最长公共子序列求编辑脚本,排成带 hunk 的 unified diff | diffLines / renderUnified(第 7 章) |
| branch | 写一个 41 字节的引用文件,O(1) | updateRef(第 6 章) |
| checkout | 检出目标提交的 tree,HEAD 换指向;给哈希则进 detached HEAD | checkoutTree(第 3 章)+ attachHead / detachHead(第 6 章) |
| merge | 找最近公共祖先当 base,判三种结局;真合并产双父 merge 提交 | mergeBase / isAncestor(第 8 章)+ mergeCommits(第 9 章) |
| pull | 大致等价于 fetch 加一次整合(默认只快进,merge 是其中一档) | fetchObjects(第 11 章)+ 第 8-9 章判定与合并 |
| push | 把新尖端的可达闭包送给对端的 bare 仓库;服务端量 isAncestor,非快进拒绝 | pushObjects + 服务端把关(第 11 章) |
| clone | 引用发现、全量拉对象、检出、重建清单 | cloneRepo(第 11 章),握手来自第 10 章 |

pull 那行的措辞跟着现行 [git-pull 文档](https://git-scm.com/docs/git-pull)走。文档把 pull 拆成两步,第一步的原话:「First, git pull runs git fetch with the same arguments (excluding merge options) to fetch remote branch(es).」第二步是整合,文档列了四种方式,并点明默认档:「git pull --ff-only will only do "fast-forward" updates: it fails if your local branch has diverged from the remote branch. This is the default.」——真正跑 merge 的是 --no-rebase 那一档。所以那句流传最广的「pull 就是 fetch 加 merge」,按现行默认说成「fetch 加一次能快进就快进、分叉就喊停的整合」更准。你在第 11 章亲手分开做过这两步;那个「fetch 完工作区没变」的谜,谜底就是 pull 把两步叠成了一步的记忆。

现在可以给「日常命令还有一层未揭穿的魔法」这条直觉一个公道和一张验尸单。公道话:porcelain 确实比 mini-git 多做很多事。冲突时 index 的三阶段登记、checkout 前的脏改动检查、传输时的打包压缩,这些工程加固你都没见过内部,笼统感觉「还有一层」很合理。验尸单就是上面这张表:表里没有任何一行引用了你没写过的机制。add 是对象加登记,commit 是冻结加挪引用,push 是搬运加把关,每一行都分解到了具体函数。剩下的差异,下一节那份诚实的清单会逐条交代。

## mini-git 没造的东西

正主比 mini-git 多的零件,按影响从大到小点名,每条一句,详细的分岔记录集中在差异附录(divergence):

- packfile——把许多对象打进一个文件再压缩、传输、存储。mini-git 全程松散对象,线上也是一个一个送。这是最大的一块,真 git 的省空间与快传输全靠它。
- 多轮协商——真协议的 want 与 have 要来回对账多轮;mini-git 的会话一轮定案。
- rebase——改写历史一族命令。mini-git 从没动过已存在的对象:对象库只进不改,「改写」永远等于造新对象。
- reflog——引用移动的流水账。第 8 章见过它的用处:真 git 靠它兜底找回游离提交,mini-git 的库里没有这层保命符。
- submodule——把别的仓库当作一个条目挂进 tree;mini-git 的文件模式只认普通文件、可执行与目录。
- 其余小件:tag 引用、gc 行刑者、stash、packed-refs、push 的 refspec 与 --force……都在差异附录逐条登记。

这份清单不是败绩表。每一条都是你已经能指出「它补在地图哪一格」的未完成项:packfile 是对象库的另一种存放形态,协商是引用发现之后更多的对话轮次,rebase 是提交图上的重放。知道自己没造什么、它挂在哪,和造过一样是能力。

## 收束:那句主问题的完整答案

全书的主问题只有一句:git add 之后、push 之前,.git 里到底发生了什么?一条命令如何变成一堆对象和引用?现在用你写过的每一行代码作答。

add 把工作区文件的内容加上对象头、取 SHA-1,落成对象库里的松散对象,再把「路径 → 对象名」写进 index 文件这份暂存区清单。commit 把清单冻结成一棵 tree 对象,包一层 commit 对象,里面记着 tree、父提交、作者与时间,最后把当前分支那个 41 字节的引用文件改写成新哈希。所谓分支前进,物理上就是那一行字的改写;所谓历史,就是对象库里这些互相指名的普通文件,一张提交图。图的每个节点是一份完整快照,快照模型的账法从第 1 章数到今天。merge 在图上找最近公共祖先,要么 fast-forward 只挪引用,要么三方合并产一笔双父提交。fetch 把缺的对象搬进对象库,只前移 remote-tracking 引用。push 是同一套搬运,加上服务端那把 isAncestor 的闸。clone 是引用发现加全量拉取加检出。.git 里自始至终没有数据库进程,也没有后台守护,变的只是一群普通文件的增与改。

十个特性,十句对账。

| 特性(章) | 你现在能做到的事 |
| --- | --- |
| 对象库(第 2 章) | 亲手算出对象名,说出同名即同内容的担保 |
| tree 对象(第 3 章) | 用 Buffer 拆装目录快照的字节,十六进制转储手工划边界 |
| 提交图(第 4 章) | 拆解 commit 对象,推出改一笔而后代哈希全变 |
| index(第 5 章) | 按字节拆装暂存区,用三态对比解释 status 的每一段 |
| 引用与分支(第 6 章) | 说出分支是一个文件、HEAD 是符号引用、detached 为何危险 |
| 行级 diff(第 7 章) | 从最长公共子序列推出红绿行与 hunk 边界 |
| 祖先与 base(第 8 章) | 用可达性判 ff、判生死,找出最近公共祖先 |
| 三方合并(第 9 章) | 背出判定表,产出与真 git 同格式的冲突标记 |
| 传输协议(第 10 章) | 手工标出 pkt-line 帧界,起服务列出引用清单 |
| 远端同步(第 11 章) | 算清 fetch 缺什么、push 谁把关、clone 重建什么 |

外加这份验收:mini-git 从零建的仓库,真 git 用 cat-file 逐对象读、用 log 走历史、用 fsck 最严口径体检,全数通过。反方向,真 git 建的对象与清单,mini-git 原样读回。两个实现,一个对象库。

第 1 章的旧题,现在重答一遍。不看书,先答,再展开对照。

<details>
<summary>1. 在 interop-lab 的 dev 分支上改 lib/b.txt,忘了 add 直接 commit。这笔提交里有新内容吗?提交之后 status 报哪一段?怎么用 cat-file 拿铁证?</summary>

没有。commit 只收暂存区清单,清单里还是旧 blob。status 报「未暂存的变更:修改:lib/b.txt」。铁证:mini-git cat-file -p 依次拆新旧两笔提交,两行 tree 哈希完全相同——清单没变,冻结出来的快照就没变,名字自然相同。回查第 5 章「commit 收清单」与第 2 章内容寻址。
</details>

<details>
<summary>2. 只拷 .git 与拷整个文件夹,新位置的两条 git 命令各差在哪一条？差的那个是 .git 的财产吗？</summary>

git log 两条路都能完整跑——历史在对象库与引用里,跟着 .git 走。差的是 git status:只拷 .git 时工作区文件缺席,全部记成删除。工作区是目录里的普通文件,不是 .git 的财产,要恢复得 checkout 一次。回查本章「拷走 .git 再验一次」。
</details>

<details>
<summary>3. 在 mini-git 仓库里删掉 .git/index:mini-git status 与真 git status --short 各报什么？谁的 log 死了？mini-git 怎么复原？</summary>

两边同判:mini-git 报「已暂存的变更:删除:a.txt」加「未跟踪的文件:a.txt」;真 git 报一行「D  a.txt」加一行「?? a.txt」。清单空了,拿空清单与 HEAD 比是删除,与工作区比是未跟踪——两个实现读同一个文件,算同一笔账。谁的 log 都没死:历史在对象库与引用里。mini-git 的复原是 checkout main:检出当前提交,按结果重建清单,status 回到干净。回查第 1 章「删掉暂存区实体」与第 5 章 index 解析。
</details>

你从「项目-最终版-真最终版」的文件夹堆里出发,终点是一个能被正主验货的 git——对象、树、提交、引用、合并、传输,每一层都经过你的手。往后再敲任何一条日常命令,底下发生的事你都在源码里写过一遍。这就是这门课想给的底气:git 不再是魔法,是一群你能读懂、能重写、能验货的普通文件。
