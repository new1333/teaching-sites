// src/authority.ts —— host:port 权威部分解析 + HTTP absolute-form → origin-form 改写
// 覆盖 IPv4、域名、以及 [::1]:8080 这种带方括号的 IPv6 写法。

import net from 'node:net'
import type { TargetAddress } from './types.js'

export interface Authority {
  readonly host: string
  readonly port: number
}

/** 判断一个裸主机字符串（不含端口、IPv6 已去括号）属于哪种地址族。*/
export function classifyHost(host: string): 'ipv4' | 'ipv6' | 'domain' {
  const version = net.isIP(host)
  if (version === 4) return 'ipv4'
  if (version === 6) return 'ipv6'
  return 'domain'
}

export function toTargetAddress(host: string, port: number): TargetAddress {
  const kind = classifyHost(host)
  return { kind, host, port }
}

/**
 * 解析 "host:port" / "[ipv6]:port" / "host"（无端口，用 defaultPort 补齐）。
 * 非法输入（端口越界、空主机）返回 null。
 */
export function parseAuthority(raw: string, defaultPort: number): Authority | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  if (trimmed.startsWith('[')) {
    const closeIdx = trimmed.indexOf(']')
    if (closeIdx < 0) return null
    const host = trimmed.slice(1, closeIdx)
    if (net.isIP(host) !== 6) return null
    const rest = trimmed.slice(closeIdx + 1)
    if (rest.length === 0) return { host, port: defaultPort }
    if (!rest.startsWith(':')) return null
    const port = parsePort(rest.slice(1))
    if (port === null) return null
    return { host, port }
  }

  // 裸 IPv6（无括号）不带端口是合法写法（域名/IPv4 同理），此时全冒号都属于地址本身
  if (net.isIP(trimmed) === 6) return { host: trimmed, port: defaultPort }

  const lastColon = trimmed.lastIndexOf(':')
  if (lastColon < 0) return { host: trimmed, port: defaultPort }

  const host = trimmed.slice(0, lastColon)
  const portRaw = trimmed.slice(lastColon + 1)
  if (host.length === 0) return null
  const port = parsePort(portRaw)
  if (port === null) return null
  return { host, port }
}

function parsePort(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const port = Number(raw)
  if (port < 1 || port > 65535) return null
  return port
}

export interface RequestLine {
  readonly method: string
  readonly target: string
  readonly version: string
}

/** 拆分请求行 "METHOD target HTTP/x.y"；格式不对返回 null。 */
export function parseRequestLine(line: string): RequestLine | null {
  const match = /^(\S+) (\S+) (HTTP\/\d\.\d)$/.exec(line.replace(/\r$/, ''))
  if (!match) return null
  const method = match[1]
  const target = match[2]
  const version = match[3]
  if (method === undefined || target === undefined || version === undefined) return null
  return { method, target, version }
}

export interface AbsoluteFormRewrite {
  readonly requestLine: string
  readonly authority: Authority
  /** 改写后应当写入/覆盖的 Host 头取值 */
  readonly hostHeaderValue: string
}

/**
 * 把 absolute-form 请求行（GET http://host:port/path HTTP/1.1）改写为 origin-form
 * （GET /path HTTP/1.1），同时给出目标 host/port，供 Host 头改写与拨号使用。
 * 输入已经是 origin-form（target 以 '/' 开头）或者不是 http(s) 绝对 URL 时返回 null。
 */
export function rewriteAbsoluteForm(line: RequestLine): AbsoluteFormRewrite | null {
  if (line.target.startsWith('/')) return null
  let url: URL
  try {
    url = new URL(line.target)
  } catch {
    return null
  }
  if (url.protocol !== 'http:') return null

  const defaultPort = 80
  const portRaw = url.port === '' ? defaultPort : Number(url.port)
  const origin = `${url.pathname}${url.search}` || '/'
  const requestLine = `${line.method} ${origin} ${line.version}`
  // URL.hostname 对 IPv6 会带方括号（如 "[::1]"）；Host 头要保留方括号，
  // 但 authority.host 是给拨号器/规则引擎用的裸地址，必须去掉方括号。
  const bareHost = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  const hostHeaderValue = url.port === '' ? url.hostname : `${url.hostname}:${url.port}`
  return {
    requestLine,
    authority: { host: bareHost, port: portRaw },
    hostHeaderValue,
  }
}
