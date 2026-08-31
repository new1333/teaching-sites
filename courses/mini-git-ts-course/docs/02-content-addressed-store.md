---
title: 内容的名字:SHA-1 与第一个对象
---

# 内容的名字:SHA-1 与第一个对象

第 1 章末尾留了一笔账,现在开还。原话是:「名字凭什么能担保『同名即同内容』?这个悬念留给第 2 章,你会亲手算出这些名字。」同一笔账还有个更大的背景:两位同事改了同一个文件的不同几行,git 合并时从不请人裁决「该信谁的版本」;GitHub 上每个提交都挂着同一格式的一串 40 位天书。这两件事背后是同一个机关——这串天书不是谁分配的编号,是内容自带的指纹:内容定了,名字就定了,谁算都一样。

本章干三件事。先用一条你八成用过的命令,亲手算出一个货真价实的 git 对象名,拆开「名字由内容担保」的机关。再看清名字是怎么当存储地址用的。最后把这两件事写进 mini-git:init、hash-object、cat-file 三条底层命令,让它们的输出和真 git 逐字符一致。

## 先亲手算出一个对象名

你多半用 Node 算过哈希:crypto.createHash('sha1') 读进一份文件,吐出一串十六进制。SHA-1 就是这类指纹算法里的老熟人——不管输入多少字节,输出固定 160 位,写成 40 个十六进制字符;输入改动一个字节,输出就换一副毫无相似度的面孔;从输出反推输入,实践中做不到。这套性质平时拿来校验下载、做缓存键,git 拿它做了一件更彻底的事:拿指纹当名字。

这就是本章第一个新词:内容寻址(content-addressed)——对象的名字不靠谁登记分配,而是对内容做一次确定性计算得出,同一份内容永远得到同一个名字。做个反事实。要是名字靠分配——自增编号、随机号、UUID 都算——两台互不知晓的机器各存一份相同内容,就会得到两个名字。「这两份是不是同一份」没法靠名字回答,只能逐字节比对全文;第 1 章那 5 个跨机器逐字符相同的对象,更是无从谈起。

具体算一次。在 Git Bash 里(继续遵守第 1 章的提醒:PowerShell 的 printf 转义不可靠):

```bash
printf 'blob 12\0hello world\n' | sha1sum
# 3b18e512dba79e4c8300dd08aeb37f8e728b8dad
```

拆开这行输入。hello world 加一个换行,正好 12 个字节;前面垫了一截文本「blob 12」,末尾跟一个 0 字节(\0)收尾。这截前缀就是本章第二个新词:对象头(object header)——一段「类型 空格 字节数」的文本,加一个 0 字节,声明「跟在后面的是什么、有多少」。对拍真 git:

```text
# 用法示例 · 真 git 对同一内容的输出
$ printf 'hello world\n' > hello.txt
$ git hash-object hello.txt
3b18e512dba79e4c8300dd08aeb37f8e728b8dad
```

