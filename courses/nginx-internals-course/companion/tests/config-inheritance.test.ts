// tests/config-inheritance.test.ts —— 第 6 章：配置解析与继承
import { describe, it, expect } from 'vitest'
import { parseConfig, resolveConfig } from '../src/config'

const CONF = `
# 顶层指令
worker_processes 4;

http {
    gzip on;
    keepalive_timeout 65;

    server {
        listen 8080;
        gzip off;

        location /api {
            gzip on;
        }

        location /static {
            keepalive_timeout 10;
        }
    }
}
`

describe('parseConfig：文本 → 块树', () => {
  it('解析出顶层指令与嵌套块', () => {
    const r = parseConfig(CONF)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.root.directives['worker_processes']).toBe('4')
    const http = r.root.children.find((c) => c.name === 'http')
    expect(http).toBeDefined()
    expect(http!.directives['gzip']).toBe('on')
    expect(http!.children.filter((c) => c.name === 'server')).toHaveLength(1)
  })

  it('location 块带着自己的参数入树', () => {
    const r = parseConfig(CONF)
    if (!r.ok) return
    const server = r.root.children[0].children.find((c) => c.name === 'server')!
    const locations = server.children.filter((c) => c.name === 'location')
    expect(locations.map((l) => l.args)).toEqual([['/api'], ['/static']])
  })

  it('注释被忽略', () => {
    const r = parseConfig('# 整份文件都是注释\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.root.children).toHaveLength(0)
  })

  it('未闭合的块报结构错误', () => {
    const r = parseConfig('http {\n  gzip on;\n')
    expect(r).toEqual({ ok: false, reason: 'unclosed-block' })
  })

  it('多余的右括号报结构错误', () => {
    const r = parseConfig('}\n')
    expect(r).toEqual({ ok: false, reason: 'stray-close' })
  })
})

describe('resolveConfig：沿路径合成有效配置', () => {
  it('子块写了算自己的：server 覆盖 http 的 gzip', () => {
    const r = parseConfig(CONF)
    if (!r.ok) return
    const serverEff = resolveConfig(r.root, ['http', 'server'])
    expect(serverEff!['gzip']).toBe('off') // http 是 on，server 写了 off
    expect(serverEff!['keepalive_timeout']).toBe('65') // server 没写，继承 http
    expect(serverEff!['listen']).toBe('8080') // server 自己的
  })

  it('没写的沿外层继承：location /api 继承 server 的 off？不——它自己写了 on', () => {
    const r = parseConfig(CONF)
    if (!r.ok) return
    const apiEff = resolveConfig(r.root, ['http', 'server', 'location'])
    expect(apiEff!['gzip']).toBe('on') // location 自己写了 on，压过 server 的 off
    expect(apiEff!['listen']).toBe('8080') // 三层穿透：从 server 继承
    expect(apiEff!['worker_processes']).toBe('4') // 三层穿透：从根继承
  })

  it('兄弟块互不影响：/static 没写 gzip，继承 server 的 off', () => {
    const r = parseConfig(CONF)
    if (!r.ok) return
    const staticEff = resolveConfig(r.root, ['http', 'server', 'location /static'])
    expect(staticEff!['gzip']).toBe('off') // 不受兄弟 /api 的 on 影响
    expect(staticEff!['keepalive_timeout']).toBe('10') // 自己写的
  })

  it('路径不存在的块返回 null', () => {
    const r = parseConfig(CONF)
    if (!r.ok) return
    expect(resolveConfig(r.root, ['http', 'upstream'])).toBeNull()
  })
})
