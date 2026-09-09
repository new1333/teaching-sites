// companion: apps/api/src/cache/redis-cache.ts · RedisCache——ioredis 的薄封装，缓存的读写与计数的原子自增都在这一个客户端上
import Redis from 'ioredis'

/**
 * 读路径缓存的缝：应用只认这两个方法。
 * get 返回 null 表示「键不存在」（缓存未命中）；setEx 是 SETEX key ttl value 的语义——
 * 写入并指定存活秒数，到期由 Redis 自动删除。
 */
export interface LinkCache {
  get(key: string): Promise<string | null>
  setEx(key: string, ttlSeconds: number, value: string): Promise<unknown>
}

/**
 * 同一个 Redis 客户端的完整视图：缓存放 get/setEx，限流放 incr/expire，
 * del 给测试清场。两个消费面共用一条连接（ioredis 自己管连接复用），end() 一并归还。
 */
export interface RedisCache extends LinkCache {
  del(key: string): Promise<unknown>
  /** INCR key：键不存在则从 0 起算返回 1。命令级原子，多进程并发自增不会丢数 */
  incr(key: string): Promise<number>
  /** EXPIRE key seconds：给键设存活秒数，到期自动删除 */
  expire(key: string, seconds: number): Promise<unknown>
  end(): Promise<unknown>
}

export function createRedisCache(redisUrl: string): RedisCache {
  const redis = new Redis(redisUrl)
  return {
    get: (key) => redis.get(key),
    setEx: (key, ttlSeconds, value) => redis.setex(key, ttlSeconds, value),
    del: (key) => redis.del(key),
    incr: (key) => redis.incr(key),
    expire: (key, seconds) => redis.expire(key, seconds),
    end: () => redis.quit(),
  }
}
