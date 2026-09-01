---
title: fetch、push、clone:把图搬到另一边
---

# fetch、push、clone:把图搬到另一边

推送偶尔会在一切正常的时候被原样退回。终端没有半点异常,回车之后却回来一行带感叹号的判词:`! [rejected] main -> main (non-fast-forward)`。被拒绝三个字先入为主,多数人的第一反应是查网络、查权限,查一圈什么毛病都没有。因为这既不是网络的事,也不是权限的事:这行判词是远端认真读过你的提交图之后,亲手写下的裁定。

另一件怪事更早就在你眼皮底下发生过。git fetch 跑完,明明报告拉下来了新东西,打开文件一看,工作区没变,内容还是旧的;status 也干净。拉下来的东西去了哪?它为什么不顺手把文件更新掉?

这两个谜共用一个答案:远端同步动的东西与不动的东西之间有一条精确的分界线,而这条线画在引用上。本章把三个在仓库之间搬图的命令——fetch、push、clone——逐一放到这条线上量一遍。量完你会发现,没有一个需要新发明机制,全是旧零件的重新上岗。

两笔旧账先摆出来。第 8 章收束时埋的雷,原话是:「push 偶尔吃的一记『non-fast-forward』拒绝。远端拿它手里的旧尖端与你的新尖端做的那次祖先判定,用的正是今天这把 isAncestor。同一把尺子,本地量 merge,远端量 push」。第 10 章收束时又立了一张底牌:「fetch 拿它算『我缺哪些对象』,push 拿它算『对方会不会拒我』,空仓库那张零号占位行也会在 clone 空仓库时再见面。清单还是这张清单,一个字节不用重算」。两笔都在本章兑现,兑现处会逐字对上。

本章三步走。先拆 fetch:它动什么、不动什么,以及「缺哪些对象」怎么算。再拆 push:把关的尺子为什么还是 isAncestor,拒绝时到底拒绝了什么。然后是裸仓库与 clone。最后落进 mini-git:src/remote.ts 的五个函数加三条命令,先红后绿。

## fetch:动的是对象库,记账的是 remote-tracking 引用

