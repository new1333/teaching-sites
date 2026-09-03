---
title: 目录也是对象:Buffer 与二进制格式初遇
---

# 目录也是对象:Buffer 与二进制格式初遇

切到一个旧提交,是 git 最像魔术的一刻:git checkout 一声不响,几十个嵌套文件夹连同里面的文件瞬间恢复成多年前的样子。第 1 章你已经知道历史住在 .git/objects 里;可你打开看过,那个目录下没有以你的文件夹命名的子目录,对象文件名全是 40 位哈希——既没有文件名,也没有层级。目录结构本身,到底被存成了什么？

开章先清账。第 2 章末尾的原话:「第 1 章数出的 6 个对象里,『3 份文件内容』这个角色你造出来了,还欠 2 份目录记录和 1 份提交记录。目录结构怎么变成一个没有文件名、没有层级的对象？」本章还掉其中一笔:那 2 份目录记录。同一章中间还欠过半句——「2 份目录记录的输入同样只由内容决定(它长什么样,下一章拆)」,现在拆。还有一笔更早的:第 1 章你亲手跑过 `git cat-file -p HEAD^{tree}`,屏幕上打出过 `040000 tree 85fc7… lib` 这样的行,当时只交代它叫「目录快照」。这一章把这种对象的字节一根根拆开,你会亲眼看到那两行输出是从哪些字节里变出来的。

新面孔分两类。一类是 git 的:tree 对象、文件模式。另一类其实不属于 git,属于计算机:字节、偏移、十六进制转储、Buffer。如果你从没跟二进制数据打过交道,完全正常——这一章就是全书为此铺的台阶,而且是唯一一次从零讲;往后的 index 文件与网络协议都直接踩着它走。

## 先把一只真的 tree 印在纸上

继续用 Git Bash 开个实验场。这次搭一个固定的小项目:三层目录、四个文件,内容全部写死(第 2 章的教训仍然有效:内容固定,名字才固定)。

```bash
# 用法示例 · 建 tree-lab:三层目录,内容写死
cd ..                                  # 来到课程根(mini-git-ts-course/)
mkdir tree-lab && cd tree-lab
git init -b main
printf 'hello world\n' > a.txt
printf 'note\n' > lib.txt
mkdir -p lib/deep
printf 'util\n' > lib/util.txt
printf 'hello world\n' > lib/deep/leaf.txt
git add -A
git write-tree
# fa0086005716702a3661501fa32495bae7619b91
```

结尾的 write-tree 是一条底层命令:把暂存区里备好的清单冻结成 tree 对象,打印它的名字。add 与暂存区本身是第二部分的事,这里先借真 git 的手把清单备好。fa008600… 就是「上面这整个目录此刻的样子」的指纹。(Windows 上如果文件是用会掺进 CRLF 的编辑器写的,给 add 加个前缀 `git -c core.autocrlf=false add -A`,让 git 拿原始字节;printf 写出来的文件本来就是 LF,不加也对。)

数一数这次造出了几个对象:

```text
$ find .git/objects -type f | wc -l
6
```

4 个文件、3 层目录,对象库只多 6 个文件:3 个 blob + 3 个 tree。少的那 1 个 blob 去哪了？a.txt 和 lib/deep/leaf.txt 内容一模一样,内容寻址直接让它们共用同一个对象。第 1 章「没改的文件零重存」在这里升了一级:跨目录的同内容也一视同仁。

现在把 tree 本尊挖出来。先用第 1 章那副渲染图看一眼根目录:

```text
$ git ls-tree fa0086005716702a3661501fa32495bae7619b91
100644 blob 3b18e512dba79e4c8300dd08aeb37f8e728b8dad	a.txt
100644 blob 519dd581e50e5b45d3b3c76c3172e9c3ec293488	lib.txt
040000 tree 22be3077cbb05b68e205750f7963d342ed518c78	lib
```

