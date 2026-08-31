// scripts/audit-rules.mjs —— manifest 权限核对的规则表与纯函数（CLI 与测试共用；不含任何 I/O）
// 第 6 章的验证物：商店审核会问「这个权限凭什么」，上架前先被自己的脚本问一遍。
// 每条规则双向对账——报备了没人用算「多余」（过度索权），用了没报备算「缺失」（运行时被拒）。
// 纯逻辑全部住在这里：audit-manifest.mjs 负责读文件与打印，测试直接喂 fixture manifest 与源码文本。

/** 核对结论里的一条 @typedef {{ kind: '多余' | '缺失' | '越界', item: string, detail: string }} Finding */

/**
 * permissions 逐项账：manifest 里报备的每个 API 权限，都必须对上代码里真实的 chrome.* 调用。
 * probe 是代码证据探针——在 src/ 全部源码拼成的文本里找不到匹配，这项权限就答不上「凭什么」
 * @type {Record<string, { chapter: number, why: string, probe: RegExp }>}
 */
export const PERMISSION_LEDGER = {
  webRequest: {
    chapter: 2,
    why: '被动监听视频请求：onBeforeRequest 只观察不拦改（MV3 里 webRequest 只剩这种用法）',
    probe: /chrome\.webRequest\./,
  },
  downloads: {
    chapter: 4,
    why: 'chrome.downloads.download 落盘 mp4 直链',
    probe: /chrome\.downloads\./,
  },
  storage: {
    chapter: 5,
    why: 'storage.session 对号账本——SW 休眠不死、浏览器重启才清',
    probe: /chrome\.storage\./,
  },
}

/**
 * host_permissions 逐项账：why 给人读（覆盖哪个流量、豁免哪条跨域）；
 * 机械证据由 auditHosts 另行核验——每个模式必须盖得住代码里出现过的监听过滤器
 * @type {Record<string, { chapter: number, why: string }>}
 */
export const HOST_LEDGER = {
  'https://x.com/*': {
    chapter: 2,
    why: '请求的发起方在 x.com——Chrome 72 起要同时握住目标站与发起方才看得见流量',
  },
  '*://*.twimg.com/*': {
    chapter: 2,
    why: '视频真身在 twimg：监听目标站，也是 SW fetch 抓清单/分片的跨域豁免依据（协议放宽一档，域不放宽）',
  },
}

/**
 * 把「<scheme>://<host>/<path>」形态的匹配模式拆成三段里的前两段。
 * 拆不动（如 <all_urls>、file:///）返回 null——那类形态本课用不到，交给人工核对
 * @param {string} pattern
 * @returns {{ scheme: string, host: string } | null}
 */
export function parsePattern(pattern) {
  const m = /^(\*|https?):\/\/([^/]+)\//.exec(pattern)
  return m === null ? null : { scheme: m[1], host: m[2] }
}

/**
 * 宽模式能否盖住窄模式。scheme：'*' 吃任何具体协议，具体协议吃不了 '*'；
 * host：相等，或宽端 '*.domain' 形态吃窄端的裸域与子域；路径不参与——host_permissions 里路径本就被忽略
 * @param {string} wide
 * @param {string} narrow
 * @returns {boolean}
 */
export function patternCovers(wide, narrow) {
  const w = parsePattern(wide)
  const n = parsePattern(narrow)
  if (w === null || n === null) return wide === narrow
  if (w.scheme !== '*' && w.scheme !== n.scheme) return false
  return hostCovers(w.host, n.host)
}

/** host 段的覆盖判定：通配只认 '*.domain' 前缀形态（匹配模式语法本就只允许这一种） */
function hostCovers(wide, narrow) {
  if (wide === narrow) return true
  if (wide.startsWith('*.')) {
    const base = wide.slice(2)
    if (narrow.startsWith('*.')) return narrow.slice(2) === base
    return narrow === base || narrow.endsWith('.' + base)
  }
  return false
}

/**
 * permissions 对账：manifest 报备的每项必须有代码证据；代码碰过的账内 API 必须已报备。
 * 账外命名空间（chrome.tabs / chrome.runtime / chrome.action 这类不需要 permissions 的调用）不算账
 * @param {Record<string, unknown> & { permissions?: string[] }} manifest
 * @param {string} code src/ 全部源码拼成的文本
 * @returns {Finding[]}
 */
