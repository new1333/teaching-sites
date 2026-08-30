// 亲手开机入口：node src/boot.ts 起服务，然后用 redis-cli -p 6399 连它。
// 第 8 章起带上 AOF：账本落在 appendonly.aof，开机先把旧账重放一遍——重启不再两袖清风
import { MiniRedis } from './db.ts'
import { createMiniRedisServer } from './server.ts'
import { createFileAof } from './aof.ts'

const port = Number(process.argv[2] ?? 6399)
const aof = createFileAof('appendonly.aof') // 默认 everysec：折中档——两条命令隔一秒以上就都会钉盘
const server = await createMiniRedisServer(new MiniRedis({ aof }), port)
console.log(`mini-redis 已就绪：redis-cli -p ${server.port} PING（AOF 开机重放 ${aof.size} 条）`)
