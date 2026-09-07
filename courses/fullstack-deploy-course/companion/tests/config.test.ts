// companion/tests/config.test.ts · loadAppConfig 行为测试：齐全返回 / 缺失与非法一次报全 / 绝不部分返回
// 刻意不依赖 Nuxt 运行时：loadAppConfig 是普通函数，env 由测试显式给足，进程环境不参与
import { describe, expect, it } from 'vitest'
import { ConfigError, loadAppConfig } from '../server/utils/config'

const DB_URL = 'postgres://ship_log:ship_log@127.0.0.1:5432/ship_log'

// 齐全且合法的环境：两个必需变量都在
const completeEnv = {
  NUXT_DB_URL: DB_URL,
  NUXT_PUBLIC_APP_ENV: 'staging',
}

describe('loadAppConfig（齐全）', () => {
  it('返回以应用视角命名的配置对象（NUXT_ 前缀被翻译掉）', () => {
    expect(loadAppConfig(completeEnv)).toEqual({ dbUrl: DB_URL, appEnv: 'staging' })
  })

  it('staging 与 production 都合法', () => {
    expect(loadAppConfig({ ...completeEnv, NUXT_PUBLIC_APP_ENV: 'production' }).appEnv).toBe('production')
  })
})

describe('loadAppConfig（缺失与非法）', () => {
  it('两个必需变量都缺失时，一次报全：清单同时含两个键', () => {
    try {
      loadAppConfig({})
      expect.unreachable('空环境必须抛 ConfigError')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      const message = (err as ConfigError).message
      expect(message).toContain('NUXT_DB_URL')
      expect(message).toContain('NUXT_PUBLIC_APP_ENV')
    }
  })

  it('只缺一个时，清单只含缺失的那个（不冤枉已就位的键）', () => {
    try {
      loadAppConfig({ NUXT_DB_URL: DB_URL })
      expect.unreachable('缺 NUXT_PUBLIC_APP_ENV 必须抛 ConfigError')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      const message = (err as ConfigError).message
      expect(message).toContain('NUXT_PUBLIC_APP_ENV')
      expect(message).not.toContain('NUXT_DB_URL')
    }
  })

  it('清空（空字符串）等于缺失：dbUrl 为空串时抛 ConfigError', () => {
    expect(() => loadAppConfig({ ...completeEnv, NUXT_DB_URL: '' })).toThrow(ConfigError)
  })

  it('非法值被拒：appEnv 不在允许集合内时报错并指认该键', () => {
    try {
      loadAppConfig({ ...completeEnv, NUXT_PUBLIC_APP_ENV: 'dev' })
      expect.unreachable('非法 appEnv 必须抛 ConfigError')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).message).toContain('NUXT_PUBLIC_APP_ENV')
    }
  })

  it('绝不部分返回：一项有问题就不返回任何配置对象', () => {
    // dbUrl 合法、appEnv 缺失——不允许「先给你 dbUrl，appEnv 稍后补」的半成品
    expect(() => loadAppConfig({ NUXT_DB_URL: DB_URL })).toThrow(ConfigError)
  })
})
