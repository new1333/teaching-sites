// 第 2 章测试：RESP 解码器（半包/粘包）、应答编码、PING/SET/GET/DEL 命令分发、TCP 挂接往返。
// 只断言行为（喂什么、得到什么），不断言实现细节。
import { describe, expect, it } from 'vitest'
import {
  RespDecoder,
  encodeArrayOfStrings,
  encodeBulkString,
  encodeError,
  encodeInteger,
  encodeNullBulkString,
  encodeSimpleString,
} from '../src/resp.ts'
import { MiniRedis } from '../src/db.ts'
import { connect } from '../src/client.ts'
import { createMiniRedisServer } from '../src/server.ts'

const SET_A_1 = '*3\r\n$3\r\nSET\r\n$1\r\na\r\n$1\r\n1\r\n'
const GET_A = '*2\r\n$3\r\nGET\r\n$1\r\na\r\n'

describe('应答编码：五种 RESP 类型', () => {
  it('简单串：+ 开头，\\r\\n 收尾', () => {
    expect(encodeSimpleString('OK')).toBe('+OK\r\n')
    expect(encodeSimpleString('PONG')).toBe('+PONG\r\n')
  })

  it('错误串：- 开头，错误前缀 + 空格 + 消息', () => {
    expect(encodeError('ERR unknown command')).toBe('-ERR unknown command\r\n')
  })

  it('整数：: 开头，带符号十进制', () => {
    expect(encodeInteger(3)).toBe(':3\r\n')
    expect(encodeInteger(0)).toBe(':0\r\n')
    expect(encodeInteger(-1)).toBe(':-1\r\n')
  })

  it('批量串：长度前缀按 UTF-8 字节数计，不是字符数', () => {
    expect(encodeBulkString('hello')).toBe('$5\r\nhello\r\n')
    expect(encodeBulkString('')).toBe('$0\r\n\r\n')
    expect(encodeBulkString('你好')).toBe('$6\r\n你好\r\n')
  })

  it('空值：缺失的键用 $-1 表示，不是空串', () => {
    expect(encodeNullBulkString()).toBe('$-1\r\n')
  })

  it('数组：元素个数前缀 + 逐个元素', () => {
    expect(encodeArrayOfStrings(['a', 'b'])).toBe('*2\r\n$1\r\na\r\n$1\r\nb\r\n')
    expect(encodeArrayOfStrings([])).toBe('*0\r\n')
  })
})

describe('RespDecoder：命令解码', () => {
  it('一次喂整条命令，解出一组参数', () => {
    const d = new RespDecoder()
    expect(d.feed(SET_A_1)).toEqual([['SET', 'a', '1']])
  })

  it('半包：切在参数中间的两段，拼齐之前一无所获', () => {
    const d = new RespDecoder()
    expect(d.feed('*2\r\n$3\r\nGE')).toEqual([]) // 半条命令：还没到齐
    expect(d.feed('T\r\n$1\r\na\r\n')).toEqual([['GET', 'a']])
  })

  it('半包：切在批量串数据中间也能拼齐', () => {
    const d = new RespDecoder()
    expect(d.feed('*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$5\r\nhe')).toEqual([])
    expect(d.feed('llo\r\n')).toEqual([['SET', 'k', 'hello']])
  })

  it('粘包：三条命令挤在一次到达，按序全部解出', () => {
    const d = new RespDecoder()
    const cmds = d.feed(SET_A_1 + GET_A + '*1\r\n$4\r\nPING\r\n')
    expect(cmds).toEqual([
      ['SET', 'a', '1'],
      ['GET', 'a'],
      ['PING'],
    ])
  })

  it('极端切法：逐字符喂，结果与一次喂完全一致', () => {
    const d = new RespDecoder()
    const collected: string[][] = []
    for (const ch of SET_A_1) collected.push(...d.feed(ch))
    expect(collected).toEqual([['SET', 'a', '1']])
  })

  it('空批量串与多字节字符的长度按字节计', () => {
    const d = new RespDecoder()
    expect(d.feed('*2\r\n$0\r\n\r\n$6\r\n你好\r\n')).toEqual([['', '你好']])
  })

  it('不认裸文本命令（inline command 不在本课范围）', () => {
    const d = new RespDecoder()
    expect(() => d.feed('PING\r\n')).toThrow(/protocol/i)
  })
})

describe('MiniRedis.execute：命令分发', () => {
  it('PING 回 PONG，命令名大小写不敏感', () => {
    const db = new MiniRedis()
    expect(db.execute(['PING'])).toBe('+PONG\r\n')
    expect(db.execute(['ping'])).toBe('+PONG\r\n')
  })

  it('SET 存、GET 取，往返一致', () => {
    const db = new MiniRedis()
    expect(db.execute(['SET', 'a', '1'])).toBe('+OK\r\n')
    expect(db.execute(['GET', 'a'])).toBe('$1\r\n1\r\n')
  })

  it('GET 不存在的键回 $-1（nil），DEL 回删除个数', () => {
    const db = new MiniRedis()
    db.execute(['SET', 'a', '1'])
    expect(db.execute(['GET', 'missing'])).toBe('$-1\r\n')
    expect(db.execute(['DEL', 'a', 'missing'])).toBe(':1\r\n')
    expect(db.execute(['DEL', 'a'])).toBe(':0\r\n')
    expect(db.execute(['GET', 'a'])).toBe('$-1\r\n')
  })

  it('未知命令与参数个数错误都回 RESP 错误应答，不抛异常', () => {
    const db = new MiniRedis()
    expect(db.execute(['NOPE'])).toMatch(/^-ERR unknown command/)
    expect(db.execute(['SET', 'k'])).toMatch(/^-ERR wrong number of arguments/)
    expect(db.execute([])).toMatch(/^-ERR/)
  })
})

describe('TCP 挂接：真客户端连上真服务器', () => {
  it('PING/SET/GET/DEL 全程走网络往返', async () => {
    const server = await createMiniRedisServer(new MiniRedis(), 0) // 端口 0：让系统分配空闲端口，避免与本机真 Redis 的 6379 相撞
    const c = await connect(server.port)
    try {
      expect(await c.cmd('PING')).toBe('+PONG\r\n')
      expect(await c.cmd('SET', 'greet', 'hello')).toBe('+OK\r\n')
      expect(await c.cmd('GET', 'greet')).toBe('$5\r\nhello\r\n')
      expect(await c.cmd('GET', 'nope')).toBe('$-1\r\n')
      expect(await c.cmd('DEL', 'greet')).toBe(':1\r\n')
      await expect(c.cmd('NOPE')).rejects.toThrow(/unknown command/)
    } finally {
      await c.close()
      await server.close()
    }
  })
})
