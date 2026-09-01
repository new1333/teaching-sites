---
title: 把 .git 打开:三个区域和一堆文件
---

# 把 .git 打开:三个区域和一堆文件

做备份最原始的办法你一定用过:复制粘贴整个项目文件夹,改名「项目-最终版」;第二天再复制一份,「项目-真最终版」;一周后桌面上躺着七八个文件夹,哪个都不敢删。复制粘贴备份有个天生的病根:每一份只存得下「当下的样子」,前一天长什么样,这份文件夹自己不知道。

git 不让你复制文件夹,却记得每一次改动,还能随时把任何一天的文件原样端回来。它把历史藏在了哪?就藏在每个项目里都有、你大概率从没打开过的那个目录里:.git。这一章我们把它撬开数一数,顺便回答一个更值钱的问题:add 和 commit 这两条你敲了几百遍的命令,各自到底搬动了哪些东西。

先立一块地基,全书 12 章都踩着它走:git 的全部历史住在一堆普通文件里,没有数据库服务,也没有后台程序。你在终端里敲的每条 git 命令,都是一个「开机即跑、跑完即退」的普通进程,当场读写这些文件,然后消失。这句话值不值得信,不靠我拍胸脯——这一章的每一步都是你亲手跑出来的。

## 先解剖一只活的 .git

空谈不如解剖。找个临时目录,搭一个最小的真实仓库(Windows 读者建议在 Git Bash 里跟着敲,PowerShell 的 `>` 重定向会自作主张改编码,污染实验)。

```bash
mkdir git-lab && cd git-lab
git init -b main
printf 'hello\n' > a.txt
printf 'int main() { return 0; }\n' > main.c
mkdir lib && printf 'util\n' > lib/util.txt
git add -A
git commit -m '第一次提交'
```

`git init -b main` 是把默认分支定名叫 main。老版本 git 不认 `-b`,敲 `git init` 也行,分支叫 master 不影响任何后续。

现在看进 .git 里,原样列出它的顶层内容。

```text
COMMIT_EDITMSG
HEAD
config
description
hooks
index
info
logs
objects
refs
```