export function auditPermissions(manifest, code) {
  const findings = []
  const declared = manifest.permissions ?? []
  for (const p of declared) {
    const ledger = PERMISSION_LEDGER[p]
    if (ledger === undefined) {
      findings.push({
        kind: '多余',
        item: `permissions: ${p}`,
        detail: '规则表里没有它的用途账——要么补账，要么删掉',
      })
      continue
    }
    if (!ledger.probe.test(code)) {
      findings.push({
        kind: '多余',
        item: `permissions: ${p}`,
        detail: `报备了但代码不碰 chrome.${p}——商店审核问「凭什么」时答不上`,
      })
    }
  }
  for (const [api, ledger] of Object.entries(PERMISSION_LEDGER)) {
    if (ledger.probe.test(code) && !declared.includes(api)) {
      findings.push({
        kind: '缺失',
        item: `permissions: ${api}`,
        detail: `${ledger.why}——用了没报备，运行时直接被拒`,
      })
    }
  }
  return findings
}

/**
 * 从代码文本里抠出 webRequest 监听过滤器的全部 URL 模式（urls: ['…', '…'] 里的引号串）
 * @param {string} code
 * @returns {string[]}
 */
export function filterPatternsOf(code) {
  const out = new Set()
  for (const bracket of code.matchAll(/urls:\s*\[([^\]]*)\]/g)) {
    for (const quoted of bracket[1].matchAll(/['"]([^'"]+)['"]/g)) out.add(quoted[1])
  }
  return [...out]
}

/**
 * host_permissions 对账：监听过滤器里的每个模式都必须有权限盖住（Chrome 72 的两站规则落在过滤器侧）；
 * 盖不住任何流量的模式算多余——多要的每一分站点权限都会公示在商店页面
 * @param {Record<string, unknown> & { host_permissions?: string[] }} manifest
 * @param {string} code
 * @returns {Finding[]}
 */
export function auditHosts(manifest, code) {
  const findings = []
  const declared = manifest.host_permissions ?? []
  const filters = filterPatternsOf(code).filter((p) => parsePattern(p) !== null)
  for (const f of filters) {
    if (!declared.some((h) => patternCovers(h, f))) {
      findings.push({
        kind: '缺失',
        item: `host_permissions: ${f}`,
        detail: '监听过滤器里有它、权限里没有——Chrome 72 起看不见这条流量',
      })
    }
  }
  for (const h of declared) {
    if (!filters.some((f) => patternCovers(h, f))) {
      findings.push({
        kind: '多余',
        item: `host_permissions: ${h}`,
        detail: '盖不住代码里出现过的任何流量——商店页面照样公示它',
      })
    }
  }
  return findings
}

/**
 * action 对账：manifest 声明与代码注册互为充要。
 * 声明了不注册是工具栏挂死图标；注册了不声明连图标都不出现
 * @param {Record<string, unknown> & { action?: unknown }} manifest
 * @param {string} code
 * @returns {Finding[]}
 */
export function auditAction(manifest, code) {
  const declared = manifest.action !== undefined
  const used = /chrome\.action\./.test(code)
  if (used && !declared) {
    return [{ kind: '缺失', item: 'action', detail: '代码注册了 chrome.action 监听，manifest 没声明——图标不出现' }]
  }
  if (declared && !used) {
    return [{ kind: '多余', item: 'action', detail: 'manifest 声明了 action，代码从不碰它——工具栏挂了个死图标' }]
  }
  return []
}