先从最顽固的那条直觉下手:远端的 main 和本地的 main,听起来就是同一个分支。替它说句公道话:两个名字确实都叫 main,log 里长得一模一样,pull 之后两边常常相等,「同一个东西的两个叫法」在日常生活里是省事的好默认。它不成立的地方在文件系统里:本地分支是 refs/heads/main 这个 41 字节的小文件,远端分支在你这边的记录却是另一个文件,躺在另一个命名空间里。这个目录的职责,官方文档 [gitrepository-layout](https://git-scm.com/docs/gitrepository-layout) 写了一句。原话如下。「records tip-of-the-tree commit objects of branches copied from a remote repository」。中译:记下从远端仓库复制来的各分支的尖端。本章第一个新词落定。**remote-tracking 引用——refs/remotes/<远端名>/<分支> 下的本地引用文件,记录「上次同步时,远端的这条分支停在哪」。**它不是远端的东西,是你本地的一张记号:fetch 每跑一次,就把记号挪到远端此刻的位置。

真 git 的远端名默认叫 origin,[Pro Git 的远程分支一节](https://git-scm.com/book/zh/v2/Git-分支-远程分支)讲过它的来历:克隆时自动命名,`-o` 可以换。mini-git 没有配置文件,远端名直接从地址折出来:`127.0.0.1:9419` 折成 `127.0.0.1-9419`,冒号不是引用路径里的合法字符,换成连字符。于是 fetch 之后的记号文件就是 `.git/refs/remotes/127.0.0.1-9419/main`——第 6 章的手艺:它就是一个普通引用文件,cat 得动,写得出。

有这张记号,「fetch 会更新工作区」这条直觉就好拆了。公道话同样充分:日常流程里大家敲的是 pull,而 pull 是 fetch 加 merge,工作区确实每次都动了;把两个动作叠成一个记忆,「拉取=更新文件」就成了合理默认。Pro Git 那一节的原话拆两截,第一截:「当 git fetch 命令从服务器上抓取本地没有的数据时,它并不会修改工作目录中的内容」;第二截:「它只会获取数据然后让你自己合并」。fetch 的全部动作只有三样:对象搬进对象库、remote-tracking 引用前移、收工。工作区、暂存区、HEAD、refs/heads 下的本地分支,一概不碰。想把拉下来的东西放进工作区,那是 merge 的活——你在验证节会亲眼看到这个分工。

「本地没有的数据」这六个字,是 fetch 唯一要算的账,算法就是本章的第二个新零件:对象枚举。第 8 章的 ancestorSet 已经做过一半——从尖端沿 parent 边收齐全部可达提交。但搬仓库不能只搬提交名单:每笔 commit 对象只记一个 tree 的名字,目录与文件全在 tree 对象和 blob 里。所以枚举要多走一类边:遇到 commit,把它的 tree 和全部 parent 排进队列;遇到 tree,把每条 entry 指向的对象排进队列;遇到 blob,收下——它是叶子。空口无凭,拿数字算。第一笔提交收录 a.txt 与 lib/b.txt,名下是 2 个 blob、lib 的 tree、根 tree、commit 自己,共 5 个对象。main 前进一笔只改了 a.txt,新添的是新 blob、新根 tree、新 commit,lib 的 tree 一字未动、原样复用,合计 8 个。**提交图的可达性管的是「历史到齐没有」,对象枚举管的是「每一笔历史名下的快照到齐没有」。**

枚举有了,「缺哪些」就是一次集合相减。mini-git 的会话口径是客户端报、服务端算,与真协议的分岔稍后集中声明。客户端把自己全部本地分支与 remote-tracking 引用的尖端各做一次枚举,并集一行一个 have 报过去。清单上想要的对端尖端,则一行一个 want 点名。服务端对 want 的尖端做枚举,减掉 have 集合,剩下的就是该送的。两头共享的那笔第一笔提交,5 个对象一个都不会重发——内容寻址的去重在这里白捡。第二笔账同样算得出:对端若只前进了一笔、改的是 lib/b.txt,缺的就是 4 个对象——新 blob、新 lib tree、新根 tree、新 commit。改子目录里的一个文件,路径上每一层目录都要一份新快照,这正是快照模型的账法。

顺带一句:fetch、push、clone 与 merge 一样是会动状态的 porcelain;ls-remote 只读不写,归底层命令一列。第 1 章画下的那条线,到这里又用上一回。

## push:把关的还是那把 isAncestor

现在回头看开篇那行判词。「push 失败是网络或权限问题」的直觉,公道话很长:你过去撞见的远端失败几乎确实是这两类,断网报 timeout,权限不对报 403,记忆全部由它们构成。而 rejected 这个词,长得也像传输错误。证伪只要一个观察:被拒的那次推送,连接是通的,对象也送到了——判词写在对象送完之后。这不是传输层的故障,是远端在收货之后、动引用之前,做了一次审议。审议用的尺子,就是第 8 章那把 isAncestor,一笔旧账在此兑现。

官方文档 [git-push](https://git-scm.com/docs/git-push) 的 PUSH RULES 一节把这条规则写成白纸黑字,原话拆三截。第一截:「If the push destination is a branch (refs/heads/*)」——当推送目的地是分支时。第二截:「only fast-forward updates are allowed」——只允许快进更新。第三截:「which means the destination must be an ancestor of the source commit」——也就是说,目的地必须是源提交的祖先。目的地是远端的旧尖端,源提交是你的新尖端,「旧尖端必须是新尖端的祖先」翻成函数调用就是 isAncestor(旧, 新),与第 8 章 merge 判定表里的那一格一字不差。同一份文档的 NOTE ABOUT FAST-FORWARDS 还给了动机。第一截:「The command by default does not allow an update that is not a fast-forward」——默认不许非快进。第二截:「to prevent such loss of history」——是为了防历史丢失。

反事实替这条规则供血:假如远端不把关,会发生什么?你的 main 在 c2,同事已把远端推到 c3,c3 里有你没有的提交。你的硬推若被放行,远端引用直接从 c3 改写成你的 c2——c3 从此没有任何引用够得着,按第 8 章生死簿的口径,它死了,两周后 gc 收走。丢历史不需要任何一方犯蠢,只需要一次并发的普通推送。把关的成本呢?一次可达集计算,毫秒级。这大概是全书性价比最高的一道闸。

mini-git 的服务端把关有一个顺序上的讲究:先收货,再量尺,后挪引用。原因很实:量尺要沿新尖端往回走 parent 边,走之前新尖端的 commit 对象必须已经落库。于是被拒的推送会留下一笔有趣的副产品——对象全在远端对象库里躺下了,引用却一步没动。这些对象从任何引用都走不到,正是第 8 章判死的那种垃圾,宽限期一到就由 gc 收走。真协议不这么大方:它在协商阶段就能拒,一个字节不收(这条分岔登记在案)。另外,push 送哪些对象也是同一张清单算的账:对端广告里列得出的尖端、且你本地读得到的,它的闭包不用重送;同一尖端推第二遍,送出零个对象。

## 没有工作区的一端:bare 仓库

push 的目的地还有一个身份问题:它凭什么是一个「仓库」?想想服务端那侧如果和你一样,有工作区、有暂存区,HEAD 挂在 main 上。同事一推,远端的工作区算谁的?检出到哪个提交?三态对比拿什么当底?这些问题在真 git 里有两层答案。第一层,服务端落点通常根本没有工作区,本章第二个新词落定。**bare 仓库——没有工作区、没有暂存区,目录本身就是仓库内容的那一端。**官方口径写在 [git-clone](https://git-scm.com/docs/git-clone) 文档的 --bare 一节。前半截:「instead of creating `<directory>` and placing the administrative files in `<directory>/.git`」——不是建一个目录再往里放 .git。后半截:「make `<directory>` itself the $GIT_DIR」——让目录本身成为仓库目录。再一句:「This obviously implies the --no-checkout」——显然连带不检出。理由同段:「because there is nowhere to check out the working tree」——根本没有地方放工作区。mini-git 的 `init --bare` 照此办理:objects、refs/heads、HEAD 直接铺在目录本身,没有 .git 这层壳。

第二层答案是个细节:bare 仓库里仍有一个 HEAD。[gitrepository-layout](https://git-scm.com/docs/gitrepository-layout) 对 HEAD 的描述里有半句。「It does not mean much if the repository is not associated with any working tree」——不挂任何工作区时它没什么可指的。括号里点名了这种仓库:「(i.e. a bare repository)」,说的就是裸仓库。同一条接着讲,不少工具拿 HEAD 猜「默认分支」。这半句正是 clone 挑 HEAD 的依据:服务端广告里的 HEAD 行报出哈希,客户端看它落在哪条分支上,自己的 HEAD(一个符号引用)就跟过去。顺带一句,服务端若处在 detached HEAD,resolveHead 解出裸哈希,HEAD 行照发——这条形状本章测试专门立了一案,不在分支上的 HEAD 也照样发得出来。

clone 本身没有任何新机制,它是已有一切的一次全量排练。引用发现拿到全部分支。本地是空仓库,一个 have 都报不出,want 就是全部分支的尖端。对象入库后,每条远端分支落两个引用:refs/heads 下的本地分支,加上 refs/remotes 下的记号。然后 HEAD 跟远端,tree 检出成工作区,暂存区清单按检出结果重写进 index 文件。第 10 章埋的「零号占位行」也在这里重逢。对端连一条分支都没有时,广告里只有那行 40 个 0 加 capabilities^{},clone 识趣地只建骨架、不建任何分支。不下载任何东西就知道「那边什么都没有」——这行占位符,正是第 10 章那道算术题的收尾。

## 演练:从红到绿

改动面先摆在桌上。src/serve.ts 只动了四处:parseAddress、parseRefLines、ZERO_ID 三个私有名字放成导出。外加 discoverRefs 长了一行——连上就把写侧收掉。这一行是双向会话的礼数:看清单的客人不打算说话,先把自己的话筒收了,服务端读到这层意思就送客。第 10 章的旧服务端不挑这个:它送完清单本来就收线,所以第 10 章的十项测试一行不改、原样全绿,包括那根只读不写的裸 socket。src/objects.ts 加一个 initRepoBare,与 initRepo 并排。重头在新增的 src/remote.ts。导出五个:enumerateObjects、startSyncServer、fetchObjects、pushObjects、cloneRepo。会话与帧装拆的内部函数也住在这里。src/cli.ts 接三条命令 fetch、push、clone,init 收 --bare,serve 换用会话服务端。启动消息跟着改了半句:「送完收线」如实化成「再听来意」——清单还是每条连接先送,送完不再立刻收线,改听对方要什么。

会话协议的口径当场声明,四句话:服务端连上先送第 10 章的引用发现流,然后等;客户端把请求一次说完就收写侧,服务端读到收线才办,办完一次送回再收线。fetch 的请求是 `want <哈希>` 与 `have <哈希>` 各若干行,push 的请求是 `push refs/heads/<分支>:<哈希>` 一行加一串对象。对象在线上的形状:一行头「类型 哈希 字节数」,对象体按至多 65516 字节装进 pkt-line 数据帧——二进制字节原样过,和引用行同一门装帧手艺。装帧拆帧全是 Buffer 的老本行,想亲眼看帧界,第 10 章的十六进制转储随时能再上。真协议是 want/have 多轮协商加 packfile,正本是 [pack-protocol](https://git-scm.com/docs/pack-protocol)。mini-git 一轮定案、松散对象直接上线,分岔集中登记。

测试新开 tests/remote.test.ts,十九条。先立骨架:remote.ts 五个导出一律抛「尚未实现」,cli 接好线,跑本章测试:

```text
# 用法示例 · 红的关键几行
 × push:裸仓库当远端,isAncestor 把关 > 落后被拒:文案点名 non-fast-forward;远端引用不挪,但对象已经落库
   → Error: 尚未实现:startSyncServer(-NWoTCj\.git…, {})
 × 命令层与防线 > 对端只送清单不回话:fetch 等不到回信,报可读的错
   → AssertionError: expected [Function] to throw error including '没等到回信' but got '尚未实现:fetchObjects(…)'
 Tests  17 failed | 2 passed (19)
```

十七条红,红因清一色「尚未实现」,是能力缺失,不是语法或环境错误。两条绿要如实交代:init --bare 与「同步入口指路 runNetCli」都在骨架接线时同步落地,落地即绿,不在红账里。开始填肉。

### enumerateObjects:把树也走全

```ts
// src/remote.ts · enumerateObjects
export function enumerateObjects(gitDir: string, tips: readonly string[]): string[] {
  const seen = new Set<string>()
  const queue = [...tips]
  while (queue.length > 0) {
    const hash = queue.shift()!
    if (seen.has(hash)) {
      continue // 双父两支汇合、两笔尖端共享的祖先与子树,都只收一次
    }
    seen.add(hash)
    const { type, body } = readObject(gitDir, hash)
    if (type === 'commit') {
      const commit = parseCommit(body)
      queue.push(commit.tree, ...commit.parents)
    } else if (type === 'tree') {
      queue.push(...parseTree(body).map((e) => e.hash)) // 子 tree 与 blob 都是条目指向的对象
    }
    // blob 是叶子:内容即全部,不再指向谁
  }
  return [...seen]
}
```

与第 8 章 ancestorSet 骨架相同、队列多进两类东西:commit 的 tree 与 tree 的条目。tree 条目里那份文件模式与名字在这里用不上——枚举只要哈希;模式与名字属于检出时的 checkoutTree。共享去重由 seen 一个集合包办,内容寻址担保同名即同物,连判等都不用做。

### 会话服务端:先送清单,再听来意

```ts
// src/remote.ts · startSyncServer 的连接回调(拼版:去缩进骨架,收线与句柄管理同第 10 章)
socket.on('error', () => {}) // 一条连接的异常不拖垮整个服务
socket.setTimeout(5000, () => socket.end()) // 连上却一直不说话的,5 秒后送客
socket.write(encodeRefAdvertisement(gitDir)) // 清单每条连接现编现送:对端引用变了,下一条就是新值
const chunks: Buffer[] = []
socket.on('data', (chunk: Buffer) => chunks.push(chunk))
socket.on('end', () => {
  // 对方收掉了写侧:请求说完了,现在办
  try {
    handleSync(gitDir, socket, Buffer.concat(chunks))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    socket.end(Buffer.concat([pktEncode(`error ${msg}\n`), FLUSH_PKT]))
  }
})
```

第 10 章的服务端只会一件事:送完即收线。会话服务端多等一步:攒下对方说的每一个字节,等写侧收线了再一口气办。请求的首帧说 want 走 fetch 路线,说 push 走推送路线,一个字节不说就是来看清单的客人,送客了事。超时那行是给教学服务的体面:一根只读不写的裸连接(比如你第 10 章用过的那行 node 单行命令)五秒后也能等到收线。

### handlePush:先收货,再量尺

```ts
// src/remote.ts · handlePush
function handlePush(gitDir: string, socket: Socket, frames: { kind: 'data'; payload: Buffer }[]): void {
  const first = lineOf(frames[0])
  const m = /^push (refs\/heads\/[A-Za-z0-9._/-]+):([0-9a-f]{40})$/.exec(first)
  if (!m) {
    throw new Error(`push 请求的第一行 '${first}' 不成形状(该是 push refs/heads/<分支>:<哈希>)`)
  }
  const [, ref, tip] = m
  storeObjectFrames(gitDir, frames.slice(1))
  const current = readRef(gitDir, ref)
  if (current !== null && !isAncestor(gitDir, current, tip)) {
    // 对端这条分支上有客户端缺的提交:硬推会让它们失去引用,拒绝
    socket.end(Buffer.concat([pktEncode(`ng ${ref} non-fast-forward\n`), FLUSH_PKT]))
    return
  }
  updateRef(gitDir, ref, tip)
  socket.end(Buffer.concat([pktEncode(`ok ${ref}\n`), FLUSH_PKT]))
}
```

第 8 章埋的那笔账在 `!isAncestor(gitDir, current, tip)` 这一行结清:current 是远端手里的旧尖端,tip 是客户端的新尖端,判的正是「旧必须可达自新」。不成立就回一行 ng 加 non-fast-forward,引用不动。旧分支不存在时(current 为 null)视为新建,直接放行——首推建分支不设卡。

<details>
<summary>点开看:收货的对账与 fetch 的算缺(src/remote.ts;两处白捡的便宜)。</summary>

```ts
// src/remote.ts · storeObjectFrames 的落库段(拼版:去缩进,收满一个对象时)
const written = writeObject(gitDir, head.type, content)
if (written !== head.hash) {
  throw new Error(`远端送来的对象自称 ${head.hash},落库前算出来却是 ${written}——内容与名字对不上,拒收`)
}
```

对象头不上线:线上只报类型与字节,落库时对象头由收方按第 2 章的口径自己拼,zlib 壳也是收方自己套。于是校验是白捡的——writeObject 本来就要算 SHA-1,把结果与线上自称的哈希一对,传输坏了当场现形。SHA-1 在这里既是名字又是封条。

```ts
// src/remote.ts · fetchObjects 的协商段(拼版:去缩进)
const wants = [...new Set(heads.map((h) => h.hash))]
const haves = new Set(enumerateObjects(gitDir, localTips(gitDir, remote)))
const request: Buffer[] = []
for (const h of wants) {
  request.push(pktEncode(`want ${h}\n`))
}
for (const h of haves) {
  request.push(pktEncode(`have ${h}\n`))
}
request.push(FLUSH_PKT)
session.send(request)
const frames = await session.reply()
const pulled = storeObjectFrames(gitDir, frames)
```

清单兑现成输入:heads 直接来自引用发现的返回,want 逐条点名;have 是本地全部尖端的枚举并集。拉完只做一件事——updateRef 写 refs/remotes,一行 41 字节。cloneRepo 同款骨架,差别屈指可数:一条 have 都没有、分支与记号两类引用都建、HEAD 跟着广告里的 HEAD 行走、最后检出加重建暂存区。

</details>

跑全量门槛:

```text
# 用法示例 · 全量门槛
$ pnpm typecheck        ← 无输出即 0 错误
$ pnpm test
 ✓ tests/smoke.test.ts (3 tests)
 ✓ tests/objects.test.ts (18 tests)
 ✓ tests/remote.test.ts (19 tests)
 ✓ tests/serve.test.ts (10 tests)
 ✓ tests/pkt.test.ts (13 tests)
 ✓ tests/diff.test.ts (20 tests)
 ✓ tests/trees.test.ts (19 tests)
 ✓ tests/index.test.ts (25 tests)
 ✓ tests/refs.test.ts (19 tests)
 ✓ tests/merge.test.ts (21 tests)
 ✓ tests/commits.test.ts (22 tests)
 ✓ tests/graph.test.ts (22 tests)

 Test Files  12 passed (12)
      Tests  211 passed (211)
```

十九条分六组。枚举两条:两笔提交 8 个对象、一笔 5 个,双尖端共享只收一次。会话三条:第 10 章的 ls-remote 客户端原样能连新服务端;空仓库对端只报零号占位行;服务端 detached HEAD 时 HEAD 行照发裸哈希。fetch 三条:两头追平后对端改根下的 a.txt 前进一笔,只拉缺的 3 个:新 blob、新根 tree、新 commit。remote-tracking 前移,工作区与本地分支纹丝不动。第二次 fetch 拉零个;命令层战报写明落点。push 四条:裸仓库骨架;空远端照单全收、同尖端再推送零个;落后被拒、文案点名 non-fast-forward、远端引用不挪但对象已落库。补救通道 fetch 回 4 个,对端那笔改的是 lib/b.txt:新 blob、新 lib tree、新根 tree、新 commit。merge 出双父提交再推就过。clone 四条:对象、双分支、记号、检出、log 与源逐字符一致;空仓库只建骨架;命令层如实报空;克隆侧新提交推回源。防线三条:同步入口指路 runNetCli、分支不存在连接前报错、对端不回信报可读的错。全程回环地址加随机端口,afterEach 关服务删临时目录,不碰外网不碰机器时钟;门槛连跑三遍,三回 211 全绿。

## 亲手验证:先猜,再跑

开实验场。四个目录:sync-lab 当源,sync-clone 当克隆侧,sync-bare 当裸远端,sync-empty 留给空仓库。时间戳照旧钉死。

```bash
# 用法示例 · 建 sync-lab:第一笔两文件,dev 停在第一笔,main 前进一笔
cd ..                                  # 来到课程根(mini-git-ts-course/)
mkdir sync-lab && cd sync-lab
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
find .git/objects -type f | wc -l      # 8:5 个起家,前进一笔添 3 个
```

终端 A 起源服务,窗口别关:

```bash
# 用法示例 · 终端 A
$MG $CLI serve
# mini-git serve 已上线:127.0.0.1:9419(每条连接先送引用清单,再听来意;Ctrl+C 停止)
```

第一猜,clone。回车前押三样:拉回几个对象;工作区几个文件;log 与源仓库是不是逐字符一致。押完跑:

```bash
# 用法示例 · 终端 B:整仓库搬回家(先回课程根)
cd ..                                  # 课程根(mini-git-ts-course/)
MG=$(pwd)/companion/node_modules/.bin/tsx
CLI=$(pwd)/companion/src/cli.ts
$MG $CLI clone 127.0.0.1:9419 sync-clone
# 克隆完成:8 个对象、2 条分支,检出 2 个文件到 …\sync-clone(HEAD 在 main)
find sync-clone/.git/objects -type f | wc -l   # 8
cat sync-clone/a.txt                            # one 换行 two
cd sync-clone
$MG $CLI log "$(cat .git/refs/heads/main)" > ../clone-log.txt
cd ../sync-lab
$MG $CLI log "$(cat .git/refs/heads/main)" > ../origin-log.txt
diff ../origin-log.txt ../clone-log.txt && echo 一致   # 一致
```

对答案:8、2、一致。注意取 log 起点的写法——引用是文件,cat 出来就是 40 位哈希,第 6 章的老手艺。dev 也原样搬来了:`.git/refs/heads/dev` 与源的 refs/heads/dev 同哈希,外加一份记号在 refs/remotes 下。

第二猜,两侧分头前进再 fetch。先让克隆侧自己走一笔,再让源前进一笔。两边改的是不同文件——第 9 章的判定表说过,同文件同区域双改要出冲突标记,这里先绕开。

```bash
# 用法示例 · 克隆侧前进(改 a.txt)
cd ../sync-clone
printf 'one\ntwo\nlocal\n' > a.txt
$MG $CLI add a.txt
MINI_GIT_TIMESTAMP=1700009000 $MG $CLI commit -m '克隆侧前进'
find .git/objects -type f | wc -l        # 11:又添 blob、根 tree、commit
# 源侧前进(改 lib/b.txt)
cd ../sync-lab
printf 'two\nmore\n' > lib/b.txt
$MG $CLI add lib/b.txt
MINI_GIT_TIMESTAMP=1700007200 $MG $CLI commit -m 'main 又前进'
```

fetch 前押四样:拉几个对象;lib/b.txt 的内容变不变;status 说什么;对象库变到几。跑:

```bash
# 用法示例 · fetch:拉回记号,不拉工作区
cd ../sync-clone
$MG $CLI fetch 127.0.0.1:9419
# 已从 127.0.0.1:9419 拉取 4 个对象:
#   dev → refs/remotes/127.0.0.1-9419/dev(91ad33a)
#   main → refs/remotes/127.0.0.1-9419/main(3d5d435)
find .git/objects -type f | wc -l        # 15
cat lib/b.txt                            # two ——还是旧的!
cat .git/refs/remotes/127.0.0.1-9419/main   # 3d5d435cb96b…:记号已经前移
$MG $CLI status                          # 干净:工作区、暂存区与 HEAD 三方一致(2 个文件)
```

对答案:4 个(新 blob、新 lib tree、新根 tree、新 commit);lib/b.txt 一个字没变;status 干净。新内容此刻就躺在那 4 个新对象里,工作区一行没动——数据到了,文件没到,这正是 fetch 与 merge 的分界。想让文件变,把记号交给 merge:

```bash
# 用法示例 · merge 远端尖端(合并提交也吃时间戳,照旧钉死)
MINI_GIT_TIMESTAMP=1700012600 $MG $CLI merge "$(cat .git/refs/remotes/127.0.0.1-9419/main)"
# 合并完成:main d6c4df2(双父 76fc318 + 3d5d435)
cat a.txt                                # one/two/local:自己那笔还在
cat lib/b.txt                            # two/more:对端那笔进来了
```

双父提交。merge 先拿两笔尖端找最近公共祖先当 base,再走第 9 章的三方合并。两侧各改各的文件,第 7 章那套算法照旧:最长公共子序列算出编辑脚本,折成两张行对齐账。连 unified diff 的 hunk 都没有叠面,自动合入。

第三猜,push 领先。先造裸远端,终端 C 起服务。押:送几个对象过去。

```bash
# 用法示例 · 终端 C:裸远端
cd ..                                  # 课程根
MG=$(pwd)/companion/node_modules/.bin/tsx
CLI=$(pwd)/companion/src/cli.ts
mkdir sync-bare && cd sync-bare
$MG $CLI init --bare
$MG $CLI serve 9421
# 终端 B:推
cd ../sync-clone
$MG $CLI push 127.0.0.1:9421 main
# 已推送 main → 对端 refs/heads/main(d6c4df2,送了 17 个对象)
```

对答案:17。空远端没有广告得出尖端,整段闭包全送:第一笔的 5、clone 之前源侧 main 前进的 3、克隆侧前进的 3、clone 之后源侧前进的 4、合并提交的 2,一笔不少。

第四猜,落后被拒。源仓库此刻停在 c3,落后于裸远端的合并提交。回车前押:判词的原文是哪几个词;裸远端的引用动不动。跑:

```bash
# 用法示例 · 落后的一侧硬推
cd ../sync-lab
$MG $CLI push 127.0.0.1:9421 main
# push:远端拒绝了 refs/heads/main——non-fast-forward(对端的这条分支上有你缺的提交,
#   硬推会丢掉它的历史;先 fetch 再合并,然后重推)
cat ../sync-bare/refs/heads/main         # d6c4df2…:一步没动
```

判词里那半句「先 fetch 再合并,然后重推」,照着走一遍,顺便押下三样:fetch 拉几个;merge 走哪种结局;再推送送几个。

```bash
# 用法示例 · 补救通道
$MG $CLI fetch 127.0.0.1:9421
# 已从 127.0.0.1:9421 拉取 5 个对象:
#   main → refs/remotes/127.0.0.1-9421/main(d6c4df2)
$MG $CLI merge "$(cat .git/refs/remotes/127.0.0.1-9421/main)"
# Fast-forward:main 3d5d435..d6c4df2(只挪引用,无新提交)
$MG $CLI push 127.0.0.1:9421 main
# 已推送 main → 对端 refs/heads/main(d6c4df2,送了 0 个对象)
```

对答案:5、Fast-forward、0。源仓库的 c3 可达自合并提交,同一把尺子这次放行;而合并提交名下的 17 个对象远端全有,广告一对,一个都不用再送。拒绝与放行之间,变的不是尺子,是历史形状。

第五猜,空仓库。终端 D 起一个一步没提交的仓库,押:clone 的输出说什么;克隆目录里有什么。

```bash
# 用法示例 · 终端 D
cd ..                                  # 课程根
MG=$(pwd)/companion/node_modules/.bin/tsx
CLI=$(pwd)/companion/src/cli.ts
mkdir sync-empty && cd sync-empty
$MG $CLI init
$MG $CLI serve 9423
# 终端 B
cd ..                                  # 课程根
$MG $CLI clone 127.0.0.1:9423 empty-clone
# 远端是空仓库:只在 …\empty-clone 建了 mini-git 骨架,没有分支也没有提交
ls -A empty-clone                        # .git ——只有一个骨架
```

零号占位行如约再见:客户端收到那行 40 个 0 加 capabilities^{},知道对端一条分支都没有,散场。

第六猜,定向破坏。指认一处:src/remote.ts 的 handlePush 里,`if (current !== null && !isAncestor(gitDir, current, tip)) {` 这一行,把 `!isAncestor(gitDir, current, tip)` 改成 `false`——把关下岗,其余全部不碰。先写下预测:全量 211 条测试红几条?「领先就收」那条红不红?clone 那族呢?跑。

对答案:恰好 1 条红——「落后被拒」那条。它两头各造了一笔分叉的提交,是全套测试里唯一把历史摆成「旧尖端不可达自新尖端」形状的场景;把关一撤,拒绝变放行,硬推反倒把远端引用挪走了,断言当场翻车。不红的更有讲头。「领先就收」两条绿:领先推送在尺子面前本来就合格,撤不撤闸都过——闸门只拦丢历史的路,不拦合法的路。clone 与 fetch 全族绿:它们压根不碰 push。补救通道那条也绿:它推送时已经 fetch 加 merge 过,是货真价实的快进。把条件改回去,211 条全绿,复原确认。

## 收束:动与不动的分界线,画在引用上

被拒的那行判词,现在能逐字读通了。non-fast-forward 不是故障码,是远端量完尺子后的否决:拿手里的旧尖端对你的新尖端做一次祖先判定,不成立就拒——拒的不是你的人,是「让对端独有的提交失去引用」这件事。fetch 之谜同解:它动的从来只有对象库与 refs/remotes 下的记号,数据到了、文件没到,把数据放进工作区是 merge 的活。三个命令其实是同一件事的三个方向:clone 全量要,fetch 按账补,push 闭包送——用的都是引用发现那张清单、对象枚举那一次集合相减、内容寻址那把免费的封条。

旧账两笔,当面点清。第 8 章的 isAncestor 上岗到 handlePush 的那一行,判的正是文档里的「目的地必须是源提交的祖先」。第 10 章的清单三处兑现:fetch 拿它点 want、报 have;push 拿它算哪些闭包不用重送;零号占位行在空仓库 clone 的散场词里谢幕。清单还是那张清单,一个字节没重算。

差异就地声明、附录集中登记。会话一轮定案、请求以收线为界,真协议是多轮协商加 packfile。对象线上形状自定,校验靠收方重算。被拒的推送对象已落库,真协议在协商期就拒。推到检出的分支不设卡,真 git 默认拒绝。没有 refspec、没有 --force,远端名从地址折。整段请求缓冲在内存,服务端五秒送客沉默的连接。这些不挡理解真 git,反而标出了真协议在每个岔路口多做的工。

到这里,第四部分收官,mini-git 的地图只剩最后一角:你写的对象、tree、commit、引用,真 git 读得懂吗?下一章拿真 git 直接读 mini-git 的仓库,对拍一场。再把全书机制收拢成日常命令的对照表,兑现第 1 章那张地图的承诺。从 add 到 clone,每一站你都亲手写过;最后一步,是让正主来验货。

终场三题,局面一个都没在正文演过。先把答案推成具体的数或一行输出,再点开对照;卡住按各题末尾的回查提示走。

<details>
<summary>1. 两头共享前两笔(8 个对象)。对端第三笔把 lib/ 下唯一从未动过的 b.txt 整个删掉,提交后你 fetch,会拉几个对象?为什么和「改一行拉四个」不一样?</summary>

拉 2 个:新根 tree 加新 commit。lib 里只有 b.txt 一个文件,删掉它之后 lib 目录整体从根 tree 里消失,连 lib 的 tree 都不用新造——没有条目的目录不存在。blob 一个也不添:删除在快照模型里不是抹数据,是新的快照不再指它;b.txt 的 blob 仍在对象库里躺着,前两笔提交还引用着它。对照「改一行拉四个」:改要造新 blob 加路径上每层的新 tree,删只改最后一层之上的引用关系。回查「fetch」一节的算账与快照模型的口径。
</details>

<details>
<summary>2. 落后被拒的那次 push 里,远端的对象库、引用、工作区各发生了什么?那批对象在远端的最终命运如何?凭什么这条命运线你早就见过?</summary>

对象库:客户端送来的闭包照单落库,哈希对账全数通过。引用:一步没动,远端 main 还停在旧尖端。工作区:裸远端本来就没有。最终命运:从远端任何引用都走不到这批对象里的新提交,按第 8 章生死簿的口径判死,宽限期后被 gc 清掉。命运线正是第 6 章 detached 提交那条——没有引用兜底的对象,库不欠它们永生。回查「push」一节与第 8 章的可达性判死。
</details>

<details>
<summary>3. 一个裸远端,HEAD 是符号引用指向 refs/heads/dev,dev 有提交而 main 一笔都没有。客户端广告里看到的 HEAD 行会报什么?clone 出的仓库 HEAD 落在哪条分支?这判断用到了广告里的哪两行?</summary>

HEAD 行报 dev 的尖端哈希。符号引用解开到 refs/heads/dev,读到的就是它记的提交。mini-git 的 encodeRefAdvertisement 对 detached 与指向 dev 一视同仁。clone 的 HEAD 落在 dev:客户端拿 HEAD 行的哈希去比对各分支行的哈希,落在哪条就上哪条;两条 main 行不存在,连回退都用不上。判断用的是广告里的 HEAD 行与 refs/heads/dev 那行——同一份引用发现清单,第二次拿来当输入。回查「bare 仓库」一节与第 10 章的清单排序。
</details>
