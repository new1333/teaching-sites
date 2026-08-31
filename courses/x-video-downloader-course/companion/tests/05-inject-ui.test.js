// tests/05-inject-ui.test.js —— 第 5 章：把按钮放上推文（SPA 世界的 DOM 注入）
// 断言四组事：消息协议成立——MSG 常量表是两个世界共用的唯一类型事实源，两个守卫只放形状合法的消息
// 进门（第 4 章的裸字符串消息在这里升级成正式协议），二进制过通道必须先编码（通道默认 JSON 序列化，
// ArrayBuffer 直递到达就是 {}——反例当场证伪）；按钮状态机成立——正程五态按表迁移、失败态三路
// 可达、非法迁移当场抛错（消息乱序、迟到、伪造在这里现形），statusIdFromUrl 提取推文身份证，
// findVideoTweetRoots 用 data-testid 锚点只挑含视频的推文；manifest 报备本章新要的能力
// （storage 权限 + web_accessible_resources 恰好放开装配模块、只对 X 两域放开）。
// DOM 与消息一律以最小假件从参数注入——不碰真实页面、不碰网络、不 sleep。

import { describe, it, expect } from 'vitest'
import manifest from '../manifest.json'
import {
  MSG,
  isDownloadRequest,
  isProgressPayload,
  encodeBytes,
  decodeBytes,
} from '../src/shared/messages.js'
import { nextButtonState, statusIdFromUrl, findVideoTweetRoots } from '../src/content/button-state.js'

describe('messages：常量表与守卫', () => {
  it('MSG 四个类型互不相等、都以 xvd- 开头——类型只有这一张事实源', () => {
    const types = [
      MSG.DOWNLOAD_REQUEST,
      MSG.DOWNLOAD_PROGRESS,
      MSG.DOWNLOAD_DONE,
      MSG.DOWNLOAD_ERROR,
    ]
    expect(new Set(types).size).toBe(4)
    for (const t of types) expect(t.startsWith('xvd-')).toBe(true)
  })

  it('isDownloadRequest：type 与非空字符串 statusId 都在场才放行', () => {
    expect(isDownloadRequest({ type: MSG.DOWNLOAD_REQUEST, statusId: '1740000000000000000' })).toBe(true)
    expect(isDownloadRequest({ type: MSG.DOWNLOAD_REQUEST, statusId: '1' })).toBe(true)
  })

  it('isDownloadRequest：缺 statusId、statusId 非字符串、type 不符、根本不是对象——一律拒收', () => {
    expect(isDownloadRequest({ type: MSG.DOWNLOAD_REQUEST })).toBe(false)
    expect(isDownloadRequest({ type: MSG.DOWNLOAD_REQUEST, statusId: 123 })).toBe(false)
    expect(isDownloadRequest({ type: MSG.DOWNLOAD_DONE, statusId: '1' })).toBe(false)
    expect(isDownloadRequest(null)).toBe(false)
    expect(isDownloadRequest('xvd-download-request')).toBe(false)
    expect(isDownloadRequest(42)).toBe(false)
  })

  it('isProgressPayload：done/total 是非负整数、done ≤ total、total ≥ 1 才放行（statusId 路由字段不碍事）', () => {
    expect(isProgressPayload({ type: MSG.DOWNLOAD_PROGRESS, statusId: '1', done: 0, total: 12 })).toBe(true)
    expect(isProgressPayload({ type: MSG.DOWNLOAD_PROGRESS, done: 12, total: 12 })).toBe(true)
  })

  it('isProgressPayload：越界、负数、非整数、total 为 0、type 不符、不是对象——一律拒收', () => {
    expect(isProgressPayload({ type: MSG.DOWNLOAD_PROGRESS, done: 13, total: 12 })).toBe(false)
    expect(isProgressPayload({ type: MSG.DOWNLOAD_PROGRESS, done: -1, total: 12 })).toBe(false)
    expect(isProgressPayload({ type: MSG.DOWNLOAD_PROGRESS, done: 1.5, total: 12 })).toBe(false)
    expect(isProgressPayload({ type: MSG.DOWNLOAD_PROGRESS, done: 0, total: 0 })).toBe(false)
    expect(isProgressPayload({ type: MSG.DOWNLOAD_DONE, done: 1, total: 2 })).toBe(false)
    expect(isProgressPayload(null)).toBe(false)
  })
})

