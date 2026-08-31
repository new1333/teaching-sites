---
title: 暂存区不是观念,是一个文件
---

# 暂存区不是观念,是一个文件

先说一桩你多半亲历过的小事故。改完一个文件,顺手 commit,推送,收工——第二天才发现提交里进的是旧版本。漏掉的那步当然是 git add:改完文件忘了 add,commit 收走的就不是你屏幕上的样子。更扎心的是 status。有时明明 add 过了,同一个文件却能同时出现在两段输出里:一段叫 Changes to be committed,另一段叫 Changes not staged。一个文件,凭什么进两段?

第 1 章给过三区域地图:工作区、暂存区、对象库,status 的三段各自对应一对比较。但那一章留了话,原话是:「至于 .git/index 这个文件内部长什么样、怎么按字节拆开,第二部分有一章专门干这件事,这里先记账。」index——.git 目录下那个记着「下次提交收什么」的清单文件,暂存区的实体。它在地图上一直是个观念中的中转站。第 3 章又欠了另一半:「真 git 的 write-tree 吃的是暂存区清单,mini-git 还没有暂存区,直接扫工作区……这一半待第二部分讲 index 的那章补全。」本章把两笔账一起清:把暂存区落成一个几百字节的二进制文件,逐字节拆开;再让 mini-git 的 write-tree 改吃这份清单。

两笔账指向同一件东西。忘了 add 的事故、status 的两段、write-tree 的口径差异,全因为 git 的世界里横着一个中间文件:它记着「下一次提交收哪些文件的哪个版本」。add 往里登记,commit 从它出发,status 的三段各比它一次。mini-git 本章新增 src/index.ts 与 add、status 两条命令。真 git 把这两条归为 porcelain,日用命令;mini-git 之前对齐的一直是 hash-object、write-tree 那批底层命令,这是头一次碰日用层。第 3 章预教的 readUInt32BE 也从「混个脸熟」转正为主角:这个文件的头三个字段,全是 4 字节大数。

## 先把真的 index 摆上解剖台

开新实验场,还是那套三层 fixture。这次让真 git 先动手:它 `add` 的那一刻写出的 .git/index,就是本章要拆的东西。

```bash
# 用法示例 · 建 index-lab:真 git 的 add 写出 index
cd ..                                  # 来到课程根(mini-git-ts-course/)
mkdir index-lab && cd index-lab
git init -b main
printf 'hello world\n' > a.txt
printf 'note\n' > lib.txt
mkdir -p lib/deep
printf 'util\n' > lib/util.txt
printf 'hello world\n' > lib/deep/leaf.txt
git -c core.autocrlf=false add -A
ls -l .git/index
# -rw-r--r-- 1 you 197609 426 ...  .git/index
```

426 字节,五个文件的仓库,清单比 fixture 里任何一个文件都大。它是二进制——cat 出来是乱码,得请第 3 章那套十六进制转储:

```text
$ od -A d -t x1 .git/index | head -6
0000000 44 49 52 43 00 00 00 02 00 00 00 04 6a 95 9a 51
0000016 24 af 03 9c 6a 95 9a 51 24 af 03 9c 00 00 00 00
0000032 00 00 00 00 00 00 81 a4 00 00 00 00 00 00 00 00
0000048 00 00 00 0c 3b 18 e5 12 db a7 9e 4c 83 00 dd 08
0000064 ae b3 7f 8e 72 8b 8d ad 00 05 61 2e 74 78 74 00
0000080 00 00 00 00 6a 95 9a 51 24 be 44 b0 6a 95 9a 51
```

你机器上转储出的时间戳那几行会与这里不同,这不影响接下来的每一步——原因读完本节你就说得出口。先看头 12 字节,它们在所有机器上都一样。