每一项的职责,官方有正式清单:[gitrepository-layout](https://git-scm.com/docs/gitrepository-layout)。承重的有四个:HEAD、objects、refs 三个现在挨个打开;index 是下一节「三个区域」之一的主角,名字先记住,马上见面。其余的一句话带过。

HEAD——一行文本,写着「现在在哪个分支」。`cat` 出来看:

```text
$ cat .git/HEAD
ref: refs/heads/main
```

config——本仓库自己的配置:用户名、邮箱、远端地址,纯文本,打开就能改。logs/——引用移动的流水账,git 管它叫 reflog,「昨天手滑切错了分支」这类案子靠它翻旧账。hooks/、info/、description 分别放定制脚本、本仓库私有的忽略规则、给 gitweb 一类托管工具看的自我介绍,本章用不到。COMMIT_EDITMSG 存着最后一次提交的消息文本。

剩下两个承重件,是这一章的主角。

objects/ 目录就是对象库(object database)——git 存放全部历史的地方。看看里面:

```text
$ find .git/objects -type f | sort
.git/objects/37/59e933a83a2d21b350e7aed1948afa2898e588
.git/objects/52/ed6841ff1f82bb9c221fe46a24b43488fc8475
.git/objects/76/e8197013aabca95639bb3d9e5de847b0c0a5fd
.git/objects/85/fc703c91585c0f468a55ea33e2cea69f818a44
.git/objects/ce/013625030ba8dba906f756967f9e9ca394464a
.git/objects/ee/eea381f9d65b90248036b91f34bb28c01ead5d
```

三个文件,一次提交,objects 里躺了 6 个文件。每个名字是 40 位十六进制,拆成「前 2 位当目录名 + 后 38 位当文件名」;文件内容不是明文,是压缩过的字节。数对得上吗?6 = 3 份文件内容 + 2 份目录样子的记录 + 1 份这次提交的记录,三种角色接下来几章一个一个拆开。现在只需要记住一件事:两次提交之间的全部历史,就躺在这些文件里。

一个预告:接下来你会看到我机器上的哈希。这 6 个里有 5 个(3 份文件内容、2 份目录记录)你跑出来会和我逐字符相同——名字由内容担保;唯独那份提交记录多半和我的不同,它还包含人和时间。凭什么内容能担保名字?第 2 章动手算。在那之前,对照输出时认结构、不认数字。

refs/ 里放的是引用(ref)——「分支名指向哪次提交」的对照记录,一个分支一个小文件:

```text
$ cat .git/refs/heads/main
eeeea381f9d65b90248036b91f34bb28c01ead5d
$ git rev-parse HEAD
eeeea381f9d65b90248036b91f34bb28c01ead5d
```

分支不是「文件夹的副本」。main 的全部本体,就是 refs/heads/main 这个 41 字节的小文件:一行,一个 40 位哈希,指向某次提交。HEAD 写着分支名,分支文件写着哈希,`git rev-parse` 只是把你输入的 HEAD 顺藤摸瓜翻译成哈希给你看。

顺带认识一类新朋友:rev-parse、cat-file、ls-files 这些命令,git 圈叫它们底层命令(plumbing,直译「管道件」)——直接操纵单个机制的细粒度工具。add、commit、branch 这类贴心的高层命令叫 porcelain(瓷器)。瓷器是管道件的组合套餐;这本书要造的,正是管道件本身。

现在回到那块地基:「没有后台程序」听上去是不是反直觉?先替这个直觉说句公道话——git「记得一切」的行为太像数据库,而数据库总有服务进程守着,这么联想很合理。做个反事实检验:要是真需要后台程序守着,把 .git 拷到另一台机器,历史就该失效;实际上你现在就可以把 git-lab 整个文件夹复制到别处再跑 `git log`,整段提交历史原样都在。**git 的全部家当就是这堆普通文件,不在任何进程手里。**顺便说,「把 .git 文件夹拷走等于带走整个仓库」这件事,终章我们还要正儿八经地再验一次——用你自己写出来的 git。

## 三个区域,一张地图

解剖完了,把看到的东西抽象成一张地图。git 把你的项目分成三块:

- 工作区(working tree)——你正在编辑、眼睛看得见的那个目录。a.txt、lib/、todo.md 都算,它就是普通文件夹本身,不是 git 的发明。
- 暂存区(staging area,文件名就叫 index)——工作区和历史之间的缓冲层,实体是 .git/index 那个二进制文件。它记着「下一次提交要收哪些文件的哪个版本」。
- 对象库(object database)——.git/objects 里那一堆只进不改的文件,上一节数过的 6 个就在这。git 唯一的持久层,历史只住在这里。

为什么中间要垫一层暂存区?做个思想实验:没有它,commit 只剩两个选择——要么把工作区当前所有文件全收,要么每次提交时手动报一遍文件清单。你改了 5 个文件只想提交 2 个,就只好每次重新挑一遍。有了这张清单,你可以「分批点菜、一次结账」:add 负责点菜记账,commit 负责照单结账。

画成图:

```text
 工作区(你编辑的目录)
     │
     │ git add:把文件的当前内容记进清单(顺手做成对象存入对象库)
     ▼
 暂存区(.git/index,一张「下次提交收什么」的清单)
     │
     │ git commit:把清单冻结成一次提交,写进历史
     ▼
 对象库(.git/objects,只进不改;分支引用负责指路)
```

这张地图最直接的用处,是让你看懂 git status。接着刚才的仓库做三步小动作,然后看 status:

```bash
printf 'second line\n' >> a.txt
git add a.txt
printf 'third line\n' >> a.txt
printf 'notes\n' > todo.md
git status
```

```text
# 用法示例 · 上面三步之后 git status 的输出,原样
On branch main
Changes to be committed:
  (use "git restore --staged <file>..." to unstage)
	modified:   a.txt

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   a.txt

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	todo.md
```

三段输出,每一段都在比「两块东西」的差别:

| status 里的段落 | 它在比哪两块 | 含义 |
| --- | --- | --- |
| Changes to be committed | 暂存区 vs 最近一次提交 | 已点未结的菜 |
| Changes not staged for commit | 工作区 vs 暂存区 | 点完菜又改了,还没重新点 |
| Untracked files | 工作区 vs 暂存区(缺项) | 文件存在,清单上根本没它 |

注意 a.txt 同时出现在前两段——这不是 bug。它的两次比较各输各的:暂存区里存的是 add 那一刻的中间版,和上次提交比,有差别,进第一段;工作区里是又补了一行的最新版,和暂存区比,又有差别,进第二段。同一个文件、两个不同的比较,各归各的段。至于 .git/index 这个文件内部长什么样、怎么按字节拆开,第二部分有一章专门干这件事,这里先记账。

在往下走之前,回头数一次对象:`find .git/objects -type f | wc -l`,7 个,比第一次提交后多 1。多出来的这个文件,是刚才第二步那个 add 存进去的 a.txt 中间版——commit 还没发生,对象已经落库了。后两行补的第三行和 todo.md 都还没这个待遇:它们还没 add,连对象都还不是。记住这个 7,下一节还要用。(PowerShell 用户数文件的等价写法:`(Get-ChildItem -Recurse -File .git\objects).Count`。)

## add 与 commit:各搬一跳

地图有了,现在把两条命令放上去,各搬一跳。

**add 搬「工作区 → 暂存区」这一跳。**它做两件事:把文件当前内容做成一个对象,写进对象库;再在暂存区清单里记上「a.txt → 这个对象」。第一件事上一节已经看到实物:6 个对象在 add 之后变 7。清单这边也能看,`git ls-files -s` 打印暂存区清单:

```text
$ git ls-files -s a.txt
100644 27019c35b7067ec5703ab99bca6ec41593b8e38a 0	a.txt
```

一行记录:模式、40 位对象名、路径。暂存区清单就是「文件名 → 对象名」的对照表,名副其实。

那 add 算不算「保存」?不算。做一个判定性实验:在第一次提交之前只 add 不 commit,然后跑 `git log`,你会得到 `fatal: your current branch 'main' does not have any commits yet`。对象已经落库,历史却根本没开始——add 只备料和点菜,不写历史。

**commit 搬「暂存区 → 对象库」这一跳。**它把清单冻结成一次提交:清单本身被记录成一棵「目录快照」对象,再包一层指向它的提交对象,最后把当前分支那个 41 字节的小文件改写成新提交的哈希。接着上面的仓库走完:

```text
$ git add a.txt
$ find .git/objects -type f | wc -l
8     ← 第二次 add:更新过的 a.txt 又存成一个新对象
$ git commit -m '第二次提交'
$ find .git/objects -type f | wc -l
10    ← 提交:一棵目录快照 + 一个提交对象
$ cat .git/refs/heads/main
74b56d1e6be90d2f964892d9a559b468db2cbbb6
```

refs/heads/main 从 eeeea3… 变成了 74b56d…:所谓「提交后分支前进」,物理上就是改写这个小文件里的一行。

commit 的产物里还藏着一个大实话。用底层命令把两次提交的目录快照各打印一遍:

```text
$ git cat-file -p HEAD~1^{tree}
100644 blob ce013625030ba8dba906f756967f9e9ca394464a	a.txt
040000 tree 85fc703c91585c0f468a55ea33e2cea69f818a44	lib
100644 blob 76e8197013aabca95639bb3d9e5de847b0c0a5fd	main.c
$ git cat-file -p HEAD^{tree}
100644 blob 0ff3db8510fc86a992c2375a35060e9e753a2662	a.txt
040000 tree 85fc703c91585c0f468a55ea33e2cea69f818a44	lib
100644 blob 76e8197013aabca95639bb3d9e5de847b0c0a5fd	main.c
```

(cmd 的 `^` 是特殊字符,Windows 用户如果发现它被吞,给整个参数加引号:`'HEAD^{tree}'`。)对比两次提交:第二次的快照把所有文件又列了一遍,不是只列改过的 a.txt。这就是快照模型——每次提交记录的是当时整棵目录树的完整样子,不是「这次改了什么」的差异清单。你可能听过「git 存的是增量 diff」的说法,直觉也情有可原:网盘增量上传、补丁文件都在按差异干活。但证据在上面:目录快照每次都是全量清单。

那全量快照岂不很浪费?看名字:lib 和 main.c 在两棵快照里的名字一字不差——名字相同,就是同一个对象,git 压根没有重存它们。真正新增的只有改过的 a.txt、新的目录快照和提交对象,共 3 个(10 − 7)。省空间的秘诀不是「只存差异」,是「内容没变就沿用旧对象」。名字凭什么能担保「同名即同内容」?这个悬念留给第 2 章,你会亲手算出这些名字。

最后收拾一个旧直觉:「add 就是保存,commit 就是再备份一次」。现在你能替自己证伪了:备份是另存一份完整副本,而 commit 之后工作区一个文件都没挪、没复制;对象库里只多了几个小对象。复制粘贴式的备份,每一份都是死的历史;提交是给「现在」记一笔账,账本永远只有一本,在 .git/objects 里。

## 亲手验证:先猜,再跑

上面每一段都是跟着敲的演示。这一节换个玩法:先把你猜的结果写在纸上,再跑命令对答案——猜错了才说明模型有洞,这正是验证的意义。

第一猜。先动一次手:给 a.txt 再补一行 `fourth line`,然后 `git add a.txt`。现在先别跑 status——你猜 `git status --short` 会输出几行?a.txt 那行的开头两个字符是什么?写下答案再跑:

```text
$ git status --short
M  a.txt
?? todo.md
```

两行。`M ` 表示修改已进暂存区(M 在第一列),`??` 表示未跟踪。如果你猜的是三行、或 a.txt 还带第二列的 M,说明你心里的模型还在拿工作区直接和历史比——回到地图上:add 之后工作区和暂存区一致了,「未暂存」那段自然没它。

第二猜。接着 `git commit -m '第三次提交'`,再跑 `git status --short`,几行?谁在?

```text
$ git status --short
?? todo.md
```

只剩 todo.md。a.txt 两段比较都一致了,从 status 里消失。

第三猜,定向破坏。这次我们故意弄坏一层,看哪层守什么。删掉 .git/index——暂存区的实体文件。先写下预测:status --short 会输出几行?各自是什么形状?`git log` 还能跑吗?写完再动手:

```text
# 用法示例 · 定向破坏:删掉暂存区实体后的完整交互
$ rm .git/index
$ git status --short
D  a.txt
D  lib/util.txt
D  main.c
?? a.txt
?? lib/
?? main.c
?? todo.md
$ git log --oneline
28c4312 第三次提交
74b56d1 第二次提交
eeeea38 第一次提交
```

七行,3 行 `D ` 加 4 行 `??`;log 完好。逐条对账:清单没了,等于「暂存区是空的」,拿空清单和最近提交比,三个文件全都算「已暂存的删除」;拿工作区和空清单比,所有文件全都算未跟踪。而 git log 一切如常——历史在对象库和引用里,一个字节没动。**暂存区是一个真文件,删掉它丢不了任何历史,丢的只是「已点未结」的菜单。**

复原:git reset 会按最近一次提交重建清单。

```text
$ git reset -q
$ git status --short
?? todo.md
$ find .git/objects -type f | wc -l
13
```

回到破坏前的样子,对象一个不少。13 个对象里,12 个被三次提交的历史引用着。多出来的那 1 个,是你第一次 add 时的 a.txt 中间版,就是 ls-files 里见过的 27019c…。没有提交引用它,但没人删它,它就一直躺在对象库。git 的清理机制会在某些维护操作时回收这种没人引用的对象,现在不用管。「有没有人引用」这个视角,后面讲分支和合并时会变成主角。

## 把 mini-git 的工程架子搭起来

原理的地基打完,开始干全书的主线工程:用 TypeScript 写一个 mini-git,从零长到能和真 git 对话。这一节把工程骨架一次搭齐、每一行讲透——全书只有这一次;从下一章起,我们只往这套骨架里加东西,不再回头讲配置。

工具链:Node 24 与 pnpm 10(近几年的 Node 和 pnpm 一般也能跑,差太远先升级)。所有代码放在伴生工程 companion/ 目录里,结构如下:

```text
companion/
├─ package.json
├─ tsconfig.json
├─ vitest.config.ts
├─ src/
│  └─ cli.ts
└─ tests/
   └─ smoke.test.ts
```

先看 `companion/package.json`,同一个文件分两屏看。第一屏:

```json
{
  "name": "mini-git",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "mini-git": "tsx src/cli.ts"
  }
}
```

- `name` 给这个包起名;`private: true` 声明它是本地工程,防止手滑发布到 npm。
- `type: module` 声明这是 ESM 工程:源码用 import/export,不用 require。tsx、vitest 和 tsc 从这一行知道按现代模块规则理解你的代码。
- `scripts` 是三条门槛命令和一个入口:`pnpm typecheck` 只做类型检查;`pnpm test` 跑全部测试(run 表示跑完就退出,不开监听模式);`pnpm mini-git` 以后就是我们迷你 git 的入口。

第二屏是依赖:

```json
{
  "devDependencies": {
    "@types/node": "^24.3.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.4"
  }
}
```

注意 `dependencies` 一栏不存在:运行时依赖是零。mini-git 要用的 fs、crypto、zlib、net 全在 Node 内置库里——这也是这门课选 Node 的原因之一,不用为了造轮子先搬一车轮子。四个开发期依赖各司其职。typescript 提供 tsc 检查器;tsx 把 TS 直接跑起来,不产出编译文件;vitest 是测试框架。@types/node 是 Node API 的类型说明书,没有它,`import 'node:fs'` 会标红。

然后是 `companion/tsconfig.json`,tsc 的说明书,同样分两屏。第一屏:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "strict": true,
    "types": ["node"],
    "noEmit": true,
    "skipLibCheck": true
  }
}
```

第二屏只有一行:

```json
{
  "include": ["src", "tests"]
}
```

- `target: ES2023` 允许用这几年的 JS 语法;`module` 与 `moduleResolution` 说的是「模块语法用 ESM、路径按打包器风格解析」——tsx 和 vitest 都是转译式加载器,恰好同一风格。所以 import 路径可以带 .ts 扩展名。
- `allowImportingTsExtensions` 与 `noEmit` 是一对:允许 `import ... from '../src/cli.ts'` 这种带扩展名的写法,前提是不生成编译产物,所以扩展名永远不用改。
- `strict: true` 打开全部严格检查,全书不关;`types: ["node"]` 只加载 Node 的类型声明,不让别的全局类型溜进来;`skipLibCheck: true` 跳过依赖包内部的类型检查,快,也避开依赖自身的小毛病。
- `include` 圈定检查范围:src 和 tests。

你可能见过「tsc 编译出 dist,再 node dist/…」的流程。这里故意不走:tsx 在运行时即时转译,产物只存在于内存;tsc 独立负责类型。工程里少一个 build 目录,就少一类「改了源码忘了编译」的事故。

`companion/vitest.config.ts`:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
```

