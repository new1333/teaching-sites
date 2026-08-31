import { JSDOM } from 'jsdom'

/** 把 HTML 字符串解析成 jsdom 的 Document——全部测试与 demo 共用的入口。 */
export function parseHTML(html: string): Document {
  return new JSDOM(html).window.document
}