describe('messages：二进制过通道——JSON 序列化只认能 stringify 的值', () => {
  /** 确定性的假字节串：不用随机数，两次运行完全一致 */
  function fakeBytes(n) {
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) out[i] = (i * 31 + 7) % 256
    return out
  }

  it('反例当场证伪：ArrayBuffer 直接过 JSON 通道，到达就是空对象——不编码就是静默丢数据', () => {
    // JSON.parse(JSON.stringify(...)) 是 Chrome 消息通道 JSON 序列化的最小等价物
    const through = JSON.parse(JSON.stringify({ bytes: fakeBytes(3).buffer }))
    expect(through).toEqual({ bytes: {} })
  })

  it('encodeBytes 产出 base64 字符串，JSON 往返无损；空字节串编码为空字符串', () => {
    expect(encodeBytes(new Uint8Array([1, 2, 3]))).toBe('AQID')
    const b64 = encodeBytes(fakeBytes(5))
    expect(JSON.parse(JSON.stringify({ bytesB64: b64 }))).toEqual({ bytesB64: b64 })
    expect(encodeBytes(new Uint8Array(0))).toBe('')
  })

  it('decodeBytes(encodeBytes(x)) 还原同一串字节——含 0/255 边界与跨块长度（49151/49152/49153）', () => {
    for (const n of [2, 49151, 49152, 49153]) {
      const bytes = fakeBytes(n)
      bytes[0] = 0
      bytes[n - 1] = 255
      const back = decodeBytes(encodeBytes(bytes))
      expect(back.length).toBe(n)
      expect(back[0]).toBe(0)
      expect(back[n - 1]).toBe(255)
      expect(Array.from(back.slice(1, 40))).toEqual(Array.from(bytes.slice(1, 40)))
    }
    expect(decodeBytes('').length).toBe(0)
  })
})

describe('button-state：五态状态机', () => {
  it('正程全链：idle --click--> detecting --ack--> ready --progress--> downloading --done--> done', () => {
    /** @type {import('../src/content/button-state.js').ButtonState} */
    let s = 'idle'
    s = nextButtonState(s, 'click')
    expect(s).toBe('detecting')
    s = nextButtonState(s, 'ack')
    expect(s).toBe('ready')
    s = nextButtonState(s, 'progress')
    expect(s).toBe('downloading')
    s = nextButtonState(s, 'progress') // 后续分片：留在原地，进度只更新文案不换状态
    expect(s).toBe('downloading')
    s = nextButtonState(s, 'done')
    expect(s).toBe('done')
  })

  it('mp4 直链没有分片进度：ready --done--> done 一步到位', () => {
    expect(nextButtonState('ready', 'done')).toBe('done')
  })

  it('失败三路都能进 error；error 吃 click 重试回 detecting', () => {
    expect(nextButtonState('detecting', 'fail')).toBe('error')
    expect(nextButtonState('ready', 'fail')).toBe('error')
    expect(nextButtonState('downloading', 'fail')).toBe('error')
    expect(nextButtonState('error', 'click')).toBe('detecting')
  })

  it('忙碌中重复点击被吸收：detecting/ready/downloading 吃 click 原地不动，done 吃 click 不返工', () => {
    expect(nextButtonState('detecting', 'click')).toBe('detecting')
    expect(nextButtonState('ready', 'click')).toBe('ready')
    expect(nextButtonState('downloading', 'click')).toBe('downloading')
    expect(nextButtonState('done', 'click')).toBe('done')
  })

  it('表里没有的组合是非法迁移：抛 Error 点名是谁——乱序、迟到、伪造的消息在这里现形', () => {
    expect(() => nextButtonState('idle', 'ack')).toThrow() // 没发过请求，哪来的回执
    expect(() => nextButtonState('idle', 'done')).toThrow()
    expect(() => nextButtonState('detecting', 'progress')).toThrow() // 还没对上号就来进度
    expect(() => nextButtonState('done', 'progress')).toThrow() // 完成后又冒出进度
    const unknownEvent = /** @type {any} */ ('zzz') // 装成「编译期不认识」的事件——状态机还得在运行期把它拦下来
    expect(() => nextButtonState('idle', unknownEvent)).toThrow()
    const unknownState = /** @type {any} */ ('limbo')
    expect(() => nextButtonState(unknownState, 'click')).toThrow() // 不认识的状态
  })
})

