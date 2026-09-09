// companion: apps/api/src/store.ts · 端点能用的最小存储接口 + 内存实现
import type { LinkResponse } from '@shortlink/shared'

/**
 * 注入缝：端点只依赖这两个方法。
 * 返回值同时放行同步值与 Promise——存储住在进程内时同步（内存 Map），
 * 搬到进程外时异步（数据库）。await 一个普通值会原样通过，两种实现共用同一份端点代码。
 * put 的第二个参数 ownerId 是归属：谁创建的短链记在谁名下（内存实现可以忽略它）。
 */
export interface LinkStore {
  put(link: LinkResponse, ownerId: string): LinkResponse | Promise<LinkResponse>
  get(slug: string): LinkResponse | undefined | Promise<LinkResponse | undefined>
}

export interface MemoryStore {
  put(link: LinkResponse, ownerId: string): LinkResponse
  get(slug: string): LinkResponse | undefined
}

export function createMemoryStore(): MemoryStore {
  const links = new Map<string, LinkResponse>()
  return {
    put(link) {
      links.set(link.slug, link)
      return link
    },
    get(slug) {
      return links.get(slug)
    },
  }
}
