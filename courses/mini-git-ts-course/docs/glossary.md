# 术语表

全书术语按首教顺序收录;英文原名供对照检索。首教与定义的正本在各章正文,本页是回查入口。

| 术语 | 英文 | 一句话定义 |
|---|---|---|
| 快照模型 | snapshot model | Git 的每次提交记录的是当时整棵目录树的完整快照,不是相对上一版的差异清单。 |
| 工作区 | working tree | 你正在编辑、看得见的目录;与仓库之间隔着暂存区。 |
| 暂存区 | staging area / index | 工作区与仓库之间的缓冲层,本质是 .git/index 文件,记录「下一次提交将包含哪些文件的哪个版本」。 |
| 对象库 | object database | .git/objects 下按内容寻址存放的全部不可变对象,是 Git 唯一的持久层。 |
| 底层命令 | plumbing | 操作单个机制的细粒度命令(hash-object、cat-file、write-tree 等);与之相对的 porcelain(瓷器)高层命令(add、commit、branch)只是它们的便捷组合。 |
| 内容寻址 | content-addressed | 对象的名字由其内容决定:对「类型+长度+内容」整体取 SHA-1,同内容必然同名。 |
| SHA-1 | SHA-1 | Git 传统对象命名使用的 160 位哈希;40 个十六进制字符,前 2 位做目录、后 38 位做文件名。 |
| 对象头 | object header | 对象字节流开头的 `<类型> <字节数>\0` 文本前缀,参与哈希计算,读回时用它区分对象种类。 |
| 松散对象 | loose object | zlib 压缩后直接落在 objects/xx/yyyy… 的单个文件形态,与打包进 packfile 相对。 |
| tree 对象 | tree object | 目录快照的二进制对象:一串 `<模式> <名字>\0<20 字节哈希>` 条目,子目录递归指向另一棵 tree。 |
| 文件模式 | file mode | tree 条目里的 6 位八进制权限串,普通文件 100644、可执行文件 100755、目录 40000、符号链接 120000。 |
| 十六进制转储 | hex dump | 把字节流按偏移量逐字节打印成十六进制的观察手段,调试二进制格式的第一工具。 |
| Buffer | Buffer | Node 表示定长字节序列的类型,本课程用它做全部二进制编码与解析。 |
| commit 对象 | commit object | 文本对象:指向一棵 tree、零到多个 parent、作者与提交者信息及时间戳。 |
| 父提交 | parent commit | commit 对象里的 parent 字段;普通提交一个父,merge 提交两个,根提交零个。 |
| 提交图 | commit graph | 以提交为节点、父指针为边的有向无环图;分支、合并、变基都只是在这张图上的操作。 |
| index 文件 | index file | .git/index 的二进制格式:12 字节文件头 + 变长条目 + 路径名,暂存区的物理实体。 |
| 三态对比 | three-state comparison | 把工作区、暂存区、HEAD 三方两两比对得出 status;add 与 commit 各只搬动一跳。 |
| 引用 | ref | 指向某个对象的命名指针,通常是「含 40 位哈希的一行小文件」,存于 .git/refs 下。 |
| 符号引用 | symbolic ref | 内容为 `ref: <另一个引用>` 的间接引用,HEAD 就是指向当前分支的符号引用。 |
| detached HEAD | detached HEAD | HEAD 直接指向某提交而非分支名;此时新提交不属于任何分支,切走后只能靠哈希找回。 |
| 编辑脚本 | edit script | 把文本 A 变成文本 B 的最少增删行操作序列,diff 的算法产物。 |
| 最长公共子序列 | longest common subsequence | 两序列按顺序共有的最长子序列;其补集即编辑脚本,是行级 diff 的算法基础。 |
| unified diff | unified diff | Git 默认的 diff 输出格式:`@@ -a,b +c,d @@` 的 hunk 头加上下文行与 +/- 行。 |
| hunk | hunk | unified diff 中一段连续改动的块:位置头、若干上下文行与增删行。 |
| 可达性 | reachability | 沿父指针能走到的提交集合;分支、tag、HEAD 是让对象「活下来」的根。 |
| 最近公共祖先 | lowest common ancestor | 两提交在图上公共祖先中离二者最近者,即 merge-base,三方合并的 base。 |
| fast-forward | fast-forward | 一方是另一方祖先时,合并只是把分支指针前移,不产生新提交。 |
| 三方合并 | three-way merge | 以 base 为基准分别对 ours/theirs 打改动:改不同处自动合入,改同一处才冲突。 |
| 冲突标记 | conflict marker | 合并器写入工作区的 `<<<<<<<`/`=======`/`>>>>>>>` 分隔块,标出两侧各自的版本。 |
| merge 提交 | merge commit | 带两个父提交的提交,第一条边指向 ours、第二条指向 theirs。 |
| pkt-line | pkt-line | Git 传输协议的帧格式:4 位十六进制长度前缀 + 载荷,0000 为分隔_flush 帧。 |
| 引用发现 | ref discovery | 传输握手第一步:客户端 GET/连接后收到对端 pkt-line 流出的全部引用与哈希。 |
| remote-tracking 引用 | remote-tracking ref | refs/remotes/<名>/ 下记录「远端分支上次同步时在哪」的本地引用,push/fetch 更新它而非远端。 |
| bare 仓库 | bare repository | 没有工作区、只有 .git 内容的仓库,充当 push/fetch 的服务端落点。 |
