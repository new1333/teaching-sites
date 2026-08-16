---
title: 自定义集合与热重载：私有图标库天天改
---

# 自定义集合与热重载：私有图标库天天改

设计团队有一套私有图标库，走自定义集合配置接进了扩展。头一周相安无事，第二周设计师开始迭代：加三个新图标、改两个旧图标——每改一次，前端群就准时出现一句「重启一下窗口重新加载」。更糟的还在后面：有人把配置里的远程地址换成了新版，旧地址的集合却还留在内存里，新旧两个前缀同时生效，同一份代码里图标随机抽风。**数据源会变，是数据源的本性**；扩展要么跟上变化，要么让用户用重启来模拟静态世界。这一章给引擎接上自定义集合：本地文件监听变更、远程地址增删自动装卸，全部接进上一章的响应式世界。

## 原理：一张表、两种源、三个动作

自定义集合的输入是一份配置清单：几个本地路径（团队的 `icons.json`）、几个远程 URL（设计系统托管的 JSON）。设计的关键决策只有一个——**统一成一张以规范化 URL 为键的集合表**：本地路径加 `file://` 前缀，远程保持 `http(s)://` 原样。键的统一带来三个直接好处：本地与远程永远不会撞键（开篇的抽风事故正是两个源的键空间混在一起造成的）；增删就是 Map 的 set 与 delete；「当前有哪些集合」就是 `store.values()` 一览。

清单变化时执行三个动作。**分流**：`http(s)://` 开头归远程、`file://` 剥成路径、其余当本地路径——分流只看形态，不看心情。**加载**：本地走注入的 `readJson`，远程走注入的 `fetchJson`；本地全量重读（私有集合小，简单正确），远程只拉新键（重复 update 不能重复下载——第 5 章的原则在数据源层再现）。**扫除**：不在新清单里的键统一卸载，配置删了地址，内存里就不能有残留。

热重载发生在两次 update 之间。本地文件挂上监听：变更事件重读该文件、覆盖同键条目；删除事件直接卸载。这里有个容易漏掉的接线：**监听清单本身也随配置变**——清单换了，旧监听先销毁、新清单整体重挂，不然被移出配置的文件还在偷偷触发加载。而「集合表变了」要传导给引擎，靠的是上一章的成果：集合表同步进一个 `ref`，装饰、补全里凡是依赖它的 `computed` 自动重算——数据流从配置一路活到屏幕，中间没有任何一处手写刷新。

最后是失败语义：加载失败的键要清掉旧条目。文件暂时写坏、URL 暂时超时，都不能让上一次的好数据永远留驻——陈旧的条目比空缺更危险，它会让用户以为看到了真相。

## 渐进实验：createCustomCollections

```ts
// src/custom-collections.ts · 主体结构
export function createCustomCollections(options: CustomCollectionsOptions): CustomCollections {
  const store = new Map<string, IconSetData>()
  const collections = ref<IconSetData[]>([])
  let watcher: { dispose(): void } | null = null

  function sync() {
    collections.value = [...store.values()]
  }

  function unload(key: string) {
    if (store.delete(key))
      sync()
  }

  /** 本地文件读取:失败时清掉同键旧数据,不留陈旧条目 */
  async function loadLocal(path: string) {
    try {
      store.set(fileKey(path), await options.readJson(path))
      options.log?.info?.(`loaded ${path}`)
    }
    catch (e) {
      store.delete(fileKey(path))
      options.log?.error?.(`load failed: ${path} ${String(e)}`)
    }
    sync()
  }

  async function update(paths: string[]) {
    const { local, remote } = classify(paths)

    // 本地清单变化即重挂监听:旧 watcher 先销毁,新清单整体接管
    watcher?.dispose()
    watcher = null
    if (options.watchFiles && local.length) {
      watcher = options.watchFiles(local, {
        onChange: path => void loadLocal(path),
        onDelete: path => unload(fileKey(path)),
      })
    }

    // 本地全量重读(文件小,简单正确);远程只拉新键(重复 update 不重复拉)
    await Promise.all([
      ...local.map(loadLocal),
      ...remote.filter(url => !store.has(url)).map(loadRemote),
    ])

    // 扫除:已从配置消失的键(本地或远程)统一卸载
    const validKeys = new Set([...local.map(fileKey), ...remote])
    for (const key of [...store.keys()])
      if (!validKeys.has(key))
        unload(key)
    sync()
  }
  // ...loadRemote 与 dispose
}
```

开发这个模块时我踩了一个值得记录的坑：最初 `loadLocal` 更新完 `store` 就返回，忘了调 `sync()`——结果「文件保存事件」明明触发了重读，`collections.value` 却纹丝不动，测试红得莫名其妙。教训是**内部容器（Map）和对外事实源（ref）是两个东西**，每次容器变更都要显式推送到事实源，否则响应式链条从这里断掉。类似的还有 `file:///E:/a.json` 的剥离：去掉 `file://` 后残留一个前导斜杠，得到的 `/E:/a.json` 与真实路径对不上——URL 与路径的转换永远藏着一个斜杠的坑。

与引擎的组合不需要任何胶水代码，前几章的接口天然咬合：

```ts
// 用法示例
const custom = createCustomCollections({ readJson, fetchJson, watchFiles })
await custom.update(config.customCollectionJsonPaths)

// 集合清单:内置 + 自定义,随热重载自动流动
const collectionIds = computed(() => [
  ...builtinCollectionIds,
  ...custom.collections.value.map(c => c.prefix),
])
// 从此 parseIcon / buildRegexes / provideCompletions 用到的集合清单都是活的
```

设计师保存文件 → 监听事件 → 集合表更新 → `collectionIds` 重算 → 正则重建 → 装饰与补全自动刷新。开篇那句「重启一下窗口」，从此没有出场机会。

## 验证

```bash
cd companion && pnpm test
```

81 条断言全绿，本章新增 10 条。本地路径加载并挂上监听；「保存文件」（触发注入的变更事件）后集合表自动换新，`vi.waitFor` 等到了新数据；「删除文件」后对应集合卸载；两次 update 之间旧 watcher 恰好销毁一次、重挂一次。远程侧：URL 从配置移除即卸载；重复 update 只拉取一次；`file:///E:/a.json` 与 `https://cdn/b.json` 共存且互不冲突；加载失败的路径不留任何条目。组合侧：自定义前缀进入集合清单后 `parseIcon('my:star')` 立即可解析；`collections` 接进 `watchEffect` 后，一次热重载把前缀列表从 `['my']` 自动推进到 `['my2']`——响应式链路端到端贯通。

## 小结

自定义集合 = 一张以规范化 URL 为键的统一表 + 分流、加载、扫除三个动作；本地靠监听热重载，远程靠 diff 增删，清单变化即重挂监听；失败清旧不留陈旧。集合表进 ref，与第 10 章的依赖追踪咬合，数据源的变化一路自动流到装饰与补全。引擎至此完整。最后一章收束全局：激活的时机、命令的接线、缓存治理——把「不拖慢所有人的启动」这件事讲完。