格式和第 1 章 cat-file -p 打出的完全同款:模式、类型、40 位名字、Tab、文件名。三行对应根下的三个条目;lib 那行的类型是 tree,指向另一个对象。官方对 tree 的定义出自 [gitdatamodel(7)](https://git-scm.com/docs/gitdatamodel)。原文第一句是「A tree is how Git represents a directory」——tree 就是 git 表示一个目录的方式。后半句接着说,它装的是文件和其他 tree,也就是子目录。这正是本章要还的那笔账的主角:**tree 对象(tree object)——目录快照的二进制对象:一串「模式 + 名字 + 哈希」条目,子目录递归指向另一棵 tree**。

渲染图是给人看的,字节才是本体。挑最小的那只 tree 下手——lib/deep 的:

```text
$ git cat-file tree e0827cda3904d0cfb4229b3cabf85d227dbfff92 | od -A d -t x1z
0000000 31 30 30 36 34 34 20 6c 65 61 66 2e 74 78 74 00  >100644 leaf.txt.<
0000016 3b 18 e5 12 db a7 9e 4c 83 00 dd 08 ae b3 7f 8e  >;......L........<
0000032 72 8b 8d ad                                      >r...<
0000036
```

`git cat-file tree`(不带 -p)吐的是对象的原始字节,`od` 把它印在纸上。这招叫十六进制转储(hex dump)——把字节流按偏移量逐字节打印成十六进制的观察手段,是调试一切二进制格式的第一工具。`-A d` 说偏移列用十进制,`-t x1z` 说每个字节印两位十六进制、行尾附一列 ASCII 猜读。

读懂它需要两个前置词,都不是 git 的,是计算机的。**字节(byte)**:8 个二进制位一组,能表示 0 到 255 的一个数;文本文件里每个字符按编码规则占一个或几个字节。**偏移(offset)**:从 0 数起,这是第几个字节——注意从 0 数,和数组下标一个习惯。十六进制的好处是压缩:一个字节(0 到 255)恰好写成两位(00 到 ff)。眼见为实:

```text
$ printf 'AB' | od -A d -t x1z
0000000 41 42                                            >AB<
0000002
```

两个字符,两个字节:A 是 65,十六进制写作 41;B 是 66,写作 42。65、0x41、'A',是同一个数的三种写法。

带着这三样回到 deep tree 的转储。整只对象 36 个字节,左边偏移列告诉你每行从第几字节开始。逐段认:

- 偏移 0 到 15,十六进制 31 30 30 36 34 34 20 6c 65 61 66 2e 74 78 74 00,右列直接读得出:`100644 leaf.txt` 再加一个 00。
- 偏移 16 到 35,整整 20 个字节:3b 18 e5 12 db a7 9e 4c 83 00 dd 08 ae b3 7f 8e 72 8b 8d ad。

把后 20 字节连起来写成十六进制串,是 3b18e512dba79e4c8300dd08aeb37f8e728b8dad。认出它了吗？第 2 章的金样、hello world 的 blob 名。tree 里存的不是 40 个字符的名字,而是 SHA-1 的原始 20 字节——一个字节都不浪费。整只 deep tree 的字节内容就是这一条记录:模式 `100644`、空格、名字 `leaf.txt`、一个 0 字节、20 字节哈希。它的对象头照第 2 章的规矩是 `tree 36\0`,名字由「对象头 + 这 36 字节」算出——2 份目录记录为什么跨机器相同,第 2 章已经答过,这里不再重复。

lib 那只大一号,两条记录,放到下一节当练习。

## Buffer:在 TypeScript 里摸字节

要在 TypeScript 里拆这种字节流,需要 Node 的 Buffer——表示定长字节序列的类型,本课程全部二进制编解码都靠它。你其实已经用过它了:第 2 章 `readFileSync` 读出来的 body 就是 Buffer,writeObject 存的也是。当时只把它当「一坨内容」整体搬运;这一章要进到里面,按偏移取字节。够用的招式一共六手,每手一行,直接在 tree-lab 里跟敲(node 就行,不必动 companion):

```bash
# 用法示例 · Buffer 最少够用集,逐行跟敲
node -e "const b = Buffer.from('100644 leaf.txt'); console.log(b.length)"
# 15        ← 文本按 utf8 编码成字节,15 个字符(全 ASCII)就是 15 字节
node -e "const b = Buffer.from('AB'); console.log(b[0], b[0].toString(16), String.fromCharCode(b[0]))"
# 65 41 A   ← b[0] 是数字 65;toString(16) 给十六进制;.fromCharCode 变回字符
node -e "const b = Buffer.from('100644 leaf.txt\0'); const nul = b.indexOf(0); console.log(nul, b.subarray(0, 6).toString(), b.subarray(nul + 1).length)"
# 15 100644 0   ← indexOf(0) 找到 0 字节在第 15 位;subarray 切两段,切出来的还是 Buffer
node -e "const b = Buffer.from([0x00, 0x00, 0x30, 0x39]); console.log(b.readUInt32BE(0))"
# 12345     ← readUInt32BE:从偏移 0 起读 4 字节,按大端序(高位字节在前)拼成一个数
node -e "console.log(Buffer.concat([Buffer.from('ab'), Buffer.from('cd')]).toString())"
# abcd      ← concat:把几段字节拼成一整只 Buffer
```

六手分别是:

- `Buffer.from(文本, 'utf8')`:把文本变成字节。
- `b[i]`:按偏移取一个字节,拿到的是数字。
- `b.subarray(起, 止)`:切出一段视图,不拷贝,几乎免费。
- `b.indexOf(字节)`:找分隔字节的位置。
- `b.toString('hex' | 'utf8')`:把字节翻译成十六进制串或文本。
- `Buffer.concat([...])`:把几段拼成一整只。

第六手之外还有一手 `readUInt32BE(偏移)`,就是上面倒数第二行:从给定偏移读 4 个字节,按大端序(高位字节在前)拼成一个数。它眼下还用不上——tree 里没有 4 字节的字段——但第二部分讲 index 文件头、第四部分讲传输协议的长度前缀时,它就是主角,先在这里混个脸熟。

顺带一提:第 2 章你用十六进制工具看过松散对象文件开头的 78 01。Buffer 这边不用任何工具,一行就能把字节印成同样的样子:

```bash
# 用法示例 · 文本变字节,字节变十六进制串
node -e "console.log(Buffer.from('100644 leaf.txt\0').toString('hex'))"
# 313030363434206c6561662e74787400
```

把输出与上一节 od 转储里的字节对一对:31 30 30 36 34 34… 一位不差。字节就是字节,谁印出来都一样——这一章后面所有「对拍」,本质都是在比字节。顺手把开篇那条「二进制解析需要特殊工具,文本代码做不了」也清算掉:od 只负责「看」,拆解靠的是你天天在写的 TypeScript——从 parseTree 往后,没有一件工具是特殊的。

## 逐字节拆格式:分隔符与定长字段

现在把 lib tree 摆上解剖台。先自己动手:拿铅笔,在下面的转储里把两条记录的边界划出来——每条记录的模式从哪开始、名字到哪结束、哈希占哪 20 个字节。划完再往下读。

```text
$ git cat-file tree 22be3077cbb05b68e205750f7963d342ed518c78 | od -A d -t x1z
0000000 34 30 30 30 30 20 64 65 65 70 00 e0 82 7c da 39  >40000 deep...|.9<
0000016 04 d0 cf b4 22 9b 3c ab f8 5d 22 7d bf ff 92 31  >....".<..]"}...1<
0000032 30 30 36 34 34 20 75 74 69 6c 2e 74 78 74 00 37  >00644 util.txt.7<
0000048 59 e9 33 a8 3a 2d 21 b3 50 e7 ae d1 94 8a fa 28  >Y.3.:-!.P.......(<
0000064 98 e5 88                                         >...<
0000067
```

对照表如下。整只对象 67 字节,两条记录背靠背,中间没有任何间隙或总长度声明:

| 偏移 | 字节数 | 内容 | 值 |
| --- | --- | --- | --- |
| 0–10 | 11 | `40000 deep` + 0 字节 | 模式 40000,名字 deep |
| 11–30 | 20 | e0 82 7c … ff 92 | e0827cda…(deep 那只 tree) |
| 31–46 | 16 | `100644 util.txt` + 0 字节 | 模式 100644,名字 util.txt |
| 47–66 | 20 | 37 59 e9 33 … e5 88 | 3759e933…(util.txt 的 blob) |

核对三处,铅笔就划对了。第一条的名字结束后,哈希紧跟 20 字节;第二条从偏移 31 接上——也就是第一条 0 字节的位置再加 21(20 字节哈希加 1)。解析器要维护的全部状态就是一个偏移游标:「找 0 字节,拆前面的头;取后面 20 字节;游标跳到 0 字节加 21;重复直到尽头」。

这格式里藏着一个小门道:变长字段靠分隔符,定长字段靠数字节。模式与名字长短不齐,所以用空格和 0 字节当边界;哈希永远是 20 字节——SHA-1 的 160 位是死的——所以不需要任何分隔符,数 20 个就行。读写两边的规矩完全对称,「20」这个数在本章代码里会反复出现。

### 文件模式:六个数字里只住着一件事

模式那几个数字值得单独看清。官方把它们一次列全,出自前面引过的 [gitdatamodel(7)](https://git-scm.com/docs/gitdatamodel)。那套格式「loosely modelled on Unix file modes」,宽松地仿照 Unix 文件权限。取值原文逐一列举:

| 模式 | 官方叫法 | 含义 |
| --- | --- | --- |
| 100644 | regular file | 普通文件 |
| 100755 | executable file | 可执行文件 |
| 120000 | symbolic link | 符号链接 |
| 040000 | directory | 目录 |
| 160000 | gitlink | 子模块 |

这就是本章第二个新词:**文件模式(file mode)——tree 条目里那串仿 Unix 权限的六位数,标记这一条是普通文件、可执行文件、符号链接还是目录**。mini-git 只碰前两类加目录;符号链接与子模块明确出范围,后面差异清单里登记。

它为什么存在？做个反事实:假如 tree 里不存模式,只存「名字 → 哈希」,检出时就无从知道某个条目该还原成普通文件还是可执行文件。同一份内容、同一个 blob,在 Linux 上有的是要带执行位的脚本。git 对权限的全部兴趣只有这一个可执行位,100644 与 100755 的差别就在中间那位数字。

还有一个坑,差一个字节就会让哈希对不上拍:字节里目录的模式是五位的 `40000`,没有开头的 0。看上面偏移 0–4:34 30 30 30 30,是「40000」。而 ls-tree、cat-file -p 显示时才补齐成六位 `040000`。存储按八进制数值写,显示按六位对齐——两套口径,拼字节时用哪套,拿金样一验便知。

### 名字只存一段,路径是走出来的

两个流行误会在这里一起清算。其一,「git 按文件夹路径组织对象文件」——不。你在 od 里亲眼看到了,lib/deep/leaf.txt 这个路径在字节里根本不存在;存在的是三只对象:根 tree 的条目里有 `lib`,lib 的条目里有 `deep`,deep 的条目里有 `leaf.txt`。每只 tree 只记本层的一段名字,路径是沿着 tree 一层层走出来的。objects/ 目录的两级结构(前 2 位分桶)与你的文件夹层级毫无关系。

其二,「tree 里存了文件名和路径全名」——由上可知也不成立。这个设计不只是省字节。目录名不进对象、只有本层条目进对象,意味着一个子目录的 tree 只由它自己的内容决定。两个项目里有逐字节相同的 docs 目录,它们的 docs tree 就是同一个对象,挂在不同父目录下各用一次——和跨目录共用 blob 是同一条内容寻址原理,只是升了一层。

### 条目顺序也是内容

转储里还有一处你可能路过但没停下的细节:根 tree 的三条记录顺序是 a.txt、lib.txt、lib——lib.txt 排在 lib 目录前面。按普通字典序,lib 应该排在 lib.txt 前面(lib 是 lib.txt 的前缀,短的在前)。git 的排序规矩是:目录名比较时当作多带一个尾斜杠——lib 当作 `lib/` 来比。`lib.txt` 与 `lib/` 在第 4 个字节上分胜负:句点是 0x2E,斜杠是 0x2F,句点小,所以 lib.txt 在前。

顺序为什么值得较真？因为顺序在字节里,字节进哈希。同一批条目、两种排法,是两只不同的对象——名字整个换人。文档层面,[git-mktree(1)](https://git-scm.com/docs/git-mktree) 写着一句有意思的话。「The order of the tree entries is normalized by mktree」——mktree 会把条目自己排成规范顺序。so 之后那半句更直白:「pre-sorting the input is not required」——连先排好都不要求你。替你排序被写成了命令的义务,顺序显然不是装饰。尾斜杠这一层官方文档没有专门一句展开,它是 git 的实现选择;本书不编它的动机,只算可验的账。补上尾斜杠后,条目顺序恰好与「把全部路径列成全名后的字典序」一致(a.txt < lib.txt < lib/deep/leaf.txt)。这门规矩用金样对拍钉死,演练里你会亲手看到漏掉它的代价。

## 演练:从红到绿

手术清单先交代。companion 这次动的面很小:`src/objects.ts` 一行未改;旧测试两份文件一字未动;新增 `src/trees.ts` 与 `tests/trees.test.ts`;`src/cli.ts` 动三处——HELP 菜单、write-tree 命令分发、cat-file -p 遇到 tree 时换一种渲染。

测试的牙齿仍然是金样,这章备了三种。第一种是把真 git 写出的 tree 字节直接钉成常量——就是你刚在 od 里看到的那些字节。

```ts
// tests/trees.test.ts · 金样字节:与 git cat-file tree 的输出逐字节一致
const DEEP_BYTES = Buffer.concat([Buffer.from('100644 leaf.txt\0'), Buffer.from(HELLO_BLOB, 'hex')])
const LIB_BYTES = Buffer.concat([
  Buffer.from('40000 deep\0'),
  Buffer.from(DEEP_TREE, 'hex'),
  Buffer.from('100644 util.txt\0'),
  Buffer.from(UTIL_BLOB, 'hex'),
])
```

第二种是三只 tree 的名字金样,开发时用真 git write-tree 对同一批固定内容算出、固化成常量:

```ts
// tests/trees.test.ts · 金样哈希:真 git 对同内容算出的名字
const ROOT_TREE = 'fa0086005716702a3661501fa32495bae7619b91' // 三层 fixture 的根
const LIB_TREE = '22be3077cbb05b68e205750f7963d342ed518c78' // lib/
const DEEP_TREE = 'e0827cda3904d0cfb4229b3cabf85d227dbfff92' // lib/deep/
// 同一批条目按朴素字典序(目录名不补尾斜杠)拼出的根 tree:另一个名字
const NAIVE_TREE = 'e2c9db0bf93ff4cd377e5b2b9809505c4357f83e'
// 单条目 100755 的 tree,git mktree 对拍固化——Windows 上 chmod 不存在,可执行位只能这样钉
const EXE_TREE = '595a3b292c0bb24731b421e937597038c06cd021'
```

第三种专门为 Windows 准备。可执行位 100755 在 Windows 文件系统上根本设不出来,想钉住它的编码正确性,只能手工拼一条 100755 的条目、拿名字对拍 git mktree。物理上造不出的输入,逻辑上必须钉住——这也是全书处理平台差异的固定套路。NAIVE_TREE 那条同理反着用:故意按朴素字典序拼一遍,断言得到的是另一个名字。这把排序规则变成可判定的断言,而不是注释里的一句提醒。

照例先立一个只会抛错的骨架:src/trees.ts 四个函数签名齐全、函数体一律抛「尚未实现」,让测试红在能力缺失上。

```text
# 用法示例 · 红的关键几行
 × parseTree:把字节拆成条目 > 金样字节解析:deep tree 的唯一条目
   → 尚未实现:parseTree
 × checkoutTree:把 tree 还原成目录 > 检出后再 writeTree,回到同一个根哈希(往返闭环)
   → 尚未实现:writeTree
 Tests  18 failed | 22 passed (40)
```

19 条新测试,18 条红。绿的那 1 条是「没 init 就 write-tree 提示先 init」——它只测 CLI 接线守卫,还没走到 tree 能力,红它就冤了。21 条旧测试全绿,公共行为没有回退。开始填肉。

### parseTree:一个游标的循环

文件顶部除了 TreeMode 与 TreeEntry 两个类型、一个四值的模式白名单 TREE_MODES,还有一个常量:HASH_BYTES = 20。名字与哈希都定长不了,但哈希固定 20 字节——它是每条 entry 的「字节数锚」,解析与编码都围着它转。

```ts
// src/trees.ts · 解析:把 tree 字节拆成条目
/** 把 tree 对象的字节内容拆成条目数组;顺序与字节中的顺序一致。 */
export function parseTree(body: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = []
  let pos = 0
  while (pos < body.length) {
    const nul = body.indexOf(0, pos)
    if (nul < 0) {
      throw new Error(`tree 已损坏:第 ${entries.length + 1} 条 entry 找不到名字结尾的 0 字节`)
    }
    const head = body.subarray(pos, nul).toString('utf8')
    const space = head.indexOf(' ')
    if (space < 0) {
      throw new Error(`tree 已损坏:第 ${entries.length + 1} 条 entry 缺少模式与名字之间的空格`)
    }
    const mode = head.slice(0, space)
    if (!TREE_MODES.includes(mode as TreeMode)) {
      throw new Error(`tree 已损坏:第 ${entries.length + 1} 条 entry 的模式 '${mode}' 不在取值范围内`)
    }
    if (nul + 1 + HASH_BYTES > body.length) {
      throw new Error(`tree 已损坏:第 ${entries.length + 1} 条 entry 的哈希不足 ${HASH_BYTES} 字节`)
    }
    entries.push({
      mode: mode as TreeMode,
      name: head.slice(space + 1),
      hash: body.subarray(nul + 1, nul + 1 + HASH_BYTES).toString('hex'),
    })
    pos = nul + 1 + HASH_BYTES
  }
  return entries
}
```

逐行对上纸面推演:游标 pos 从 0 出发。`indexOf(0, pos)` 找本条记录的 0 字节;subarray 切出头部,再按第一个空格分成模式与名字——注意是第一个空格,所以名字里带空格也切得开(测试里有专门一条)。0 字节后数 20 字节,`toString('hex')` 变 40 个字符;游标跳到 `nul + 21`,进入下一轮。三道损坏检查各守一段边界:0 字节丢了、空格丢了、尾巴上 20 字节不够,都在拿不到可靠边界时当场报错——和 readObject 校验对象头声明的长度是同一种洁癖。

encodeTree 是它的镜像,短得多:

```ts
// src/trees.ts · 编码:把条目拼回字节
export function encodeTree(entries: readonly TreeEntry[]): Buffer {
  const parts: Buffer[] = []
  for (const e of entries) {
    if (!/^[0-9a-f]{40}$/.test(e.hash)) {
      throw new Error(`条目 '${e.name}' 的哈希 '${e.hash}' 不是 40 位十六进制`)
    }
    parts.push(Buffer.from(`${e.mode} ${e.name}\0`, 'utf8'), Buffer.from(e.hash, 'hex'))
  }
  return Buffer.concat(parts)
}
```

每条记录拼两段——文本头和 20 字节哈希——最后 concat 成一整只。它不排序,给什么顺序拼什么顺序;排序是 writeTree 的职责,下面马上看到为什么必须放在那里。

### writeTree:递归序列化与那条排序规矩

```ts
// src/trees.ts · 递归序列化:目录变 tree
export function writeTree(gitDir: string, dir: string): string {
  const entries: TreeEntry[] = []
  for (const name of readdirSync(dir)) {
    if (name === '.git') {
      continue // 对象库自己不能进快照;嵌套仓库(子模块)超出 mini-git 范围
    }
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) {
      entries.push({ mode: '40000', name, hash: writeTree(gitDir, path) })
    } else if (st.isFile()) {
      // Windows 文件系统没有可执行位,这里恒为 100644;POSIX 上有执行位的文件会得到 100755
      const mode: TreeMode = (st.mode & 0o111) !== 0 ? '100755' : '100644'
      entries.push({ mode, name, hash: writeObject(gitDir, 'blob', readFileSync(path)) })
    } else {
      throw new Error(`write-tree: '${path}' 既不是文件也不是目录,mini-git 处理不了`)
    }
  }
  entries.sort(compareEntries)
  return writeObject(gitDir, 'tree', encodeTree(entries))
}
```

结构就是一句自述:扫目录,遇文件先存 blob、遇子目录先递归造子 tree,都拿到名字后排序、拼字节、走第 2 章的 writeObject 落盘。递归天然是后序的——子 tree 的名字是父 tree 的内容,必须先算子。`.git` 被跳过,不然快照会把对象库自己也照进去。排序的比较器是本章的暗线,四行:

```ts
// src/trees.ts · 排序键:目录名当作多一个尾斜杠再比
/** git 的排序键:目录名当作多一个尾斜杠再比(lib/ 排在 lib.txt 之后);比较按 utf8 字节。 */
function sortKey(entry: TreeEntry): Buffer {
  return Buffer.from(entry.mode === '40000' ? `${entry.name}/` : entry.name, 'utf8')
}

function compareEntries(a: TreeEntry, b: TreeEntry): number {
  return Buffer.compare(sortKey(a), sortKey(b))
}
```

尾斜杠只加给目录;比较按 utf8 编码后的字节进行(Buffer.compare),不是按 JavaScript 字符串的 Unicode 码位。名字一旦出了 ASCII 范围,两种比法会分家,字节序才是 git 用的那种。漏掉这个尾斜杠会发生什么,先按下不表,验证一节你来押注。

### checkoutTree:把树写回磁盘

```ts
// src/trees.ts · 检出:tree 还原成目录
export function checkoutTree(gitDir: string, hash: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })
  for (const e of parseTree(requireTree(gitDir, hash))) {
    const target = join(destDir, e.name)
    if (e.mode === '40000') {
      checkoutTree(gitDir, e.hash, target)
    } else {
      const { type, body } = readObject(gitDir, e.hash)
      if (type !== 'blob') {
        throw new Error(`tree 条目 '${e.name}' 指向的 '${e.hash}' 不是 blob,无法还原成文件`)
      }
      writeFileSync(target, body)
    }
  }
}
```

writeTree 的镜像:递归照着条目造目录、写文件,文件的字节就是 blob 的字节,一个不多一个不少。文件模式里的可执行位检出时被 mini-git 忽略——Windows 上设了也没处放,POSIX 版本补一个 chmod 就行,这条差异后面登记。

最后是 cli.ts 的三处接线,收进折叠:

<details>
<summary>点开看:renderTree、cmdWriteTree 与新 HELP(src/cli.ts 本轮全部改动)。</summary>

```ts
// src/cli.ts · tree 的渲染与 write-tree 命令(拼版:两段在终态中不相邻)
/** 把 tree 按真 git cat-file -p 的口径渲染成一行一条:模式(补足 6 位)、类型、哈希、Tab、名字。 */
function renderTree(body: Buffer): string {
  return parseTree(body)
    .map((e) => {
      const kind = e.mode === '40000' ? 'tree' : 'blob'
      return `${e.mode.padStart(6, '0')} ${kind} ${e.hash}\t${e.name}`
    })
    .join('\n')
}

function cmdWriteTree(cwd: string, args: string[]): string {
  if (args.length !== 0) {
    throw new Error('用法:mini-git write-tree;不带参数')
  }
  const gitDir = requireGitDir(cwd)
  if (!existsSync(join(gitDir, 'index'))) {
    // mini-git 特有口径:index 还没生过(一次 add 都没做)时,沿用第 3 章的整目录扫描;
    // 真 git 此时写的是空树,这条分岔登记在差异附录
    return writeTree(gitDir, cwd)
  }
  return writeTreeFromIndex(gitDir, loadIndex(gitDir))
}
```

本章动手时,cmdWriteTree 只有一行 return——整目录扫描就是全部。上面这版是它的最终形态:第 5 章拆开暂存区后,write-tree 长出了第二路,「有清单吃清单」;没清单时的兜底路径,正是本章写的这条整目录扫描。本章用到的、测试钉住的,也是这条兜底路径。

cmdCatFile 里只改了一行:`return type === 'tree' ？ renderTree(body) : body.toString('utf8')`——tree 的「内容」不再是 utf8 文本,按 ls-tree 的口径一行一条;blob 的老路一行未动。HELP 菜单加了两行(write-tree 与 cat-file -p 对 tree 的说明)。

</details>

renderTree 里两处细节都对过真 git。目录显示成补零的 `040000`(padStart 到 6 位,和字节里的 40000 区分开);哈希与名字之间是制表符不是空格——`git cat-file -p` 的真实输出就是 Tab,等下一节用 diff 验。跑全量门槛:

```text
# 用法示例 · 全量门槛
$ pnpm typecheck        ← 无输出即 0 错误
$ pnpm test
 ✓ tests/smoke.test.ts (3 tests)
 ✓ tests/objects.test.ts (18 tests)
 ✓ tests/trees.test.ts (19 tests)

 Test Files  3 passed (3)
      Tests  40 passed (40)
```

## write-tree、检出与 cat-file:闭环跑通

现在到你这。还在 tree-lab 里的话先清场重来,这次用你自己的 git:

```bash
# 用法示例 · 用 mini-git 造出同一批对象
cd tree-lab && rm -rf .git a.txt lib lib.txt
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

和真 git 的 write-tree 一个字不差——开头你用真 git 跑出的就是这个名字。让真 git 当场复读一遍。

```bash
# 用法示例 · 同目录对拍:真 git 读 mini-git 的对象库
git init -q -b main . 2>/dev/null
git -c core.autocrlf=false add -A
git write-tree
# fa0086005716702a3661501fa32495bae7619b91
```

cat-file 的渲染拿去对拍,一行 diff 的事。

```bash
# 用法示例 · cat-file -p 逐字节对拍
diff <($MG $CLI cat-file -p fa0086005716702a3661501fa32495bae7619b91) \
     <(git cat-file -p fa0086005716702a3661501fa32495bae7619b91)
# 无输出:逐字节一致(包括那个看不见的 Tab)
```

顺手看两级:`cat-file -p` 打 22be3077… 会列出 deep 与 util.txt 两行,哈希正是拆格式一节那张对照表里手工划出的两个。`cat-file -t` 对任何一只 tree 都回一个 `tree`。

最后把开篇的魔术亲手演一遍。删光文件,再从对象库里整树检出:

```bash
# 用法示例 · 删光,再检出
rm -rf a.txt lib lib.txt
ls                                     # 只剩 .git
$MG --eval "import('../companion/src/trees.ts').then(m => m.checkoutTree('.git', 'fa0086005716702a3661501fa32495bae7619b91', '.'))"
find . -path ./.git -prune -o -type f -print
# ./a.txt
# ./lib.txt
# ./lib/deep/leaf.txt
# ./lib/util.txt
$MG $CLI write-tree
# fa0086005716702a3661501fa32495bae7619b91
```

四个文件原样回来,再跑一次 write-tree,还是同一个名字。checkout 的「瞬间恢复」至此没有任何魔法:一个根 tree 哈希拎起整棵树,条目里的名字和 20 字节哈希递归展开,blob 的字节原样写回磁盘。真 git 的 checkout 多做的两步——从 HEAD 找到提交、从提交找到 tree——用的正是下一章的主角;零件你现在已全部握着了。

如实交代两处与真 git 的分岔,清单记入差异附录。其一,真 git 的 write-tree 吃的是暂存区清单,mini-git 还没有暂存区,直接扫工作区。所以同名文件不会出现「已暂存一套、工作区另一套」的分裂,这一半待第二部分讲 index 的那章补全。其二,符号链接(120000)与子模块(160000)mini-git 不产也不解,检出时文件模式的可执行位在 Windows 上也无从落地。

## 亲手验证:先猜,再跑

第一猜,改一个最深的文件。tree-lab 现在的状态:write-tree 跑过、检出也复原过,对象库里躺着 6 个对象。把 lib/deep/leaf.txt 重写成 goodbye world。先写下三个预测再动手:write-tree 的输出还会是 fa0086… 吗？对象库会变成几个文件,7、8、9 还是 10？原来那 6 个对象会少吗？写完再跑:

```bash
printf 'goodbye world\n' > lib/deep/leaf.txt
$MG $CLI write-tree
find .git/objects -type f | wc -l
```

对答案:输出换成了 12176af5…;对象库 10 个,恰好加 4;旧的 6 个一个不少,`cat-file -t fa0086…` 照样回 tree。逐层推这个 4:leaf.txt 内容变了,新 blob 一个;deep 的条目里哈希换了,新 deep tree 一个;lib 引用 deep 的那条跟着换,再一个;根引用 lib 的那条再换,又一个。改最深层的一个文件,四层链路上每层换一个新对象,链路之外的三个 blob 原地不动。如果你猜的是 7,多半只想到了新 blob——再回头看一眼 lib tree 的转储:子对象的 20 字节就住在父 tree 的内容里,子换名,父必换名。

第二猜,定向破坏。指认一处:`src/trees.ts` 里 sortKey 函数的那行 `return Buffer.from(entry.mode === '40000' ？ \`${entry.name}/\` : entry.name, 'utf8')`,把目录补尾斜杠的三元表达式删掉,直接 `return Buffer.from(entry.name, 'utf8')`。编码、写入、检出全部一行不动,只有排序的键变了。先在纸上写下预测:pnpm test 会红几条？「子目录的 tree 哈希逐层钉死」那条红不红？跑。

对答案:恰好 6 条红——根哈希金样、再跑一遍零新增、write-tree 落库、cat-file -p 渲染,以及检出的两条。全红的共同起点只有一个:根 tree 的条目顺序错了,根哈希从 fa0086… 变成 e2c9db…,后面凡是断言根名字的测试全体失守。检出那两条红得尤其值得看——它们红的环节在 readObject,报的是「对象 fa0086… 不存在」,因为正确的根 tree 从头到尾没被写出来过。**顺序在字节里,字节进哈希;条目顺序是对象内容的一部分,不是打印时的装饰。**

再看居然绿着的两条,信息量不输红。「子目录哈希逐层钉死」绿,是因为 lib 里只有 deep 和 util.txt,两种排法给出的顺序相同——lib 与 lib.txt 的撞名只发生在根这一层,子树里没有。它守的是子目录内部的哈希,不守根的排法。「朴素字典序拼出另一个名字」也绿,而且必须绿:它手工拼字节、根本不经过 writeTree,断言的恰好是「朴素序确实是另一个名字」这个事实——被改坏的是实现,不是事实。把 sortKey 改回带尾斜杠的原样再跑,40 条全绿,复原确认。

第三猜,一笔换口径的小破坏。renderTree 里那个 `\t` 改成两个空格,再跑刚才那条 diff 对拍。先猜 diff 会报什么:几行？差异是什么形状？跑完你会看到恰好 3 行差异,每行都是「mini-git 两个空格、真 git 一个 Tab」。渲染不是字节,但渲染的口径也是契约,差一个字符 diff 就不哑。改回 `\t`,diff 复归无输出。

## 收束:结构住在条目里,不住在文件夹里

把开篇那记 checkout 放到字节层面重放一遍:几十个嵌套文件夹之所以能瞬间恢复,是因为目录结构本身就是对象——每个文件夹一只 tree,条目里记着本层的名字与指向。文件名不在 blob 里,路径不在任何一只对象里,它们都住在上一层的条目里。根 tree 一个哈希拎起整棵树,这正是快照模型里「每次提交记录整棵目录树」的物理形态:不是把文件复制一遍,是把「谁叫什么、在哪层」记成了一串可以递归展开的字节。objects 里「没有文件名、没有文件夹」的原因也顺带清楚了:名字与层级是对象的内容,不该也不需要出现在对象库的目录布局上。

第 1 章那笔 6 对象的账,现在只剩最后一条:3 份文件内容、2 份目录记录都已亲手造出,还欠 1 份提交记录——把根 tree 的哈希、作者、时间和消息打包成历史节点的东西,下一章的主角。工具箱这边,本章进了四个新词:tree 对象、文件模式、十六进制转储、Buffer。四个函数:parseTree、encodeTree、writeTree、checkoutTree。两条命令:write-tree,以及认得 tree 的 cat-file -p。Buffer 那六手别急着忘——第二部分的 index 文件头、第四部分的协议长度前缀,都在等着 readUInt32BE 重新上桌。

三道变体题,先押个答案再翻对照,卡住了按各题提示回查。

<details>
<summary>1. 有个文件叫 `my notes.txt`(名字里带空格)。有人担心「解析 tree 时模式与名字用空格分隔,这文件名会把解析器搞糊涂」。会吗？说出解析时名字的起点和终点各由什么决定。</summary>

不会。空格在模式与名字之间只切第一刀:parseTree 用 `head.indexOf(' ')` 找的是第一个空格,前面是模式,后面整个直到 0 字节都是名字。名字里的空格只是名字的字节,没有任何切分权;名字的起点由第一个空格决定,终点由 0 字节决定。本章测试里专门有一条 `my file.txt` 验过。回查「演练」里 parseTree 的逐行解说。
</details>

<details>
<summary>2. 反事实:假如 tree 条目里存的不是本层一段名字,而是完整路径 `lib/deep/leaf.txt`,会丢掉本章见过的哪个性质？举一个具体受害场景。</summary>

丢掉「子树可以共享」。路径一进条目,子目录的对象内容就与它挂在哪有关。两个项目各有一个逐字节相同的 docs 目录,因为一个在根下、一个在 `vendor/` 下,路径前缀不同,就得各存一份 tree;「每层只记一段名」的设计里,它们的 docs tree 是同一个对象,各挂各的。受害场景:monorepo 里几十个包共用同一份模板目录,路径方案下要存几十份。回查「名字只存一段,路径是走出来的」。
</details>

<details>
<summary>3. 同事在自己实现的 mini-git 里把目录条目编码成了六位 `040000`(其余不变),拿去和真 git 对拍。哈希还对得上吗？cat-file -p 的显示又会怎样？两个口径分别错在哪？</summary>

哈希对不上:字节里多了个 0x30,内容变了,名字整个换人,write-tree 与真 git 的对拍立刻红。cat-file -p 的显示倒可能还是对的——如果他把渲染和编码混用同一个常量,显示口径补零反而是「对的错」。两个口径要分清:存储按八进制数值写五位 40000,显示按六位对齐补零。拼字节用存储口径,渲染用显示口径,renderTree 里的 padStart 干的就是这件事。回查「文件模式」小节与 renderTree。
</details>
