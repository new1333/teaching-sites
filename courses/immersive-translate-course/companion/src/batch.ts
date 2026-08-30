/**
 * 批量与并发（第 7 章）：请求怎么打包、怎么排队——翻译经济学的两件工具。
 * 公共 API：chunkByBudget / createLimiter。
 */

/**
 * 按字符预算把一批文本装袋：贪心装袋，装满一袋换一袋，顺序不乱。
 * 预算模拟真实翻译服务的单请求上限（按字符计的配额）——一次网络往返的固定开销，
 * 摊到一袋多条上才划算；超预算的段落自己独占一袋且不切件：
 * 段落一切，句子上下文就没了，翻译质量换流量不划算。
 */
export function chunkByBudget(texts: string[], charBudget: number): string[][] {
  const chunks: string[][] = []
  let bag: string[] = []
  let used = 0
  for (const text of texts) {
    if (text.length > charBudget) {
      // 超大件：已装的先封袋，它自己一袋——不切件
      if (bag.length > 0) {
        chunks.push(bag)
        bag = []
        used = 0
      }
      chunks.push([text])
      continue
    }
    if (used + text.length > charBudget) {
      chunks.push(bag) // 这件装不下了：封袋，开新袋
      bag = []
      used = 0
    }
    bag.push(text)
    used += text.length
  }
  if (bag.length > 0) chunks.push(bag) // 最后一袋别忘封
  return chunks
}

/**
 * 并发上限队列：柜台叫号——窗口就 max 个，任务排队进场。
 *
 * 「同时最多 N 个」为什么不靠 Promise.all？请求在 promise 被创建那一刻就已发车，
 * Promise.all 只管等齐、不管「同时几个在飞」——200 个任务一口气创建出来就是 200 个同时出发，
 * 服务端回你的就是 429。得有人守在门口数数：进一个计一个，出来一个再放一个。
 * 守门的东西就是这个函数：包住「将要发出的请求」，把「何时真的发出」攥在自己手里。
 *
 * 实现只有一本账（active）一支队（queue）：
 * 提交时窗口有空位（active < max）立刻发车，否则把「发车动作」挂进队伍；
 * 任何一个任务落定（无论成败）都从队头放行下一个。失败不堵窗口——
 * 崩掉的任务也占过窗口，落定时一样把位置让出来。
 */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  const windows = Math.max(1, Math.floor(max)) // 上限钳到至少 1：0 个窗口等于永久罢工
  let active = 0
  const queue: Array<() => void> = [] // 排队的是「已领号、等叫号」的发车动作
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const depart = (): void => {
        active++
        task().then(
          (value) => {
            settle()
            resolve(value) // 结果原样透传：limiter 不改任务，只管时刻表
          },
          (err) => {
            settle()
            reject(err) // 异常也原样透传：接住它的是调用方（管线的降级 try/catch）
          },
        )
      }
      const settle = (): void => {
        active--
        queue.shift()?.() // 窗口空出一个，队头补位——先来的先上
      }
      if (active < windows) depart()
      else queue.push(depart)
    })
  }
}
