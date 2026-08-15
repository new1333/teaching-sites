import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMiniNginx, type MiniNginxConfig, type MiniNginxServer } from '../src/index.js'
import { rawGet } from './helpers.js'

let wwwRoot = ''
let base = ''
let server: MiniNginxServer | null = null
const vendorJs = `console.log("vendor chunk ${'x'.repeat(64)}");\n`.repeat(120) // ~8.9KB 文本

beforeAll(async () => {
  wwwRoot = mkdtempSync(join(tmpdir(), 'mini-nginx-gz-'))
  writeFileSync(join(wwwRoot, 'vendor.js'), vendorJs)
  writeFileSync(join(wwwRoot, 'tiny.js'), 'let x=1') // 8 字节，低于 minLength
  writeFileSync(join(wwwRoot, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00]))
  writeFileSync(join(wwwRoot, 'icon.svg'), `<svg>${'<circle r="1"/>'.repeat(80)}</svg>`)

  const config: MiniNginxConfig = {
    server: {
      root: wwwRoot,
      gzip: { minLength: 100 },
    },
  }
  server = createMiniNginx(config)
  base = (await server.listen()).url
})

afterAll(async () => {
  await server?.close()
  rmSync(wwwRoot, { recursive: true, force: true })
})

describe('ch8 gzip 压缩', () => {
  it('带 Accept-Encoding: gzip 的请求收到 gzip 响应，解压后与原文件一致', async () => {
    const r = await rawGet(base + '/vendor.js', { 'Accept-Encoding': 'gzip' })
    expect(r.status).toBe(200)
    expect(r.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(r.body).toString()).toBe(vendorJs)
    expect(r.body.length).toBeLessThan(vendorJs.length)
  })

  it('压缩比可观：8.9KB 文本显著缩小', async () => {
    const r = await rawGet(base + '/vendor.js', { 'Accept-Encoding': 'gzip' })
    expect(r.body.length).toBeLessThan(vendorJs.length / 5)
  })

  it('不带 Accept-Encoding 时不压缩，原样返回', async () => {
    const r = await rawGet(base + '/vendor.js')
    expect(r.headers['content-encoding']).toBeUndefined()
    expect(r.body.toString()).toBe(vendorJs)
  })

  it('PNG 不压缩：已压缩格式收益为负', async () => {
    const r = await rawGet(base + '/logo.png', { 'Accept-Encoding': 'gzip' })
    expect(r.headers['content-encoding']).toBeUndefined()
  })

  it('小于 minLength 的文件不压缩', async () => {
    const r = await rawGet(base + '/tiny.js', { 'Accept-Encoding': 'gzip' })
    expect(r.headers['content-encoding']).toBeUndefined()
  })

  it('SVG 属于文本类资源，压缩', async () => {
    const r = await rawGet(base + '/icon.svg', { 'Accept-Encoding': 'gzip' })
    expect(r.headers['content-encoding']).toBe('gzip')
  })

  it('未配置 gzip 的服务器不压缩（server 级开关，默认关闭）', async () => {
    const srv = createMiniNginx({ server: { root: wwwRoot } })
    const { url } = await srv.listen()
    try {
      const r = await rawGet(url + '/vendor.js', { 'Accept-Encoding': 'gzip' })
      expect(r.headers['content-encoding']).toBeUndefined()
      expect(r.body.toString()).toBe(vendorJs)
    } finally {
      await srv.close()
    }
  })
})
