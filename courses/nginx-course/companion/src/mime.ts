const MIME_TABLE: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  js: 'application/javascript',
  mjs: 'application/javascript',
  css: 'text/css',
  json: 'application/json',
  map: 'application/json',
  txt: 'text/plain',
  xml: 'application/xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
}

export function mimeOf(pathname: string): string {
  const dot = pathname.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return MIME_TABLE[pathname.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream'
}
