// tests/06-permissions-publish.test.js —— 第 6 章：权限的代价（CSP、CORS 与上架清单）
// 断言五组事：权限对账成立——auditPermissions 双向核对，报备了没人用的「多余」与用了没报备的
// 「缺失」都当场红（商店审核要问的「凭什么」，上架前先被自己的脚本问一遍；chrome.tabs.sendMessage
// 这类不需要 permissions 的调用不在账上，不算漏报）；host 对账成立——patternCovers 的协议/子域通配
// 规则要盖得住监听过滤器里的每个模式，盖不住任何流量的站点权限算多余；action 对账成立——
// manifest 声明与代码注册互为充要；WAR 对账成立——从 loader 出发的 import 闭包恰好等于
// web_accessible_resources 报备清单（少一项页面加载失败、多一项白暴露、门开到没注入的域算越界）；
// 打包清单成立——selectZipFiles 只放行 manifest.json 与 src/，测试与工具链文件一律进不了 zip。
// 最后拿真仓终态跑一遍全家桶：manifest 十项能力逐项对上号、零 finding。
// 规则全是纯函数：fixture manifest 与假源码文本从参数注入——不碰真实文件系统、不碰网络、不 sleep。

import { describe, it, expect } from 'vitest'
import manifest from '../manifest.json'
import swJs from '../src/background/sw.js?raw'
import loaderJs from '../src/content/loader.js?raw'
import mainJs from '../src/content/main.js?raw'
import buttonStateJs from '../src/content/button-state.js?raw'
import badgeJs from '../src/shared/badge.js?raw'
import messagesJs from '../src/shared/messages.js?raw'
import videoUrlJs from '../src/shared/video-url.js?raw'
import m3u8Js from '../src/shared/m3u8.js?raw'
import downloadJs from '../src/shared/download.js?raw'
import {
  patternCovers,
  auditPermissions,
  auditHosts,
  auditAction,
  auditWar,
  auditManifest,
  importClosure,
  selectZipFiles,
} from '../scripts/audit-rules.mjs'

/** 真仓全部源码：相对扩展根的路径 → 文本（auditManifest / importClosure 的 files 形参） */
const REAL_FILES = {
  'src/background/sw.js': swJs,
  'src/content/loader.js': loaderJs,
  'src/content/main.js': mainJs,
  'src/content/button-state.js': buttonStateJs,
  'src/shared/badge.js': badgeJs,
  'src/shared/messages.js': messagesJs,
  'src/shared/video-url.js': videoUrlJs,
  'src/shared/m3u8.js': m3u8Js,
  'src/shared/download.js': downloadJs,
}

describe('真仓终态：全书权限总账', () => {
  it('auditManifest 零 finding：permissions 三项、host 两项、action、WAR 四文件全部对上号', () => {
    const { findings } = auditManifest(manifest, REAL_FILES)
    expect(findings).toEqual([])
  })

  it('importClosure：从 loader 出发的闭包恰好是 WAR 报备的四个文件（入口自己不算——声明式注入不走网页门）', () => {
    expect(importClosure(REAL_FILES, ['src/content/loader.js'])).toEqual([
      'src/content/button-state.js',
      'src/content/main.js',
      'src/shared/badge.js',
      'src/shared/messages.js',
    ])
  })
})