describe('button-state：推文身份证', () => {
  it('statusIdFromUrl：/status/ 后面的数字串提出来——photo 后缀、query 参数、twitter.com 域都不碍事', () => {
    expect(statusIdFromUrl('https://x.com/somebody/status/1740000000000000000')).toBe('1740000000000000000')
    expect(statusIdFromUrl('https://x.com/somebody/status/1740000000000000000/photo/1')).toBe('1740000000000000000')
    expect(statusIdFromUrl('https://twitter.com/somebody/status/1740000000000000000?s=20')).toBe('1740000000000000000')
  })

  it('statusIdFromUrl：不是状态页、id 不是数字、URL 解析不了——返回 null，不抛错', () => {
    expect(statusIdFromUrl('https://x.com/home')).toBeNull()
    expect(statusIdFromUrl('https://x.com/somebody/status/abc')).toBeNull()
    expect(statusIdFromUrl('/somebody/status/1740000000000000000')).toBeNull() // 相对地址先归一（badge.tweetLinkFrom 的活）
    expect(statusIdFromUrl('not a url')).toBeNull()
  })
})

describe('button-state：找含视频的推文', () => {
  /** 造一个假推文根：videoHere 决定它内部有没有 <video> */
  function fakeTweet(videoHere) {
    return {
      querySelector: (sel) => (sel === 'video' ? (videoHere ? { tagName: 'VIDEO' } : null) : null),
    }
  }

  it('默认锚 article[data-testid="tweet"]：只挑内部有 video 的，纯文字推文不进单', () => {
    const videoTweet = fakeTweet(true)
    const textTweet = fakeTweet(false)
    const root = {
      querySelectorAll: (sel) => (sel === 'article[data-testid="tweet"]' ? [videoTweet, textTweet] : []),
    }
    expect(findVideoTweetRoots(root)).toEqual([videoTweet])
  })

  it('选择器可传入覆盖：X 改锚点名时改这一处；没有匹配返回空数组', () => {
    const root = {
      querySelectorAll: (sel) => (sel === 'div[data-thing="post"]' ? [fakeTweet(true)] : []),
    }
    expect(findVideoTweetRoots(root, 'div[data-thing="post"]')).toHaveLength(1)
    expect(findVideoTweetRoots({ querySelectorAll: () => [] })).toEqual([])
  })
})

describe('manifest：本章新要的能力报备', () => {
  it('permissions 含 storage：storage.session 的钥匙——对号账本要活过 SW 休眠', () => {
    expect(manifest.permissions).toContain('storage')
  })

  it('web_accessible_resources 恰好放开装配模块四个文件，且只对 X 两域放开；loader.js 本身不用放开', () => {
    const war = manifest.web_accessible_resources?.[0]
    expect(war?.resources).toContain('src/content/main.js')
    expect(war?.resources).toContain('src/content/button-state.js')
    expect(war?.resources).toContain('src/shared/badge.js')
    expect(war?.resources).toContain('src/shared/messages.js')
    expect(war?.resources).not.toContain('src/content/loader.js') // 声明式注入的 content script 不走网页门
    expect(war?.matches).toEqual(['https://x.com/*', 'https://twitter.com/*'])
  })
})