逐字符一致。这串字节的格式有官方正本:[gitformat-object](https://git-scm.com/docs/gitformat-object)。关于名字怎么来,它的原话是「The object ID of the object is the SHA-1 … hash of the uncompressed data」。翻译过来:对象名就是对「对象头 + 内容」拼成的完整字节流取的哈希。

对象头为什么要参与哈希?先替「直接哈希内容」说句公道话:做缓存键、算文件校验值时大家都这么干,直觉完全合理。边界在这里。git 的对象分好几种类型,同一串字节完全可能既是一份文件内容(blob),又恰好长得和某个目录记录(tree)的编码一样。若名字只由内容决定,这两个不同种类的对象就会共享一个名字,取回时无从知道该按哪种格式解析。头里有类型,这种撞名从机制上就被排除了。不信?做个对照:

```bash
printf 'hello world\n' | sha1sum
# 22596363b3de40b06f981fb85d82312e8c0ed511  ← 只哈希内容,对不上号
```

空文件也照样有名字——头照写,长度是 0:

```bash
printf 'blob 0\0' | sha1sum
# e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
```

e69de29… 这串值得认脸:任何一个 SHA-1 仓库里的空文件,对象名都是它。不分操作系统,不分 git 版本,谁算都一样。

## 五个对象凭什么跨机器相同

现在能把第 1 章那 6 个对象的账算清了。SHA-1 是纯函数:给定输入字节,输出 160 位,别的什么都不掺——不含机器名,不含时间,不含用户,不含路径。3 份文件内容的对象,输入是「blob + 字节数 + 文件字节」;2 份目录记录的输入同样只由内容决定(它长什么样,下一章拆)。所以你在你的机器算、我在我的机器算、GitHub 的服务器在机房算,这 5 个名字逐字符相同。

第 6 个(提交记录)为什么多半不同?看它的输入:提交对象的内容里写着作者、邮箱和时间戳。你和我的「现在」不同、名字不同,内容就不同,名字自然跟着不同——不是哈希看人下菜,是内容本身记了人事。

这顺带清算一个流行的误会:「对象哈希是 git 生成后登记的随机编号」。刚才你算出 3b18e51… 的时候,git 根本不在场;没有登记簿,也没有随机数,真 git 的 hash-object 干的就是你刚才干的事。SHA-1 的输出看着像乱码,但它是被内容完全决定的乱码。

再补两句实话。其一,SHA-1 作为密码学哈希已能人为构造碰撞,git 社区在推进向 SHA-256 迁移;存量仓库仍按 SHA-1 口径工作,mini-git 全书跟随传统口径。其二,内容寻址敢拿指纹当名字,前提是「不同内容几乎不可能撞出同一个哈希」:160 位对应约 10 的 48 次方个可能的名字,工程上当作不会撞。

## 名字即地址:对象在磁盘上怎么存

名字算出来了,存哪?git 的答案朴素:名字直接当存储地址。40 位十六进制拆成「前 2 位当目录名、后 38 位当文件名」,一个对象一个小文件,落在 .git/objects 下——这正是第 1 章 find 出来的那种 37/59e933… 路径。这种一个对象一个文件的形态,叫松散对象(loose object)。「松散」是相对打包而言的:packfile 能把许多对象压进一个文件省空间。mini-git 全书只做松散形态,这条边界将来在差异附录集中登记。

文件里的字节也不是明文。第 1 章说 objects 里的文件「不是明文,是压缩过的字节」,现在兑现:写入前先过一遍 zlib 压缩。用十六进制工具看一眼刚写的 hello world 对象,开头两个字节是 78 01。78 是 zlib 流的头字节,01 表明用的是第 1 档压缩——正是真 git 写松散对象的默认档。后面才是压缩后的载荷。这里有个容易忽略的要紧细节:官方那句原话说了,名字算的是「uncompressed data」。**哈希在压缩之前,压缩永远不影响名字**。你换任何压缩档位、换任何压缩实现,文件字节变了,名字一字不动。顺带一提,真 git 写松散对象默认用 zlib 第 1 档(core.loosecompression 默认值),mini-git 也用第 1 档,连落盘字节都和真 git 完全一致。

前 2 位分桶也不是玄学。官方动机的原话是「This is done to shard the data and avoid too many files being in one directory」。一个仓库动辄几十万个对象,全平铺在一个目录里,很多文件系统的表现会明显变慢。拆成最多 256 个桶,每个桶的数量小几个数量级。

最后把去重的账算完。内容寻址落到存储策略上只有一行:写之前先看这个文件在不在,在就什么都不做。敢这么写,依据是一条双向担保——**名字相同,内容必相同;内容相同,名字必相同**。前者要是发生,意味着一次 SHA-1 碰撞;后者是确定性计算的直接推论。于是第 1 章的现象「两次提交间没改的文件零重存」,机制上就是一次 existsSync。那「同一文件改一个字,git 要存两份完整内容很浪费」呢?前半句是真的:改过的文件确实会存一份完整的新对象,快照模型就是这么记账的。省下的从来不是「同一文件的新旧两版之差」,而是「所有没改过的文件」。备份文件夹的命名法「项目-最终版-2」每存一次起一个新名,一百次提交就是一百份全量;内容寻址把时间从名字里抽掉了——什么时候存、存了几次,都不进名字。

## 演练:从一条红测试到三命令齐活

改动面先交代。companion 新增两个文件:src/objects.ts 装对象库的全部机关,tests/objects.test.ts 是本章的 18 条测试。src/cli.ts 只动 HELP 菜单和 runCli 的命令分发,第 1 章的冒烟测试一行未改。这三条命令都不碰工作区和暂存区,只服务对象库,是标准的底层命令做派:单机制,可组合。

先看测试怎么写得有牙齿。答案是金样哈希断言:把「真 git 对这份内容算出的名字」钉死在断言里,实现对了才碰得着。

```ts
// tests/objects.test.ts · 金样常量
// 金样哈希:与真 git 对任意机器算出的值逐字符一致,用来钉死「名字只由内容决定」
const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'
const HELLO_BLOB = '3b18e512dba79e4c8300dd08aeb37f8e728b8dad'
const HELLO_CRLF_BLOB = 'f35d3e67b4cdad5ef058bec4a2ef955a98c4848a'
// 只对内容本身取 SHA-1(不含对象头)得到的值,用来证明对象头确实参与哈希
const HELLO_RAW_SHA1 = '22596363b3de40b06f981fb85d82312e8c0ed511'
```

断言四个方向各钉一条:

```ts
// tests/objects.test.ts · 断言摘录
it('空内容与 hello world 的金样哈希', () => {
  expect(hashObject('blob', Buffer.alloc(0))).toBe(EMPTY_BLOB)
  expect(hashObject('blob', Buffer.from('hello world\n'))).toBe(HELLO_BLOB)
})

it('同一份字节配不同类型,名字必须不同', () => {
  const body = Buffer.from('hello world\n')
  expect(hashObject('tree', body)).not.toBe(hashObject('blob', body))
})
```

跑之前先建一个只会抛错的骨架:src/objects.ts 函数签名齐全,函数体一律抛「尚未实现」。这样测试红在「能力缺失」上,而不是红在「模块找不到」这种环境噪音上。pnpm test:

```text
# 用法示例 · 红的关键几行
 × hashObject:内容决定名字 > 空内容与 hello world 的金样哈希
   → 尚未实现:hashObject
 × init 与对象的落盘读写 > init 建出能装对象的最小仓库骨架
   → 尚未实现:initRepo
 Tests  18 failed | 3 passed (21)
```

18 条新测试全红,3 条旧冒烟照常绿。开始填肉。算名是第一块,也是本章的心脏。

```ts
// src/objects.ts · 算名与拼装
/** 拼出「对象头 + 内容」的完整字节流:对象头是 `<类型> <字节数>\0` 这段文本。 */
function frameObject(type: ObjectType, body: Buffer): Buffer {
  const header = Buffer.from(`${type} ${body.length}\0`, 'utf8')
  return Buffer.concat([header, body])
}

/** 对「对象头 + 内容」取 SHA-1,返回 40 位十六进制对象名。 */
export function hashObject(type: ObjectType, body: Buffer): string {
  return createHash('sha1').update(frameObject(type, body)).digest('hex')
}
```

frameObject 把你在终端里手拼的 `blob 12\0hello world\n` 变成了代码:模板串里写 \0,Buffer.from 按 utf8 编码后就是一个 0 字节,和 printf 的 \0 同一个意思。createHash('sha1') 你早就会,digest('hex') 直接给 40 位小写十六进制。type 是个三选一的字面量联合,对应第 1 章那三种角色:blob、tree、commit。

落盘,注意顺序——名字先算出来,路径跟着名字走:

```ts
// src/objects.ts · 落盘
export function writeObject(gitDir: string, type: ObjectType, body: Buffer): string {
  const hash = hashObject(type, body)
  const path = looseObjectPath(gitDir, hash)
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, deflateSync(frameObject(type, body), { level: 1 }))
  }
  return hash
}
```

existsSync 那一行就是上一节的去重策略:同名即同内容,重写毫无意义。deflateSync 把拼好的字节流压成 zlib 格式;level 1 对齐真 git 的默认档,这一行不加也全对,加了连字节都对齐。读是写的逆运算,看节选。

```ts
// src/objects.ts · 读回(节选)
const framed = inflateSync(readFileSync(path))
const zero = framed.indexOf(0)
if (zero < 0) {
  throw new Error(`对象 '${hash}' 已损坏:找不到对象头的结束字节`)
}
const [type, sizeText] = framed.subarray(0, zero).toString('utf8').split(' ')
const body = framed.subarray(zero + 1)
if (Number(sizeText) !== body.length) {
  throw new Error(`对象 '${hash}' 已损坏:头部声明 ${sizeText} 字节,实读 ${body.length} 字节`)
}
```

先解压,再从开头找第一个 0 字节——它就是对象头的边界;头拆成类型和字节数,后面整个是内容。最后那句长度核对是白捡的完整性检查:磁盘写了一半、文件被截断,头部声明的长度就对不上,当场判损坏。测试里专门放了一个「头部声称 99 字节、实际只有 2 字节」的坏对象来验这条;类型不在 blob/tree/commit 白名单里,同样报损坏。

对象得有地方放,initRepo 建骨架。

```ts
// src/objects.ts · 仓库骨架
export function initRepo(workDir: string): string {
  const gitDir = join(workDir, '.git')
  mkdirSync(join(gitDir, 'objects'), { recursive: true })
  mkdirSync(join(gitDir, 'refs', 'heads'), { recursive: true })
  const head = join(gitDir, 'HEAD')
  if (!existsSync(head)) {
    writeFileSync(head, 'ref: refs/heads/main\n', 'utf8')
  }
  return gitDir
}
```

和真 git init 有个如实声明的差异。真 init 还会写 config、hooks、info、description 一串,mini-git 只建三件承重的——对象库、分支引用目录、HEAD。够这三条命令跑,也够后面几章往上长。默认分支固定叫 main,对应第 1 章的 git init -b main。

最后是 cli.ts 的接线。runCli 多了一个带默认值的参数 cwd:测试注入临时目录,不必挪动进程的当前目录;命令失败不再伪装成正常输出,而是 throw 出去,由入口接住打到 stderr、退出码置 1。

```ts
// src/cli.ts · 分发(节选)
export function runCli(argv: string[], cwd: string = process.cwd()): string {
  const [cmd, ...args] = argv
  if (cmd === undefined || cmd === '--help' || cmd === 'help') {
    return HELP
  }
  switch (cmd) {
    case 'init':
      return cmdInit(cwd, args)
    case 'hash-object':
      return cmdHashObject(cwd, args)
    case 'cat-file':
      return cmdCatFile(cwd, args)
    default:
      return `mini-git: 未知命令 '${cmd}'(收到参数:${args.join(' ')})。运行 mini-git --help 查看可用命令。`
  }
}
```

上面这个分发块是本章动手时的样子:当时 `case 'init'` 直接返回 `已初始化空 mini-git 仓库:${initRepo(cwd)}`。第 11 章加了 `init --bare` 后,这一格改成调 `cmdInit(cwd, args)`(普通与裸仓库两路都在里面),上面已按终态更新。

两个子命令的实现,连同入口守卫的变化,收在这里。

<details>
<summary>点开看:cmdHashObject、cmdCatFile 与新的入口守卫(src/cli.ts 全文节选)。</summary>

```ts
// src/cli.ts · 子命令与入口
/** 当前目录下的 .git 必须已经有对象库,否则提示先 init。 */
function requireGitDir(cwd: string): string {
  const gitDir = join(cwd, '.git')
  if (!existsSync(join(gitDir, 'objects'))) {
    throw new Error(`当前目录不是 mini-git 仓库(在 ${gitDir} 下没找到 objects),先运行 mini-git init`)
  }
  return gitDir
}

function cmdHashObject(cwd: string, args: string[]): string {
  const flags = args.filter((a) => a.startsWith('-'))
  const files = args.filter((a) => !a.startsWith('-'))
  if (files.length !== 1 || flags.some((f) => f !== '-w')) {
    throw new Error("用法:mini-git hash-object [-w] <文件>;目前只支持 -w 这一个开关")
  }
  const write = flags.includes('-w')
  const path = resolve(cwd, files[0])
  let body: Buffer
  try {
    body = readFileSync(path)
  } catch {
    throw new Error(`hash-object: 无法读取文件 '${files[0]}'`)
  }
  if (!write) {
    return hashObject('blob', body)
  }
  return writeObject(requireGitDir(cwd), 'blob', body)
}

function cmdCatFile(cwd: string, args: string[]): string {
  const [mode, hash] = args
  if (args.length !== 2 || (mode !== '-p' && mode !== '-t')) {
    throw new Error('用法:mini-git cat-file <-p | -t> <对象名>;-p 读内容,-t 只看类型')
  }
  const { type, body } = readObject(requireGitDir(cwd), hash)
  return mode === '-t' ? type : body.toString('utf8')
}

// 直接用 `tsx src/cli.ts` 运行时才执行;被测试 import 时不执行。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(runCli(process.argv.slice(2)))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}
```

上面这段是本章动手时的样子。第 10 章接入网络命令后,入口改为 `console.log(await runNetCli(...))`,runCli 的同步签名原样保留;终态见第 10 章的动刀范围。

</details>

顺带对齐一处行为。真 git 的 hash-object 不带 -w 时在仓库外也能跑,带 -w 才要求身在仓库——mini-git 一模一样:裸算行,落盘要 init。这恰好又一次说明,算名字不需要任何 git 状态。真正分岔的是两件小事:真 git 的对象名支持缩写,前几位就行,mini-git 只认完整 40 位;真 git 会一层层向上找 .git,mini-git 只认当前目录。

跑全量门槛:

```text
# 用法示例 · 全量门槛
$ pnpm typecheck        ← 无输出即 0 错误
$ pnpm test
 ✓ tests/smoke.test.ts (3 tests)
 ✓ tests/objects.test.ts (18 tests)

 Test Files  2 passed (2)
      Tests  21 passed (21)
```

## 亲手验证:先猜,再跑

第一猜,和真 git 对拍。在 companion 里随便挑个文件,tsconfig.json 就行。先写下预测:mini-git hash-object 和 git hash-object 的输出,是逐字符相同、前几位相同,还是毫无关系?写完再跑:

```bash
cd companion
pnpm mini-git hash-object tsconfig.json
git hash-object --no-filters tsconfig.json
```

逐字符相同。--no-filters 这个开关值得停一拍。git 默认可能在内容进对象之前按配置做行尾转换,Windows 上常见的 autocrlf 会把 CRLF 换成 LF。--no-filters 让它拿原始字节算,而 mini-git 没有任何过滤,拿的永远是磁盘上的字节。所以如果你的机器上不加这个开关两边就对不上,别急着怀疑哈希——那是行尾转换在中间动过手脚。它恰好证明了一条:对象哈希的原料是字节,不是你眼中的文本。

第二猜,写进对象库再读回来。在 companion 旁边开个实验场(继续用 Git Bash;MG 那行定义个变量少敲点字):

```bash
# 用法示例 · 从零走一遍 init → 写 → 读
cd ..                                  # 来到课程根
mkdir obj-lab && cd obj-lab
MG=../companion/node_modules/.bin/tsx
$MG ../companion/src/cli.ts init
printf 'hello world\n' > hello.txt
$MG ../companion/src/cli.ts hash-object hello.txt      # 只算
$MG ../companion/src/cli.ts hash-object -w hello.txt   # 落盘
$MG ../companion/src/cli.ts hash-object -w hello.txt   # 再落盘一次
find .git/objects -type f | wc -l
$MG ../companion/src/cli.ts cat-file -p 3b18e512dba79e4c8300dd08aeb37f8e728b8dad
```

先猜 find 数出几个文件再跑:写了两次,答案是 1。同一个名字指向同一个路径,第二次的 existsSync 直接跳过;cat-file -p 原样吐回 hello world。顺手看两眼:.git/objects 下只有一个名为 3b 的目录;用十六进制工具瞄一眼对象文件,开头两个字节是 78 01。再追加一猜:把 hello.txt 重写成 `printf 'hello world \n' > hello.txt`(world 后面多了一个空格)再算,新名字的前两位还会是 3b 吗?跑一下。新名字 4a1f47… 和旧的 3b18e5… 之间没有半点亲缘——这就是雪崩:动一个字节,名字整个换人。

第三猜,定向破坏。指认一行:src/objects.ts 里 hashObject 的 update(frameObject(type, body)),把它改成 update(body)。对象头被踢出哈希,落盘的拼装一字不动。先写下预测再动手:pnpm test 红几条?哪几类测试还绿着?

对答案:恰好 8 条红,红的全是名字承重的。hashObject 那一组四条:两条金样对不上、两条「应不等」的变成了相等。writeObject 的分片路径断言也红——3b/18e5… 这个家不存在了,对象搬去了新名字的地方。「写两遍只落一个文件」、CLI 的两条 hash-object 输出,同样全红。13 条绿:init 骨架、写进读回的两条往返、六条报错行为,还有整条 cat-file 链路。最值得看的是 cat-file -p 居然还绿:它读的是写入时返回的那个名字,写和读用同一套被改坏的命名规则,自洽,所以畅通无阻。**它守的是「存得进、取得出」,不守「名字算得对」;名字对不对,只有金样知道。**把 update 的参数改回 frameObject(type, body),再跑,21 条全绿,复原确认。

## 收束:名字是算出来的,不是发出来的

开篇的两件事,现在有了同一个答案。那串 40 位天书是内容的指纹;指纹的原料里只有字节,没有机器、没有登记簿。你在你的机器、同事在他的机器、服务器在机房,对同一份内容算出的名字逐字符相同。这就是第 1 章那 5 个对象跨机器重合的全部原因,也是合并敢自动放行的底气:没被两人动过的部分名字一字未变,git 不必比对内容就知道它们相同。「信谁」这个问题,在起名字的那一刻就消失了。第 6 个对象名字不同,不是指纹看人下菜,是它的内容里写着人和时间。

收进工具箱的是三层。一个机制:内容寻址——对象头加内容取 SHA-1,名字即地址,松散对象按前 2 位分桶落盘,zlib 只动文件不动名字。四个函数:hashObject、writeObject、readObject、initRepo。三条命令:init、hash-object、cat-file,其中 hash-object 的输出已与真 git 逐字符对拍一致。第 1 章数出的 6 个对象里,「3 份文件内容」这个角色你造出来了,还欠 2 份目录记录和 1 份提交记录。目录结构怎么变成一个没有文件名、没有层级的对象?下一章把 objects/ 里这种「看着像文件又不是文件」的东西逐字节拆开。

换三个情境检验迁移:答案先落在纸上,再展开对照,卡住了按提示回查。

<details>
<summary>1. 同事把 a.txt 改名成 b.txt,内容一个字节没动,然后算了对象名。名字变了吗?据此,「重命名」在 git 眼里是什么?</summary>

没变。文件名不进对象:哈希的输入只有「blob + 字节数 + 文件字节」,路径压根不在原料里。重命名改变的只是「哪个名字指向哪个对象」这层记录,内容纹丝不动——这正是后面讲目录记录时要兑现的伏笔。回查「先亲手算出一个对象名」。
</details>

<details>
<summary>2. 不跑任何代码,写出「git 加换行」(4 字节)这份 blob 的哈希输入串。同一串字节按 tree 类型算,名字还相同吗?</summary>

输入是 `blob 4\0git\n`——类型、空格、字节数、一个 0 字节、内容,一字不多。tree 版本名字不同:对象头参与哈希,同内容不同类型必不同名,这也是防止「一份文件内容恰好长得像目录记录」时无法区分的机制。回查「先亲手算出一个对象名」。
</details>

<details>
<summary>3. cat-file -p 时手滑少敲了一位,拿 39 位去读。会发生什么?这条检查守的是什么、不守什么?</summary>

报错「对象名 '…' 不是 40 位十六进制,无法当作对象名」,退出码 1。它守的是输入格式这道门;不守对象存不存在——39 位连路径都拼不出来,存在性检查排在格式之后。回查「演练」里 readObject 的第一道判断。
</details>