describe('auditPermissions：报备了没人用算多余，用了没报备算缺失', () => {
  it('真仓代码 + 真仓 manifest：零 finding——三项权限各有 chrome.* 调用对上号', () => {
    expect(auditPermissions(manifest, Object.values(REAL_FILES).join('\n'))).toEqual([])
  })

  it('多余：permissions 里塞 "tabs"（代码从不碰 chrome.tabs）→ 指名 tabs 的多余 finding', () => {
    const planted = { ...manifest, permissions: [...(manifest.permissions ?? []), 'tabs'] }
    const findings = auditPermissions(planted, Object.values(REAL_FILES).join('\n'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('多余')
    expect(findings[0]?.item).toContain('tabs')
  })

  it('缺失：代码用 chrome.storage.session 但 manifest 不报 storage → 指名缺失', () => {
    const stripped = { ...manifest, permissions: ['webRequest', 'downloads'] }
    const findings = auditPermissions(stripped, Object.values(REAL_FILES).join('\n'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('缺失')
    expect(findings[0]?.item).toContain('storage')
  })

  it('chrome.tabs.sendMessage / chrome.runtime 不在账上：代码只有这类调用时，permissions 空着也零 finding', () => {
    const code = 'chrome.tabs.sendMessage(1, { hi: 1 })\nchrome.runtime.onMessage.addListener(() => {})'
    expect(auditPermissions({ permissions: [] }, code)).toEqual([])
  })
})

describe('patternCovers：站点权限的通配规则', () => {
  it('协议通配盖具体协议、子域通配盖子域与裸域、同模式盖同模式', () => {
    expect(patternCovers('*://*.twimg.com/*', 'https://*.twimg.com/*')).toBe(true)
    expect(patternCovers('*://*.twimg.com/*', 'https://video.twimg.com/*')).toBe(true)
    expect(patternCovers('https://x.com/*', 'https://x.com/*')).toBe(true)
  })

  it('反向盖不住：具体协议盖不住协议通配、裸域盖不住子域、别的域永远盖不住', () => {
    expect(patternCovers('https://x.com/*', '*://x.com/*')).toBe(false)
    expect(patternCovers('*://twimg.com/*', 'https://*.twimg.com/*')).toBe(false)
    expect(patternCovers('*://*.twimg.com/*', 'https://x.com/*')).toBe(false)
  })
})

describe('auditHosts：监听过滤器里的每个模式都得有权限盖住', () => {
  it('真仓：x.com 与 twimg 两个过滤器模式都被 host_permissions 盖住，零 finding', () => {
    expect(auditHosts(manifest, Object.values(REAL_FILES).join('\n'))).toEqual([])
  })

  it('缺失：过滤器出现未报备的域 → 红并指名（Chrome 72 起看不见这条流量）', () => {
    const code =
      Object.values(REAL_FILES).join('\n') +
      "\nchrome.webRequest.onBeforeRequest.addListener(fn, { urls: ['https://*.cdn.example/*'] })"
    const findings = auditHosts(manifest, code)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('缺失')
    expect(findings[0]?.item).toContain('https://*.cdn.example/*')
  })

  it('多余：多报一个盖不住任何流量的 host → 红并指名（多要的每一分站点权限都公示给用户）', () => {
    const planted = { ...manifest, host_permissions: [...(manifest.host_permissions ?? []), 'https://example.org/*'] }
    const findings = auditHosts(planted, Object.values(REAL_FILES).join('\n'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('多余')
    expect(findings[0]?.item).toContain('https://example.org/*')
  })
})

describe('auditAction：图标在册 ⇔ 代码注册', () => {
  it('真仓零 finding：manifest.action 在册，sw.js 注册 chrome.action.onClicked 指路', () => {
    expect(auditAction(manifest, Object.values(REAL_FILES).join('\n'))).toEqual([])
  })

  it('删掉 action 声明或删掉监听注册，各红一条', () => {
    const { action: _drop, ...noAction } = manifest
    expect(auditAction(noAction, Object.values(REAL_FILES).join('\n'))).toHaveLength(1)
    expect(auditAction(manifest, 'console.log("没有图标的世界")')).toHaveLength(1)
  })
})

describe('auditWar：报备清单 = 装配链 import 闭包', () => {
  it('缺失：WAR 漏掉 button-state.js → 红——页面世界里这个 import 会 404，装配模块加载失败', () => {
    const planted = {
      ...manifest,
      web_accessible_resources: [
        {
          resources: ['src/content/main.js', 'src/shared/badge.js', 'src/shared/messages.js'],
          matches: ['https://x.com/*', 'https://twitter.com/*'],
        },
      ],
    }
    const findings = auditWar(planted, REAL_FILES)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('缺失')
    expect(findings[0]?.item).toContain('button-state.js')
  })

  it('多余：WAR 多塞 loader.js → 红——声明式注入的 content script 不走网页门，塞进来是白暴露', () => {
    const planted = {
      ...manifest,
      web_accessible_resources: [
        {
          resources: [
            ...(manifest.web_accessible_resources?.[0]?.resources ?? []),
            'src/content/loader.js',
          ],
          matches: ['https://x.com/*', 'https://twitter.com/*'],
        },
      ],
    }
    const findings = auditWar(planted, REAL_FILES)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('多余')
    expect(findings[0]?.item).toContain('loader.js')
  })

  it('越界：WAR 的 matches 里出现未注入的域 → 红——门开到了没人看守的地方', () => {
    const planted = {
      ...manifest,
      web_accessible_resources: [
        {
          resources: [...(manifest.web_accessible_resources?.[0]?.resources ?? [])],
          matches: ['https://x.com/*', 'https://twitter.com/*', 'https://elsewhere.example/*'],
        },
      ],
    }
    const findings = auditWar(planted, REAL_FILES)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('越界')
    expect(findings[0]?.item).toContain('elsewhere.example')
  })
})

describe('selectZipFiles：zip 只装扩展本体', () => {
  it('manifest.json 与 src/ 放行；tests/fixtures/scripts/依赖与工程配置一律拦下', () => {
    const listing = [
      'dist/x-video-downloader.zip',
      'fixtures/media-ts.m3u8',
      'manifest.json',
      'node_modules/fflate/esm/index.mjs',
      'package.json',
      'pnpm-lock.yaml',
      'scripts/audit-rules.mjs',
      'scripts/package.mjs',
      'src/background/sw.js',
      'src/content/loader.js',
      'tests/01-mv3-anatomy.test.js',
      'tsconfig.json',
    ]
    expect(selectZipFiles(listing)).toEqual([
      'manifest.json',
      'src/background/sw.js',
      'src/content/loader.js',
    ])
  })

  it('清单里没有 manifest.json 时放行结果也不含它——商店只认 zip 根上的 manifest', () => {
    const kept = selectZipFiles(['src/shared/badge.js', 'tests/01-mv3-anatomy.test.js'])
    expect(kept).toEqual(['src/shared/badge.js'])
    expect(kept.includes('manifest.json')).toBe(false)
  })
})
