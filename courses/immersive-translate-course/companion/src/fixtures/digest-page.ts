/**
 * 链接摘要页 fixture：整页正文住在链接里的版面——目录型、摘要型内容的极形。
 * 它是第 6 章启发式的「会认错」现场：链接密度把真正的正文当成了导航，
 * 测试如实断言认错的结果，不粉饰启发式的边界。
 */
export const DIGEST_PAGE_HTML: string = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>This week in DOM - The Link Digest</title>
</head>
<body>
  <div class="digest">
    <h2>This week in DOM</h2>
    <ul>
      <li><a href="/bundle">How we shaved our bundle down to three kilobytes, and what it cost us in maintainability</a></li>
      <li><a href="/rss">The quiet return of RSS: why independent publishing is climbing again</a></li>
      <li><a href="/qs">A love letter to querySelector, twenty years of finding things in the tree</a></li>
    </ul>
  </div>
  <div class="promo">
    <p>Subscribe to the weekly digest and get handpicked links in your inbox every Friday morning.</p>
    <p>We read two hundred feeds so that you do not have to read any of them.</p>
    <p>One click to unsubscribe at any time, no hard feelings whatsoever.</p>
  </div>
</body>
</html>
`