一行配置:测试文件只认 tests/ 目录下的 *.test.ts。src 保持纯实现,想找某个模块的测试,直接去 tests/ 按名字找。

主角登场,`companion/src/cli.ts` 本章搭架子时的全文(后续每章只往里加命令、加分支,终态入口等讲到网络命令时再看):

```ts
// src/cli.ts · runCli
import { pathToFileURL } from 'node:url'

export const HELP = `mini-git —— 一个用来弄懂 git 原理的迷你实现

用法:
  mini-git --help        打印这份帮助
  mini-git <命令> [参数]

目前只有帮助这一件事可做。从下一章起,这里会陆续长出
init、hash-object、cat-file…… 直到一整个能跑的 git。`

/** 把一组命令行参数变成一段输出;不直接碰终端,方便测试。 */
export function runCli(argv: string[]): string {
  const [cmd, ...args] = argv
  if (cmd === undefined || cmd === '--help' || cmd === 'help') {
    return HELP
  }
  return `mini-git: 未知命令 '${cmd}'(收到参数:${args.join(' ')})。运行 mini-git --help 查看可用命令。`
}

// 直接用 `tsx src/cli.ts` 运行时才执行;被测试 import 时不执行。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(runCli(process.argv.slice(2)))
}
```

三块,从上到下:

