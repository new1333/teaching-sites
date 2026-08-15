export interface UpstreamServer {
  host: string
  weight?: number
  down?: boolean
}

export interface Upstream {
  servers: UpstreamServer[]
}

export interface MatchRule {
  /** '=' 精确 | '^~' 阻断正则的前缀 | '~' 大小写敏感正则 | '~*' 大小写不敏感正则 | 'prefix' 普通前缀 */
  type: '=' | '^~' | '~' | '~*' | 'prefix'
  path: string
}

/** expires 指令的语义化形态：强缓存策略或 no-cache 协商模式 */
export type ExpiresPolicy = { maxAge: number; immutable?: boolean } | 'no-cache'

export interface CorsOptions {
  /** 允许的源（Access-Control-Allow-Origin 的值） */
  origin: string
  /** 允许的方法列表，默认 "GET, HEAD, POST" */
  methods?: string
  /** 允许的请求头，默认透传客户端声明的 Access-Control-Request-Headers */
  allowHeaders?: string
}

export interface LocationBlock {
  match: MatchRule
  /** 该块内的文档根目录，nginx 语义：最终路径 = root + 完整 URI */
  root?: string
  index?: string
  try_files?: string[]
  proxy_pass?: string
  /** 覆盖转发的请求头（Host / X-Real-IP 等），nginx 的 proxy_set_header */
  proxy_set_header?: Record<string, string>
  expires?: ExpiresPolicy
  /** 默认 true：输出 ETag 支持 If-None-Match 协商缓存 */
  etag?: boolean
  /** 追加响应头；一旦声明，父块的 add_header 整体不再继承（nginx 语义） */
  add_header?: Record<string, string>
  cors?: CorsOptions
}

export interface GzipOptions {
  /** 参与压缩的 Content-Type 白名单，默认文本类（html/css/js/json/svg/plain） */
  types?: string[]
  /** 小于该字节数的响应不压缩（gzip 头本身有 ~20 字节开销） */
  minLength?: number
}

export interface ServerBlock {
  root?: string
  gzip?: GzipOptions
  add_header?: Record<string, string>
  locations?: LocationBlock[]
}

export interface MiniNginxConfig {
  upstreams?: Record<string, Upstream>
  server: ServerBlock
}

export interface ListenInfo {
  port: number
  url: string
}

export interface MiniNginxServer {
  listen(port?: number): Promise<ListenInfo>
  close(): Promise<void>
}
