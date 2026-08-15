---
title: activePinia：一个应用一个容器
---

# activePinia：一个应用一个容器

一个只在生产环境出现、且只在高峰期出现的线上事故。SSR 电商站，周一晚八点客服炸了：十几个用户投诉「购物车里的东西不是我的」。日志里没有任何报错——状态「串号」了：用户 A 渲染出的页面上是用户 B 的购物车。本地复现不了，负载一高就出现。最后定位到的是一行我们都写过的代码：模块级变量 `activePinia`。这一章不写新代码——pinia-mini 的功能上一章已经完备——我们把这场事故的完整时序推演一遍，搞清楚这个模块级变量**为什么危险、pinia 用什么纪律把风险压到最小、以及纪律的边界在哪**。理解了这一章，你才算理解第 3 章那句「危险但必要」。

## 事故重演：一步一步串号

背景两条事实。其一：服务器是**长驻进程**，模块只加载一次，模块级变量全进程共享。其二：Node 是**并发 interleaved** 的——每个请求是一个异步任务，`await` 是让出点，让出期间其他请求随便跑。

现在两个请求同时进来，每个请求各自 `createApp()` + `app.use(piniaX)`（各自的容器，这部分是对的）：

```text
时间轴                     activePinia 的值
─────────────────────────────────────────────
请求 A: install(piniaA)         piniaA
请求 A: 渲染组件 → useStore()   piniaA ✓（读到 A 的购物车）
请求 A: action 里 await 接口     ——A 让出，事件循环空转——
请求 B: install(piniaB)         piniaB   ← 覆盖发生在这里
请求 B: 渲染、取数、返回          piniaB ✓（B 一切正常）
请求 A: await 恢复，继续渲染
请求 A: 某组件外调用 useStore()   piniaB ✗ —— A 的页面读到了 B 的购物车
─────────────────────────────────────────────
```

覆盖只花一微秒，伤害在 A **恢复执行之后**才显形——这就是它难复现的原因：要让事故发生，需要「A 恰好在 await 之后、通过组件外通道取 store」，而这个通道平时被前两道防线护着（下面讲），只有高峰期的长接口、重试逻辑、路由守卫这类边角会踩进去。

## 三道防线

真 pinia 对这个风险布了三道防线。mini 里前两道已经实现，第三道留给这一章讲清楚。

**第一道：install 时 setActivePinia（第 3 章）**。`app.use(pinia)` 的第一个动作就是 `setActivePinia(pinia)`。它护住的是**请求的同步开头**——从 install 到第一次让出之间，组件外取 store 永远正确。事故时序里 A 的前两次取用都靠它。

**第二道：action 与 getter 入口 setActivePinia（第 5、8 章）**。每个 action 外壳的第一行、每个 getter 的 computed 内部，都有一句 `setActivePinia(pinia)`——闭包里捕获的 `pinia`，不是全局变量。它护住的是**跨 store 调用**：A 的 action 里 `useCartStore()`，即便此刻全局 activePinia 已被 B 覆盖，action 入口刚刚把它刷回了自己家。这是「闭包状态优于全局状态」的教科书案例——**风险窗口内，每次进入 pinia 的代码都重新校准归属**。

**第三道：app.runWithContext（mini 未实现）**。Vue 3.3 给 App 加了 `runWithContext(fn)`：在 fn 执行期间，`inject()` **不需要组件实例**也能找到这个 app 的 provides。真 pinia 用它包住 store 的 setup 执行——于是「组件内 useStore」的 inject 通道在 setup 语法里也畅通，对 activePinia 的依赖进一步减少。这是真源码里 `const runWithContext = (pinia._a && pinia._a.runWithContext) || fallbackRunWithContext` 那一行的全部意义：**能走 inject（随应用隔离）的，绝不走全局变量**。

三道防线的共同思想：**全局变量只做兜底，不做依赖**。inject 通道天然随应用隔离，永远是第一选择；activePinia 是组件外（路由守卫、工具函数、测试）没有 inject 时的最后通道，而每进入一次 pinia 自己的代码（install、action、getter），就重新校准一次。

## 边界：纪律防不住的地方

诚实地划出边界——就算三道防线全上，仍有一个窗口是结构性的：**await 之后、通过组件外通道、且中间没有任何 action/getter 入口的裸 useStore() 调用**。事故时序的最后一步正是它。防线二能救「action 里 await 后再取别的 store」（入口刷新过），救不了「游离在业务代码里的回调」。

所以纪律的最后一条落在**使用者**身上，且写进了 pinia 官方文档：

```ts
// ❌ 高峰期可能串号：await 后的裸调用
async function loadProfile() {
  await api.getUser()
  const store = useUserStore()   // activePinia 可能已被别的请求覆盖
}

// ✅ 进门先拿 store（或 pinia），之后全用局部变量
async function loadProfile() {
  const store = useUserStore()   // 同步开头，第一道防线护住
  const user = await api.getUser()
  store.setUser(user)            // 闭包引用，与 activePinia 无关
}
```

**同步开头取引用，异步之后用闭包**——一句话的纪律，关掉最后一个窗口。

## 回望：同一个变量的两张脸

推演完事故，再看这个变量在两种环境里的两张脸，才算看清它的全貌：

**浏览器里**：一个标签页一个应用，install 只发生一次，activePinia 覆盖永不发生——它是一张永远正确的全局地图。第 4 章的「三级回退」里它是安全的兜底。

**服务器与测试里**：多应用并存（每个请求一个、每个测试一个），覆盖随时发生——它是危险的共享可变状态。但测试恰恰**依赖**这个特性：`setActivePinia(createPinia())` 一行，所有 `useStore()` 无需组件就能跑——官方 `createTestingPinia` 的地基。危险与便利是同一个机制的两面，删掉它两边都塌。

所以 pinia 的选择不是消灭这个变量，而是**把它围起来**：每份代码入口重新校准（防线一二三）+ 使用者纪律（同步开头取引用）。这与第 1 章「模块级单例没有应用边界」的判词遥相呼应——activePinia 也是模块级的，但它装的**不是状态**（状态在容器里，随应用隔离），只是**一个指路牌**；指路牌指错方向的窗口被压缩到微秒级并被纪律封口。状态与指路牌分离，才是「一个应用一个容器」的完整含义。

## 小结

串号 = 模块级变量 × await 交错；三道防线 = install 校准 + action/getter 入口校准 + runWithContext 让 inject 走通；结构性的残余窗口由使用者纪律封口：同步开头取引用，异步之后用闭包。activePinia 在浏览器是安全兜底、在服务器与测试是便利与危险同源——状态在容器、指路牌在模块，两者分离是全套设计的落点。最后一章，带着你的 pinia-mini 回到真源码，画一张差异地图。
