import type { LinkResponse } from '@shortlink/shared'

export interface MemoryStore {
  put(link: LinkResponse): LinkResponse
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