第一块 HELP,一段普通字符串,命令行的门面。第二块 runCli,本章唯一的「功能」:输入参数数组,输出一段文字。关键的设计是它不直接 console.log,而是把字符串返回去——「决定输出什么」和「把输出打到哪里」分开,测试就能直接断言返回值,不必截获终端。这个小小的分法后面每一章都在用。函数体里 `const [cmd, ...args]` 把第一个词当命令、剩下当参数;三种求助写法(没带命令、--help、help)都回帮助文本,其他情况回一句可读的提示——CLI 最起码的礼貌,也是将来所有子命令的兜底行为。

第三块是入口守卫。`process.argv[1]` 是「被直接运行的那个文件」的路径,`import.meta.url` 是「本模块自身」的地址,两者相等才说明这个文件正在被直接运行,此时打印;被测试 import 时两者不等,静默。`pathToFileURL` 的活是把 Windows 的 `E:\...` 路径翻译成 `file:///E:/...` 形式的合法 URL 再比较——路径直接拼进 URL 在 Windows 上会错。CommonJS 时代这句惯用语是 `require.main === module`,ESM 里换成了 URL 比较,你以后会在很多 CLI 项目里遇到它。

配套的测试,`companion/tests/smoke.test.ts` 全文:

```ts
// tests/smoke.test.ts
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.ts'

describe('mini-git 脚手架冒烟测试', () => {
  it('--help 打印用法', () => {
    const out = runCli(['--help'])
    expect(out).toContain('用法')
    expect(out).toContain('--help')
  })

  it('无参数与 --help 输出完全一致', () => {
    expect(runCli([])).toBe(runCli(['--help']))
  })

  it('未知命令给提示而不是崩溃', () => {
    const out = runCli(['frobnicate', '--x'])
    expect(out).toContain("未知命令 'frobnicate'")
  })
})
```

