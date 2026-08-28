// dayjs 源码的相对导入不带扩展名（面向 rollup 等打包器），locale 文件又以裸包名 'dayjs' 自引——
// 本 resolve hook：① 相对无扩展名说明符补 .js；② 裸 'dayjs' 短路映射到锁定 ref 的 src 本体。
// 探针因此直接运行仓库源码，不经任何转写。
export async function resolve(specifier, context, next) {
  if (specifier === 'dayjs') {
    return { shortCircuit: true, url: new URL('../../.course/repo/src/index.js', import.meta.url).href }
  }
  if (specifier.startsWith('.') && !/\.[cm]?js$/.test(specifier)) {
    try { return await next(`${specifier}.js`, context) } catch { /* 回退原样解析 */ }
  }
  return next(specifier, context)
}
