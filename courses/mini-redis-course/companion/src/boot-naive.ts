// 反例开机入口：node src/boot-naive.ts 起「最笨版」服务器。
// 玩法：再开一个客户端连上后什么都不敲（占住席位），第三个客户端会被冻结；
// 关掉占位者，冻结立刻解除。对照 node src/boot.ts（事件驱动版）没有这场冻结。
import { MiniRedis } from './db.ts'
import { createNaiveMiniRedisServer } from './naive-server.ts'

const port = Number(process.argv[2] ?? 6398)
const server = await createNaiveMiniRedisServer(new MiniRedis(), port)
console.log(`naive mini-redis 已就绪：先连一个客户端占住席位（什么都不敲），再 redis-cli -p ${server.port} PING 看它被冻结`)