`describe` 分组、`it` 一条用例、`expect` 下断言,vitest 的三板斧。三条用例:帮助文本里有「用法」和「--help」;空参数和 --help 的输出完全相等;乱敲命令不崩溃,回一句带命令名的提示。这种测试叫冒烟测试——通电只看冒不冒烟,验证「工程活着」,不验证功能对错。真正的功能从下一章起一条条加,而且每条都会先看到一条红测试,再亲手把它变绿,这是本书的固定节奏。

架子搭完了,跑门槛。在 companion/ 目录里:

```bash
pnpm install      # 装依赖,生成 node_modules/ 与 pnpm-lock.yaml
pnpm typecheck    # 通过时没有任何输出
pnpm test         # 跑全部测试
pnpm mini-git --help
```

pnpm install 大约十几秒;pnpm 10 可能顺口问一句「是否允许依赖运行安装脚本」,一路默认即可,三个门槛都不依赖安装期脚本。pnpm-lock.yaml 是锁文件,把每个依赖的精确版本锁下来,提交进仓库,别人拿到手能装出一模一样的环境。typecheck 通过的样子有点反直觉:什么都不打印,直接回到提示符——0 个错误就是这样。test 的关键几行:

```text
 ✓ tests/smoke.test.ts (3 tests)

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

最后猜一把再跑:你觉得 `pnpm mini-git status` 会输出什么?按 cli.ts 的逻辑,它应该回那句「未知命令 'status'」。跑一下核对——现在这个架子唯一认识的只有求助。

从下一章起,这套骨架只有加法:每章添一两个源文件、一批测试,门槛永远是这三条,永远是绿的。

## 收束:回到那堆「最终版」文件夹

开篇的问题现在可以正面回答了。复制粘贴备份的病根,是每一份文件夹只存「现在」,想留住昨天就得复制整个项目。git 不复制项目:它把每一次「现在」拍成完整快照存进 .git/objects,改过的内容存成新对象,没改的一字不重存;分支引用负责指路,指向哪次提交,哪天就能原样端回来。历史不在云端、不在后台程序里,就在你项目文件夹内一个普通目录的一堆普通文件里。

这一章你拿到了三样东西。一张地图:工作区、暂存区、对象库三个区域,git status 的三段输出各自对应一对比较,add 和 commit 各搬一跳、谁也不越过谁。一副解剖刀:能打开任意仓库的 .git,认得 HEAD、index、objects、refs 各自管什么。一套工程:companion 里 typecheck 与 test 全绿的 mini-git 骨架,后面十一章的每一行代码都住在这里。

两个悬念记账在案。目录快照里「内容没变,名字就不变」——名字怎么算出来的,凭什么能担保同名即同内容,第 2 章动手算。三区域地图先钉在这,终章你会拿着写完的 mini-git,把 add、commit、branch、merge、push 每条日常命令逐一钉回地图上,给整本书收口。

自查三问。每题先自己写下答案,再展开对照;答不上来就按提示回查。

<details>
<summary>1. 同事说:「我 git add 之后又顺手改了几行,然后直接 commit 了,后来改的那几行肯定也在提交里。」他说得对吗?用「两跳」讲清原因,并告诉他怎么补救。</summary>

不对。add 只把「那一刻」的内容搬进暂存区,之后的改动停留在工作区;commit 只把暂存区冻结成提交,看不到工作区。那几行不在提交里。补救:重新 `git add` 那个文件再 commit 一次。回查「add 与 commit:各搬一跳」。
</details>

<details>
<summary>2. 把 git-lab 文件夹整个压缩,发到另一台机器解压。在那台机器上 git log 能列出全部提交吗?依据 .git 里的哪两块?</summary>

能。历史全部住在 .git/objects 的对象里,refs 与 HEAD 记着「从哪读起、在哪个分支」——它们都是普通文件,跟着文件夹走。这正是「拷走 .git 等于带走整个仓库」。回查「先解剖一只活的 .git」。
</details>

<details>
<summary>3. 删掉 .git/index 后,log 与 status 谁还能正常?怎么复原?</summary>

log 正常:历史在对象库和引用里,没碰。status 全面错位:清单空了,与最近提交比出「全部已暂存删除」,与工作区比出「全部未跟踪」。复原用 `git reset`:按最近一次提交重建清单;丢掉的只是已暂存未提交的那份菜单。回查「亲手验证:先猜,再跑」。
</details>