这一章的字段清单全部出自官方文档 [gitformat-index](https://git-scm.com/docs/gitformat-index),首现即出处。头三个字段:开头 4 字节是 ASCII 的 `DIRC`,魔数,验明「这是个 index」。原文写明它的来历:「The signature is { 'D', 'I', 'R', 'C' } (stands for "dircache")」——dircache,directory cache 的老称呼。接着 4 字节是版本号 2。文档说「The current supported versions are 2, 3 and 4」,mini-git 只认 v2。最后 4 字节是条目数 4,恰好是 fixture 的文件数。

与 tree 对象比一比,马上看出设计差异。tree 的字节流里没有总数:条目边界靠「模式 空格 名字 0 字节 20 字节哈希」自己走出来,读完为止。index 反过来,先给 12 字节头:魔数验明正身,版本声明格式方言,条目数直接告诉你循环几次。文档还有一句承重的话:「All binary numbers are in network byte order」。网络字节序,也就是高位字节在前的大端序——第 3 章 readUInt32BE 里那个 BE,说的就是它。不信邪的话,拿第 3 章的 Buffer 六手当场读:

```bash
# 用法示例 · 不用任何 git 命令,亲手读出 index 的头
node -e "const b=require('fs').readFileSync('.git/index'); console.log(b.subarray(0,4).toString(), b.readUInt32BE(4), b.readUInt32BE(8))"
# DIRC 2 4
```

三个 4 字节大数,三行代码读完。头之后就是条目,一条接一条,条目之后还有尾巴——下一节按字节拆。

## 条目:62 字节定长,加上名字再垫齐

**index 文件(index file)——.git/index 这个二进制文件:12 字节头之后,是一串定长格式的「路径 + 属性 + 对象名」条目,外加末尾校验和;它就是暂存区的全部实体。**条目长什么样,文档的清单照译如下,每行一个字段、宽度标在前面:

| 偏移 | 宽度 | 字段 | 本例(a.txt)的值 |
| --- | --- | --- | --- |
| 0 | 4 字节 | ctime 秒 + 纳秒(下个 4 字节):元数据最后变更时间 | `6a959a51` `24af039c` |
| 8 | 4+4 字节 | mtime 秒 + 纳秒:文件内容最后修改时间 | 同上两组 |
| 16 | 4 字节 | dev:所在设备号 | `00000000` |
| 20 | 4 字节 | ino:inode 号 | `00000000` |
| 24 | 4 字节 | mode:32 位模式 | `000081a4` |
| 28 | 4 字节 | uid:属主 id | `00000000` |
| 32 | 4 字节 | gid:属组 id | `00000000` |
| 36 | 4 字节 | size:文件字节数 | `0000000c`(12,'hello world\n') |
| 40 | 20 字节 | 对象名:这条路径登记的那个 blob | `3b18e5…` |
| 60 | 2 字节 | flags:16 位标志 | `0005` |
| 62 | 变长 | 路径名 + 1 至 8 个 NUL 垫齐 | `a.txt` + 5 个 `00` |

对着转储逐格数,一一对得上。四个值得停拍的地方。

第一,十个定长字段里有七个是 stat(2) 数据——ctime、mtime、dev、ino、uid、gid、size,全是操作系统 `stat` 调用一口气报出来的文件属性。格式文档对它们只注释了一句「this is stat(2) data」,没写为什么存。动机可以从机制推:做个反事实,假设没有这七个字段。status 判断「文件改没改」只剩一条路——把每个文件整个读进来算 SHA-1,再与条目里的对象名比;几万文件的大仓库,每敲一次 status 就全库重读。有了它们,先比四五个小数字,mtime 没动过的文件直接跳过,一个字节都不用读。这是实现选择的优化路径,不是格式文档写死的契约。所以 mini-git 这章只照存这些字段、不利用它们跳步(差异记入附录):清单照样与真 git 互认,只是比对永远老实重算。

第二,mode 是 32 位,拆开看才有意义。文档把它分成四段:16 位未用(必须为零)、4 位对象类型、3 位未用、9 位 Unix 权限。对象类型只有三个取值:二进制 1000 普通文件、1010 符号链接、1110 gitlink;权限段对普通文件只许 0755 和 0644。`0x81a4` 展开成二进制是 `1000 0 1 10100100`:类型位 1000,权限位 110100100,即 0o644。第 3 章教过的文件模式——tree 条目里那个六位字符串 `100644`——就是这 32 位砍掉三个零头后的样子。同一个文件模式,tree 与 index 两套记法。

第三,flags 的 16 位。文档从高到低点名。最高位是「1-bit assume-valid flag」,「别再检查我」的免检标记。次高位是「1-bit extended flag (must be zero in version 2)」,v2 里必须为零。再往下是「2-bit stage (during merge)」,合并冲突时才动用:一个路径最多同时挂三条 stage 条目,第三部分讲合并时回头再谈。最低 12 位是路径字节数,文档写明:长度不足 0xFFF 时直接存长度,否则这个字段存 0xFFF。mini-git 的读法一刀切:高 4 位非零就判损坏,超长路径的 0xFFF 约定也不读。

第四,路径之后那几个 `00` 不是装饰。文档原文引前半:「1-8 nul bytes as necessary to pad the entry」。后半说目的:「to a multiple of eight bytes while keeping the name NUL-terminated」。条目总长凑成 8 的倍数,路径必须以至少一个 NUL 收尾。a.txt 的条目:62 定长加 5 字节名字是 67,垫 5 个 NUL 凑 72。为什么对齐?给随机访问留方便——不必读条目,光从序号就能算出第 n 条在哪。代价是公式里那个例外:62 加名字恰为 8 的倍数时,垫 8 个而不是 0 个,否则路径就没有 NUL 收尾。

条目区读完,还剩尾巴。426 = 12 头 + 304 条目(72 + 72 + 80 + 80)+ 110 尾。尾巴分两截。前一截以 `54 52 45 45` 开头——ASCII 的 `TREE`,扩展(extension)。文档说扩展靠 4 字节签名识别,大写开头的是可选扩展:「Optional extensions can be ignored if Git does not understand them」。TREE 是缓存树:真 git 顺手把「整棵 tree 长什么样」的速算结果记在 index 尾部,下次 write-tree 不用重拼。mini-git 不读也不写扩展,条目数读够就停,直接跳到最后一截。最后一截固定 20 字节,文档:「Hash checksum over the content of the index file before this checksum」。整个文件除末尾 20 字节外全体的 SHA-1。又是老朋友:对象库那边,SHA-1 盖的是对象头加内容,算出来当名字;这边盖的是文件全体,落成末尾当保险丝。文件坏一个字节,账就对不上。

还有一处规格要交代:条目顺序。文档的原话分两句。前一句:「Index entries are sorted in ascending order on the name field」。后一句:「interpreted as a string of unsigned bytes (i.e. memcmp() order)」。按路径的裸字节排序。原文同句还写着「no localization, no special casing of directory separator '/'」——不认本地化规则,连目录分隔符都不特殊对待。第 3 章 tree 里「目录名当作多一个尾斜杠再比」的那条排序规则,在 index 这里没有。转储里四条的次序 a.txt、lib.txt、lib/deep/leaf.txt、lib/util.txt,就是字节序的结果:`.`(0x2E)小于 `/`(0x2F),所以 lib.txt 排在 lib/ 一族前面。

## 三态对比:status 的三段各在比谁

字节拆完,回到开篇的现象。status 的三段输出,第 1 章教过是「三块东西的两两比较」,现在三块里两块有了实体:工作区是目录树,暂存区是 .git/index。第三块是 HEAD 指的那笔提交。第 4 章的 logWalk 从 HEAD 出发沿父提交边走遍整张提交图;status 只需要第一步——找到起点那一笔,读出它的 tree 字段,递归摊平成「路径 → 模式 + 对象名」的对照表。三张表摊成同一种形状,比较就是查字典。

- 已暂存段(Changes to be committed):暂存区对 HEAD。HEAD 没有的路径是「新文件」,两边对象名不同的「修改」,HEAD 有而暂存区没有的「删除」。这一段是 commit 将要收进历史的部分。
- 未暂存段(Changes not staged):工作区对暂存区。工作区版本与登记版本对象名不同是「修改」,文件干脆没了是「删除」。这一段提醒你「改动还没登记」。
- 未跟踪(Untracked):工作区里有、暂存区里没有的路径。它们连比较的资格都还没有——要 add 了才进场。
- 未变:三方都一致。真 git 默认不打印它们,mini-git 把这一类数出来,教学时看得见。

这套两两比对有个正式的名字,本章第二个新词。**三态对比(three-state comparison)——把工作区、暂存区、HEAD 各摊成「路径 → 指纹」的对照表,两两相减得出 status 的三段;同一文件可以同时输在其中两次比较里。**开篇两段同现的谜底就在这。暂存区里 a.txt 的条目,停在 add 那一刻的对象名;工作区里 a.txt 是后来又改过的内容。与 HEAD 比,暂存区那份是新文件,进第一段。与暂存区比,工作区那份对不上,进第二段。一个文件,两个版本,各输各的比较——不是 git 犯迷糊,是你手里真的有两个版本。

顺手清算三个流传很广的直觉。其一,「add 就是保存文件到 git」。替它说句公道话:add 确实把内容存进了对象库,说「保存」不算全错。但 add 真正的动作是登记:往 index 里写一条「这个路径,此刻对应这个对象名」。文件之后随便改,条目不动——保存的是那一刻,不是这个文件。其二,「commit 提交的是工作区当前样子」。反事实一戳就破:改完不 add 就 commit,收走的是暂存区里那份旧登记,你屏幕上的新版一个字节都不进历史。这正是本章开篇那桩事故,也是快照模型的另一半:第 2 章说对象存的是完整版本,这里补上「冻结哪一刻」——add 那一刻,不是敲 commit 那一刻。其三,「status 是拿工作区和远端比」。status 全程没碰网络:远端、上游分支,一个都没出场。它比的三个东西全在你本地磁盘上。

要把 HEAD 那张表摊出来,得先知道 HEAD 指着谁。第 1 章解剖过:`.git/HEAD` 是个一行的小文件,内容 `ref: refs/heads/main`。所以读法是两跳。先读 HEAD 文本,见到 `ref: ` 开头,就去读它指的那个小文件,里面才是 40 位提交名。分支还没生过提交时,那个小文件不存在,当作「没有 HEAD」。mini-git 把这两跳写成一个小工具 readHeadHash。这里显式登记一笔账。readHeadHash 是本章的临时讲法,只服务 status;「ref: 指向另一个引用」这套符号引用的解析规则,下一章会正式化成 refs.ts 的 resolveHead。分支的建立、切换、detached,全踩在它上面。

## 演练:从红到绿

手术清单先交代。src/index.ts 一个文件装九个函数,编解码与三态对比都在里面:parseIndex、writeIndex 负责字节来回。loadIndex、saveIndex、makeIndexEntry 管清单的读写与造条目。scanWorktree、flattenTree、readHeadHash 负责备三张表,classifyStatus 出四类判定。新增 tests/index.test.ts,25 条。src/trees.ts 动两处:把私有的 compareEntries 导出供 index 侧复用,另增 writeTreeFromIndex——平面清单拼回嵌套树。导出那把私尺只有一个动机:tree 的排序必须与第 3 章同一把尺子,各写一份迟早走岔。src/cli.ts 接 add 与 status 两个子命令,write-tree 改成两路分流。四份旧测试一字未动。

测试的牙齿还是金样,这次的骨头最硬:真 git 2.53 对同一套 fixture `git add -A` 写出的 .git/index,426 字节逐字节固化成常量。

```ts
// tests/index.test.ts · 金样常量
// 真 git 2.53 对三层 fixture `git add -A` 后写出的 .git/index 全量 426 字节(od 逐字节核对后固化)。
// 其中 ctime/mtime/dev/ino 是生成机器的指纹,跨机器必然不同;测试只断言结构事实,不碰这些字段。
const GOLDEN_INDEX = Buffer.from(
  '444952430000000200000004' + // 头 12 字节:DIRC、版本 2、4 条
    '6A959A5124AF039C6A959A5124AF039C0000000000000000000081A400000000000000000000000C3B18E512DBA79E4C8300DD08AEB37F8E728B8DAD0005612E7478740000000000' + // entry 1:a.txt(72 字节)
    '6A959A5124BE44B06A959A5124BE44B00000000000000000000081A4000000000000000000000005519DD581E50E5B45D3B3C76C3172E9C3EC29348800076C69622E747874000000' + // entry 2:lib.txt(72 字节)
    '6A959A5125C42EB06A959A5125C42EB00000000000000000000081A400000000000000000000000C3B18E512DBA79E4C8300DD08AEB37F8E728B8DAD00116C69622F646565702F6C6561662E74787400' + // entry 3:lib/deep/leaf.txt(80 字节)
    '6A959A5125B4EC706A959A5125C42EB00000000000000000000081A40000000000000000000000053759E933A83A2D21B350E7AED1948AFA2898E588000C6C69622F7574696C2E747874000000000000' + // entry 4:lib/util.txt(80 字节)
    '5452454500000052003420310AFA0086005716702A3661501FA32495BAE7619B916C6962003220310A22BE3077CBB05B68E205750F7963D342ED518C7864656570003120300AE0827CDA3904D0CFB4229B3CABF85D227DBFFF923D93D80A9FA2704625EBCC36A7DC8C61FE6F15F1', // TREE 扩展(90 字节)+ 末尾 20 字节 SHA-1 校验和
  'hex',
)
```

注释里那句「stat 字段是生成机器的指纹」值得停一拍。金样能跨机器成立,靠的是断言只落在结构事实上——路径序、对象名、模式、size、flags,这些由内容与格式决定。ctime 那 16 字节谁生成谁负责,断言它们等于自讨苦吃。真 git 写的 index 被你逐字节读懂,这是本章对拍的底座。另有自写自读的 round-trip、四类状态判定、write-tree 从清单生成树三组,后面挨个上场。

照例先立只会抛错的骨架:src/index.ts 类型与九个函数签名齐全,函数体一律抛「尚未实现」,cli 接好线,让红落在能力缺失上:

```text
# 用法示例 · 红的关键几行
 × parseIndex:拆真 git 写的 index > 金样解析:4 条,路径按字节序,hash/mode/size/flags 逐项对上
   → 尚未实现:parseIndex
 × write-tree 改吃暂存区 > 全量暂存后 write-tree 与第 3 章工作区口径同根:fa0086…
   → 尚未实现:loadIndex
 × 三态对比:status > 工作区改了但没 add:同一文件同时进两段——开篇现象的机制
   → 尚未实现:loadIndex
 Tests  24 failed | 63 passed (87)
```

24 条红,红因清一色「尚未实现」;62 条旧测试全绿。25 条新测试里有一条天生绿——「index 不存在时沿用第 3 章口径」:它只走老路扫工作区,不碰新能力,和第 4 章那条参数守卫同款待遇。开始填肉。

### parseIndex:游标从 12 出发

```ts
// src/index.ts · parseIndex(节选)
/** 把 .git/index 的字节拆成条目数组;只读条目区,扩展不解析,末尾校验和必验。 */
export function parseIndex(bytes: Buffer): IndexEntry[] {
  if (bytes.length < 32) {
    throw new Error(`index 已损坏:至少 12 字节头加 20 字节校验和,实得 ${bytes.length} 字节`)
  }
  if (bytes.subarray(0, 4).toString('utf8') !== 'DIRC') {
    throw new Error('index 已损坏:开头 4 字节不是魔数 DIRC')
  }
  const version = bytes.readUInt32BE(4)
  if (version !== 2) {
    throw new Error(`index 版本是 ${version},mini-git 只认 v2(v3/v4 的稀疏路径等扩展它不读)`)
  }
  const count = bytes.readUInt32BE(8)
  const entries: IndexEntry[] = []
  let pos = 12
  for (let i = 0; i < count; i++) {
    if (pos + FIXED_ENTRY_BYTES > bytes.length) {
      throw new Error(`index 已损坏:第 ${i + 1} 条 entry 的定长段不足 62 字节`)
    }
    const entry: IndexEntry = {
      ctimeSec: bytes.readUInt32BE(pos),
      ctimeNsec: bytes.readUInt32BE(pos + 4),
      mtimeSec: bytes.readUInt32BE(pos + 8),
      mtimeNsec: bytes.readUInt32BE(pos + 12),
      dev: bytes.readUInt32BE(pos + 16),
      ino: bytes.readUInt32BE(pos + 20),
      mode: bytes.readUInt32BE(pos + 24),
      uid: bytes.readUInt32BE(pos + 28),
      gid: bytes.readUInt32BE(pos + 32),
      size: bytes.readUInt32BE(pos + 36),
      hash: bytes.subarray(pos + 40, pos + 60).toString('hex'),
      flags: bytes.readUInt16BE(pos + 60),
      path: '',
    }
```

骨架与 parseTree 同一个路数,两处升级。其一,十个定长字段不用找分隔符,偏移全是算出来的——62 字节里每个字段住在哪,查表即知,`readUInt32BE(pos + 24)` 一列十行。flags 是 2 字节,readUInt32BE 的弟弟 readUInt16BE 一次读俩,大端序同款。其二,变长段的自描述在这里兑现。从 flags 低 12 位拿到名字长度,才知道下一段路径读多长、游标跳多远。循环体剩下的几行是三道检查加一次跳跃:模式与 flags 高位的白名单、读路径、`pos += entryBytes(nameLen)`——entryBytes 就是垫齐公式。循环出口验最后一道:末尾 20 字节对前文整体取 SHA-1,对不上判损坏。金样那个真 git 文件带着 TREE 扩展照样过——校验和盖住的是全文件,扩展只是被跳过的乘客。

### writeIndex:排序、垫齐、校验和

```ts
// src/index.ts · writeIndex
/** 4 字节小工具:大端序写一个无符号数。 */
function u32(value: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(value)
  return b
}

/** 把条目数组拼回 index v2 的完整字节(含末尾 20 字节 SHA-1 校验和);条目按路径字节序排。 */
export function writeIndex(entries: readonly IndexEntry[]): Buffer {
  const byPath = (a: IndexEntry, b: IndexEntry) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8'))
  const parts: Buffer[] = [Buffer.from('DIRC', 'utf8'), u32(2), u32(entries.length)]
  for (const e of [...entries].sort(byPath)) {
    if (!HASH_RE.test(e.hash)) {
      throw new Error(`条目 '${e.path}' 的哈希 '${e.hash}' 不是 40 位十六进制`)
    }
    if (!INDEX_MODES.includes(e.mode)) {
      throw new Error(`条目 '${e.path}' 的模式 ${e.mode.toString(8)} 不在 mini-git 认识的取值里`)
    }
    const nameLen = Buffer.byteLength(e.path, 'utf8')
    if (nameLen > MAX_NAME_BYTES) {
      throw new Error(`条目 '${e.path}' 的路径有 ${nameLen} 字节,超过 index v2 名字长度的 4095 上限`)
    }
    const fixed = Buffer.alloc(FIXED_ENTRY_BYTES)
    fixed.writeUInt32BE(e.ctimeSec, 0)
    fixed.writeUInt32BE(e.ctimeNsec, 4)
    fixed.writeUInt32BE(e.mtimeSec, 8)
    fixed.writeUInt32BE(e.mtimeNsec, 12)
    fixed.writeUInt32BE(e.dev, 16)
    fixed.writeUInt32BE(e.ino, 20)
    fixed.writeUInt32BE(e.mode, 24)
    fixed.writeUInt32BE(e.uid, 28)
    fixed.writeUInt32BE(e.gid, 32)
    fixed.writeUInt32BE(e.size, 36)
    Buffer.from(e.hash, 'hex').copy(fixed, 40)
    fixed.writeUInt16BE(nameLen, 60) // flags 就是名字长度:长度先于路径,读时才知道读多长
    const total = entryBytes(nameLen)
    parts.push(fixed, Buffer.from(e.path, 'utf8'), Buffer.alloc(total - FIXED_ENTRY_BYTES - nameLen))
  }
  const body = Buffer.concat(parts)
  return Buffer.concat([body, createHash('sha1').update(body).digest()])
}
```

writeIndex 是 parseIndex 的镜像,只有两处不守镜像。例外一:进来的条目乱序也收,落盘前按路径裸字节排序——Buffer.compare 配 utf8 字节,与文档的 memcmp() order 同一口径。例外二:flags 写的是现算的路径长度,不信任调用方给的值。长度是路径的派生事实,写错一个字节,读方就切错下一条边界。垫齐那段「alloc 出一截全零」:Buffer.alloc 天生填零,垫 NUL 就是多分配那么长。最后 body 拼好,整体 SHA-1 追加成尾部 20 字节,读写两头的保险丝对上。

自写自读的 round-trip 测试里,`parseIndex(writeIndex(x))` 逐字节恒等,这是格式实现最硬的自证。另有一条 336 的总长断言:12 + 72 + 72 + 80 + 80 + 20。四条 fixture 条目占的 304 字节,与真 git 的条目区分毫不差;总长差的那 90 字节,只是 mini-git 不写 TREE 扩展。

### writeTreeFromIndex:平面清单拼回嵌套树

清单是平的(lib/deep/leaf.txt 是一条路径),tree 是嵌套的(lib 是一条目录条目,指着子 tree)。writeTreeFromIndex 负责这层折叠:

```ts
// src/trees.ts · writeTreeFromIndex
/** index 的 32 位模式映射回 tree 条目的六位文本模式。 */
function indexModeToTreeMode(mode: number): TreeMode {
  if (mode === 0o100644) return '100644'
  if (mode === 0o100755) return '100755'
  if (mode === 0o120000) return '120000'
  throw new Error(`write-tree:暂存区条目的模式 ${mode.toString(8)} 不是 mini-git 认识的取值`)
}

/** 把暂存区清单(平面 路径 → 条目)按目录分组递归,拼出根 tree 并落库;吃的是 index,不碰工作区。 */
export function writeTreeFromIndex(gitDir: string, entries: readonly IndexEntry[]): string {
  const files: TreeEntry[] = []
  const dirs = new Map<string, IndexEntry[]>()
  for (const e of entries) {
    const slash = e.path.indexOf('/')
    if (slash < 0) {
      files.push({ mode: indexModeToTreeMode(e.mode), name: e.path, hash: e.hash })
    } else {
      const top = e.path.slice(0, slash)
      const rest = dirs.get(top) ?? []
      rest.push({ ...e, path: e.path.slice(slash + 1) }) // 剥掉第一段,剩下的交给子目录的 tree
      dirs.set(top, rest)
    }
  }
  const subtrees: TreeEntry[] = []
  for (const [name, rest] of dirs) {
    subtrees.push({ mode: '40000', name, hash: writeTreeFromIndex(gitDir, rest) })
  }
  return writeObject(gitDir, 'tree', encodeTree([...files, ...subtrees].sort(compareEntries)))
}
```

一次分组,两层递归:本层文件留下,目录分组剥掉第一段路径后递归;递归回来的是子 tree 的名字,当成本层条目。收尾三件全是第 3 章的存货:模式换算回六位字符串、encodeTree 拼字节、compareEntries 排序。这就是把 trees.ts 那把私尺导出来的原因。tree 的排序规则(目录补尾斜杠)与 index 的排序规则(裸字节)不是同一把,混用会拼出另一个名字的树。CLI 的 write-tree 由此改成分流:

```ts
// src/cli.ts · cmdWriteTree
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

第 3 章的口径没有拆掉,降级成了「还没有清单时」的缺省路径——老命令在新仓库上行为不变,旧测试原样绿。真 git 此时的行为不同:无 index 的仓库里 write-tree 写出空树,名字 4b825dc642cb6eb9a060e54bf8d69288fbee4904。零条目的 tree,名字只是 `tree 0` 加 0 字节这句话的 SHA-1,第 2 章的公式当场算得出。这条分岔登记差异附录;要补齐它只需一个小分支,留给读者当自查题。

### add、status 的接线与全量门槛

<details>
<summary>点开看:cmdAdd 全文与 cmdStatus 的备料(src/cli.ts 本轮改动)。</summary>

```ts
// src/cli.ts · cmdAdd
function cmdAdd(cwd: string, args: string[]): string {
  const usage = '用法:mini-git add <文件>...;只收文件路径,不收开关,也不展开目录'
  if (args.length === 0 || args.some((a) => a.startsWith('-'))) {
    throw new Error(usage)
  }
  const gitDir = requireGitDir(cwd)
  const byPath = new Map(loadIndex(gitDir).map((e) => [e.path, e]))
  for (const arg of args) {
    const abs = resolve(cwd, arg)
    const rel = relative(cwd, abs).split(sep).join('/')
    if (rel.startsWith('..')) {
      throw new Error(`add:'${arg}' 在仓库目录之外,mini-git 暂存不了`)
    }
    if (rel === '.git' || rel.startsWith('.git/')) {
      throw new Error(`add:'${arg}' 在 .git 里面,对象库自己不进快照`)
    }
    let st: Stats
    try {
      st = statSync(abs)
    } catch {
      throw new Error(`add:文件 '${arg}' 不存在或读不了`)
    }
    if (!st.isFile()) {
      throw new Error(`${usage}(目录 '${arg}' 请逐个文件点名)`)
    }
    byPath.set(rel, makeIndexEntry(rel, writeObject(gitDir, 'blob', readFileSync(abs)), st))
  }
  saveIndex(gitDir, [...byPath.values()])
  return `已暂存 ${args.length} 个文件,清单共 ${byPath.size} 条`
}
```

add 的核心就一句:把「路径 → 此刻的对象名」写进清单。blob 照第 2 章 writeObject 落库,同内容只落一次;条目由 makeIndexEntry 用 stat 数据填满;saveIndex 整体重写。守卫三道:仓库外、.git 内、不是普通文件,各报各的错。真 git 的 add 会展开目录、会暂存删除,这两样 mini-git 都不做,差异附录再记两笔。

status 的发动机 classifyStatus 是纯函数:三张「路径 → 指纹」表进去,四类判定出来。cmdStatus 只负责备料。loadIndex 摊暂存区的表,scanWorktree 摊工作区的表——跳过 .git,逐文件算指纹但不落库。readHeadHash 找头,flattenTree 摊 HEAD 的表。最后 renderStatus 按三段渲染,段头写明「哪两块在比」。classifyStatus 的骨架是一层循环里两次独立的字典查找,与「三态对比」小节的四条判词一一对应,不再贴。

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
 ✓ tests/index.test.ts (25 tests)

 Test Files  5 passed (5)
      Tests  87 passed (87)
```

25 条新测试按四组铺开。金样解析:真 git 的 426 字节逐项对上,七种损坏各判各的。自写自读:单条字节逐段钉死、336 总长、乱序进字节序出、篡改一字节验出。write-tree 改吃清单:全量对拍金样、部分暂存只收清单、改工作区不动树。三态对比:纯函数四类、两段同现、干净态、删 index 后的全删除加全未跟踪。有一条顺手的多余断言:add 全量后 commit-tree 造出的提交名,与第 4 章金样 C1 逐字符相同。同一棵 tree、同一套身份、同一个时间戳,内容寻址不给第二种答案。

## 亲手验证:先猜,再跑

还在 index-lab 的话清场重来,这次全用你自己的 mini-git:

```bash
# 用法示例 · 清场,改用 mini-git 登记清单
cd index-lab && rm -rf .git a.txt lib lib.txt
MG=../companion/node_modules/.bin/tsx
CLI=../companion/src/cli.ts
$MG $CLI init
printf 'hello world\n' > a.txt
printf 'note\n' > lib.txt
mkdir -p lib/deep
printf 'util\n' > lib/util.txt
printf 'hello world\n' > lib/deep/leaf.txt
$MG $CLI add a.txt lib.txt lib/deep/leaf.txt lib/util.txt
# 已暂存 4 个文件,清单共 4 条
ls -l .git/index
```

动手前先猜:这个 .git/index 会是几个字节?写完对答案——336。真 git 写的是 426,差的 90 字节是 TREE 扩展;条目区那 304 字节,两边逐字节一致。然后是最提气的一刻,请真 git 来验货:

```bash
# 用法示例 · 真 git 读 mini-git 写的清单
git init -q -b main .
git -c core.autocrlf=false status --short
git ls-files
git write-tree
# fa0086005716702a3661501fa32495bae7619b91
```

三行都在说同一件事:mini-git 写的 index,真 git 全文读得懂。`--short` 输出四行 `A `,第一列的 A 就是「已暂存的新文件」——第 1 章教过那两个字符的读法,现在你能说出第一列对应三态对比的哪一次比较了。git write-tree 在这份清单上拼出的树,与 mini-git 的 write-tree 同名:fa008600…,第 3 章的金样第三次到场。连对象都通用:mini-git 落的松散对象,真 git 照单全收。真 git 跑完 write-tree 还会顺手把 TREE 扩展补写回 index——文件从 336 变回 426。mini-git 再 status 一次,照样读它,扩展不过是又被跳过的乘客。

第二猜,把开篇事故亲手造一遍。a.txt 加一行,先别 add:

```bash
# 用法示例 · 忘了 add 的现场
printf 'hello world\nsecond line\n' > a.txt
$MG $CLI status
$MG $CLI write-tree
```

预测三件事再跑。a.txt 在 status 里出现在哪几段、什么标签?write-tree 输出还是 fa008600… 吗?另外三个文件归哪一类?对答案:a.txt 进两段。已暂存段一条「新文件」——暂存区对 HEAD,HEAD 还不存在,四条全是新文件。未暂存段一条「修改」——工作区对暂存区,新内容对旧登记。write-tree 仍是 fa008600…:它吃的是清单,清单里的 a.txt 还是 hello world 那版,你后补的第二行没登记就不存在。lib.txt 三兄弟没动静,「未变」只在干净时汇总打印——此刻没有它们的事。这就是「忘了 add」的全部机制:不是 git 忘了,是清单没更新。

第三猜,把第 1 章那个破坏实验用 mini-git 复验。先把现场提交掉——写 refs/heads/main 这步眼下只能手工。这个别扭正是下一章要补的洞,顺手体会一下:

```bash
# 用法示例 · 提交一笔,然后删掉 index
export MINI_GIT_TIMESTAMP=1700000000
T=$($MG $CLI write-tree)
C=$($MG $CLI commit-tree $T -m '第一次提交')
echo $C > .git/refs/heads/main
$MG $CLI status
# 干净:工作区、暂存区与 HEAD 三方一致(4 个文件)
rm .git/index
$MG $CLI status
```

删 index 前最后一行报告「干净」,readHeadHash 两跳读到了你手写的 refs/heads/main。删掉后再跑 status,先猜输出有几行、每行什么标签。对答案:八行。已暂存段四条「删除」——清单空了,对 HEAD 比出全删。未跟踪段四条——工作区的文件对空清单全是陌生面孔。第 1 章用真 git 预测过的局面,mini-git 用同一套三态对比复现出来。log 不受影响:历史在对象库和引用里,与清单无关。

第四猜,定向破坏。指认一处:src/index.ts 的 parseIndex 末尾,`const body = bytes.subarray(...)` 起的三行——计算并比对末尾校验和的那段——整段删掉,让函数直接 return entries。收集照旧、四类判定照旧、写树照旧,一处都不动。先写预测:pnpm test 红几条?红的是哪一类测试?跑。

对答案:恰好 2 条红——「末尾校验和对不上前文,判损坏」与「自写产物篡改一字节,parseIndex 当场验出」。金样解析四条全绿,真 git 的文件没坏,当然读得过;三态对比全绿,write-tree 全绿。它守的不是任何业务判断,是文件层的保险丝:index 在磁盘上坏没坏、被谁手改过没有。坏文件照样能被「成功解析」出半截结构,那才是最危险的沉默。把三行补回去再跑,87 条全绿,复原确认。

## 收束:add 登记的是那一刻,commit 收的是那份清单

开篇的事故收口。忘了 add,commit 出来的是旧版——因为 commit 从暂存区清单出发,而清单里的条目停在 add 那一刻。status 的两段同现,因为暂存区与工作区各输了一次自己的比较。同一文件两个版本,一个文件两段输出;git 没有含糊,是暂存区把「此刻」冻结成了字节。这章把那个观念中的中转站落成了实物:12 字节头、62 字节定长条目、路径垫齐到 8 的倍数、末尾 SHA-1 保险丝。真 git 写的,mini-git 逐字节读得懂;mini-git 写的,真 git 全文认账。第 3 章那笔「write-tree 扫工作区」的欠账,连同第 1 章「index 内部长什么样」的记账,两笔一起结清。

零件柜这章进的东西。两个词:index 文件、三态对比。九个函数装进 src/index.ts,外加 trees.ts 的 writeTreeFromIndex 与一把导出的排序尺。两条命令:add 与 status,第一批日用级;write-tree 从此吃清单,无清单时退回老路,与真 git 的空树口径是一条登记过的分岔。新欠一笔,正文里埋过两次:readHeadHash 是临时讲法,「ref: 指向另一个引用」的解析规则下一章正式化成 resolveHead。实验里你还得手写 refs/heads/main 才能 commit,这个别扭正是下一章要拆的机关——分支、切换、detached,全都长在它上面。

三道迁移题,先押答案再展开,卡住按提示回查。

<details>
<summary>1. 同事 A 改了 config.ts 但没 add;同事 B add 过又在工作区改出第三版。两人先后 commit,各自收进历史的是哪一版?</summary>

都是「add 过的那版」。B 的清单停在 add 那刻的版本,commit 收它。A 改了没 add,清单还是上一笔的旧登记,commit 收的还是那份。工作区里的最新版谁也没收——要收它,再 add 一次。回查「三态对比」与第二猜。
</details>

<details>
<summary>2. 反事实:假如 index 条目只存路径和对象名,不存 mtime、size 这些 stat 字段。git 还能正常工作吗,mini-git 付了吗?</summary>

能,功能照旧。status 与 write-tree 都不靠 stat 数据做判断。代价是每次都要把每个文件整个读出来重算哈希,大仓库上 status 从秒回退化成全库重读。mini-git 恰恰就是这么过的:字段照存以保持格式互认,比对从不利用它们跳步。回查「条目」第一停拍处。
</details>

<details>
<summary>3. 一次 add 都没做过的仓库里,mini-git 与真 git 的 write-tree 各输出什么。空树的名字你推得出来吗?</summary>

mini-git 扫工作区,输出整目录的树——第 3 章口径的缺省路径。真 git 写空树 4b825dc642cb6eb9a060e54bf8d69288fbee4904。对齐只需改 cmdWriteTree 的分流:把「无 index」从退回老路改成拿空清单调 writeTreeFromIndex。空清单分组不出目录,encodeTree 拼零条目,落库即空树。名字由 `tree 0` 加 0 字节的 SHA-1 决定,第 2 章的公式自己算得出。回查「writeTreeFromIndex」。
</details>