/** 一份源码 import 了哪些文件：静态 from '…'（语句可跨行）与动态 chrome.runtime.getURL('…') 都算边 */
function importEdges(text, fromPath) {
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : ''
  const out = new Set()
  for (const m of text.matchAll(/chrome\.runtime\.getURL\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.add(m[1]) // getURL 括号里已经是相对扩展根的地址，原样入账
  }
  for (const m of text.matchAll(/(^|\n)import\s[^;]*?from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[2]
    if (!spec.startsWith('./') && !spec.startsWith('../')) continue // 裸包名（本仓没有）不算文件边
    out.add(resolveRelative(dir, spec))
  }
  return [...out]
}

/** 把 './x.js'、'../y/z.js' 解析成相对扩展根的路径（以 '/' 分隔，不走 node:path——纯函数零依赖） */
function resolveRelative(dir, spec) {
  const stack = dir === '' ? [] : dir.split('/')
  for (const part of spec.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

/**
 * 从 content_scripts 入口出发算 import 闭包：loader 的动态 getURL import、模块的静态 import 都算边。
 * 返回「被 import 拉进来的全部文件」——入口本身不算（声明式注入不走网页门，不需要报备）
 * @param {Record<string, string>} files 相对扩展根的路径 → 源码文本
 * @param {string[]} entries content_scripts[].js 入口清单
 * @returns {string[]}
 */
export function importClosure(files, entries) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length > 0) {
    const cur = /** @type {string} */ (queue.shift())
    if (seen.has(cur) || !(cur in files)) continue
    seen.add(cur)
    queue.push(...importEdges(files[cur], cur))
  }
  for (const e of entries) seen.delete(e)
  return [...seen].sort()
}

/**
 * web_accessible_resources 对账：报备清单必须恰好等于装配链的 import 闭包。
 * 缺一项页面世界里 import 404、装配模块加载失败；多一项是白暴露（网页能借此探测扩展）；
 * matches 超出 content_scripts 注入范围算越界——门开到了没人看守的地方
 * @param {{ content_scripts?: { js?: string[], matches?: string[] }[], web_accessible_resources?: { resources?: string[], matches?: string[] }[] }} manifest
 * @param {Record<string, string>} files
 * @returns {Finding[]}
 */
export function auditWar(manifest, files) {
  const findings = []
  const injectMatches = (manifest.content_scripts ?? []).flatMap((cs) => cs.matches ?? [])
  const entries = (manifest.content_scripts ?? []).flatMap((cs) => cs.js ?? [])
  const needed = importClosure(files, entries)
  const granted = (manifest.web_accessible_resources ?? []).flatMap((w) => w.resources ?? [])
  for (const res of needed) {
    if (!granted.includes(res)) {
      findings.push({
        kind: '缺失',
        item: `web_accessible_resources: ${res}`,
        detail: '装配链 import 了它但没报备——页面世界里 404，模块加载失败',
      })
    }
  }
  for (const res of granted) {
    if (!needed.includes(res)) {
      findings.push({
        kind: '多余',
        item: `web_accessible_resources: ${res}`,
        detail: '没人 import 它——网页多探得到一个扩展文件，白暴露',
      })
    }
  }
  for (const w of manifest.web_accessible_resources ?? []) {
    for (const m of w.matches ?? []) {
      if (!injectMatches.includes(m)) {
        findings.push({
          kind: '越界',
          item: `web_accessible_resources matches: ${m}`,
          detail: '这个域不在 content_scripts 注入范围里——门开到了没人看守的地方',
        })
      }
    }
  }
  return findings
}

/**
 * 全家桶：四条规则一起跑。files 传 src/ 全部源码（路径 → 文本），
 * code 由本函数内部拼出——permissions/host/action 的证据是「代码里有没有」，
 * WAR 的证据是「装配链闭包长什么样」
 * @param {{ permissions?: string[], host_permissions?: string[], action?: unknown, content_scripts?: { js?: string[], matches?: string[] }[], web_accessible_resources?: { resources?: string[], matches?: string[] }[] }} manifest
 * @param {Record<string, string>} files
 * @returns {{ findings: Finding[], checked: number }}
 */
export function auditManifest(manifest, files) {
  const code = Object.values(files).join('\n')
  const findings = [
    ...auditPermissions(manifest, code),
    ...auditHosts(manifest, code),
    ...auditAction(manifest, code),
    ...auditWar(manifest, files),
  ]
  const checked =
    (manifest.permissions ?? []).length +
    (manifest.host_permissions ?? []).length +
    (manifest.action !== undefined ? 1 : 0) +
    (manifest.web_accessible_resources ?? []).reduce((n, w) => n + (w.resources ?? []).length, 0)
  return { findings, checked }
}

/**
 * 打包文件清单的取舍规则：扩展本体只有 manifest.json 与 src/。
 * 测试、fixture、脚本、依赖、构建产物、工程配置一律进不了 zip——商店上传的是扩展，不是工程
 * @param {string[]} paths companion 根下的全部相对路径（'/' 分隔）
 * @returns {string[]}
 */
export function selectZipFiles(paths) {
  return paths.filter((p) => p === 'manifest.json' || p.startsWith('src/'))
}
