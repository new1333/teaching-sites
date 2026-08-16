---
title: 三级缓存与在途去重：同一本书只取一次
---

# 三级缓存与在途去重：同一本书只取一次

打开一个排满图标的组件文件，网络面板瞬间冒出 30 个请求——全是同一个 `mdi.json`。装饰扫描要画图标，补全列表要图标名，两套逻辑各自触发加载；文件里有 30 个 mdi 图标，装饰循环就发起了 30 次加载。重启编辑器，同样的 30 个请求原样再来一遍，好像昨天的下载全是白费。这三个现象对应三个缺失的机制：请求没有合并、结果没有记忆、记忆没有持久化。这一章一次补齐。

## 原理：逐级回源与共享取书单

沿用全书的数据比喻：图标集合是图书馆里的书，懒人图书馆的规矩是**点名才取**。三级缓存就是三个取书的位置——桌上（内存）、家里的书架（磁盘）、远处的仓库（网络）。找一本书永远从最近的地方开始：桌上有的绝不去书架，书架有的绝不去仓库。每一级都替下面一级挡掉一批请求。

内存级挡住的是「同一会话内的重复」。装饰循环 30 个图标，第一个把 `mdi.json` 放进内存，后 29 个直接命中。

磁盘级挡住的是「跨会话的重复」。下载成功后把数据写进扩展的存储目录，重启编辑器后内存清空、磁盘还在——昨天的下载不再白费。

在途去重（In-flight Dedup）挡住的是最后一类浪费：**正在进行中的重复**。第 1 个请求出发了还没回来，第 2 到第 30 个也想要同一本书。如果每个请求都自己发一趟网络，就是开头那 30 个并发请求的惨案。解法朴素：给「进行中的任务」记一张表，key 是参数，value 是那个还没结算的 Promise。后来的调用者发现表里已有同 key 的任务，直接共享同一个 Promise——**几个人共用一张取书单，书到了一起拿**。

这张表什么时候清理，藏着成败细节。任务结算（无论成功失败）就从表里移除：成功的结果已由内存缓存接管，表里不需要残留；失败的结果绝不能缓存——网络抖了一下就把它记一辈子，之后每次都直接返回失败，才是真正的事故。「表只在途有效，成败都靠后一级接管或重试」，这是在途去重的语义边界。

## 渐进实验：createLoader

数据形态先钉下来（`src/types.ts`）：集合是 `{prefix, width?, height?, icons: {名字: {body}}}`，`body` 是 SVG 的内部绘制片段。然后是本章主角 `src/loader.ts`：

```ts
// src/loader.ts · uniqPromise
export function uniqPromise<A, R>(fn: (arg: A) => Promise<R>): (arg: A) => Promise<R> {
  const tasks = new Map<A, Promise<R>>()
  return (arg: A) => {
    let task = tasks.get(arg)
    if (!task) {
      task = fn(arg).finally(() => tasks.delete(arg))
      tasks.set(arg, task)
    }
    return task
  }
}
```

十行不到的一个高阶函数：把「按参数去重的异步调用」做成了可复用的能力。`finally` 里删表是关键一行——它同时保证了成功不残留（内存缓存接管）与失败可重试（下次调用会重新发起）。

回源主体用它包住：

```ts
// src/loader.ts · createLoader(节选)
const loadIconSet = uniqPromise(async (id: string): Promise<IconSetData | undefined> => {
  // 第一级:内存
  const cached = memory.get(id)
  if (cached) {
    log.info(`[${id}] 命中内存`)
    return cached
  }
  // 第二级:磁盘
  if (options.cacheDir) {
    const raw = await options.cacheDir.read(id)
    if (raw !== undefined) {
      try {
        const data = JSON.parse(raw) as IconSetData
        memory.set(id, data)
        log.info(`[${id}] 命中磁盘缓存`)
        return data
      }
      catch {
        log.error(`[${id}] 磁盘缓存损坏,跳过并回源`)
      }
    }
  }
  // 第三级:远程下载
  const data = await options.fetchIconSet(id)
  if (!data) {
    log.error(`[${id}] 下载失败`)
    return undefined
  }
  memory.set(id, data)
  await options.cacheDir?.write(id, JSON.stringify(data))
  return data
})
```

读这段代码注意三件事。其一，磁盘命中后顺手 `memory.set`——每一级命中都回填上一级，下次连磁盘都不用读。其二，磁盘数据解析失败被 `catch` 住并继续回源：坏缓存只是坏了一跳，不能卡死整条管线；回源成功后 `write` 会用好数据覆盖坏数据，自愈。其三，网络与磁盘都不是直接调用，而是构造时注入（`fetchIconSet`、`cacheDir`）——实验场因此零网络、零真实文件系统，测试想造「网络失败」「磁盘损坏」这些场景，注入一个假实现就行。这个注入风格从本章起贯穿剩余所有章节。

还有 `clearCache` 的语义选择：它只清内存，不动磁盘。这对应「重新加载」而不是「删除数据」——用户想刷新某个集合时，磁盘缓存继续兜底，不会把一次误操作变成一次全量重新下载。

## 验证

```bash
cd companion && pnpm test
```

34 条断言全绿，本章新增 8 条。重量级的几条：一个手动放行的假网络源，5 个 `loadIconSet('mdi')` 并发挂起时网络只被调用一次，放行后 5 个调用者拿到同一份结果；`clearCache` 之后再次加载，磁盘命中、网络调用数纹丝不动；第一次下载失败返回 `undefined` 且磁盘上一字未写，第二次调用重新出发并成功——失败不落盘、可重试；坏 JSON 的磁盘缓存被跳过，回源拿到好数据。开篇那 30 个请求的三个病根，各有专测镇守。

## 小结

三级缓存是「桌上、书架、仓库」的逐级回源，每一级命中都向上回填；在途去重是共享取书单——同 key 并发只发一次请求，任务结算即出表，成功交内存、失败可重试。网络与磁盘全部注入，坏数据只坏一跳不坏管线。数据到手了，但它还是一段裸的 SVG 片段——下一章给它穿上壳、染上主题色、编码成可以直接当图片用的 data URL。
