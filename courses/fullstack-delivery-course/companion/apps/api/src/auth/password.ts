// companion: apps/api/src/auth/password.ts · 密码的加盐慢哈希与常数时间比对
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

/** 派生键长度（字节）：64 字节 = 512 位，存成 hex 后 128 字符 */
const KEY_LENGTH = 64

/**
 * 把密码变成不可逆的存储串：`scrypt:<盐>:<派生键>`。
 * 盐是 16 字节随机数，每次哈希都重新生成——同一个密码两次入库，串也不一样。
 * scrypt 默认成本参数 N=16384、r=8、p=1（内存难度 16 MiB 量级，含义对齐 RFC 7914）。
 */
export async function hashPassword(
  password: string,
  salt: string = randomBytes(16).toString('hex'),
): Promise<string> {
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer
  return `scrypt:${salt}:${derived.toString('hex')}`
}

/**
 * 登录侧比对：用存串里的盐重算一遍，再与存串里的派生键做常数时间比较。
 * timingSafeEqual 逐字节比对、耗时与相同位置无关，不泄漏「对到第几位才错」。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split(':')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer
  const expected = Buffer.from(hash, 'hex')
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}
