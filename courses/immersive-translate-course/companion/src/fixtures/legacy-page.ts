/**
 * 老版面 fixture：同一篇新闻，换掉全部语义标签的 div 汤——main/article 一个都没有。
 * 专测第 6 章的密度兜底路径：没有地标可认时，靠文字密度与链接密度照样认出正文。
 * 文章内容与 news-page 逐字相同，好让两条路径走到同一篇文章、对照同一个账本。
 */
export const LEGACY_PAGE_HTML: string = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Lightweight DOM library hits version 2.0 - The Daily Byte (legacy layout)</title>
</head>
<body>
  <div id="page">
    <div id="top">
      <div class="brand">The Daily Byte</div>
      <a href="/">Home</a> |
      <a href="/topics">Topics</a> |
      <a href="/archive">Archive</a> |
      <a href="/about">About</a>
      <button type="button">Subscribe</button>
    </div>
    <div id="content">
      <h2>Lightweight DOM library hits version 2.0</h2>
      <p class="byline">By Jane Doe</p>
      <p>The library, famous for its three-kilobyte bundle, now ships with a plugin system. Its author says the rewrite took eighteen months and eleven broken prototypes.</p>
      <p>Early users report <strong>significant speedups</strong> in tree-heavy workloads, though some miss the simpler old API.</p>
      <pre><code>npm install quickdom@2</code></pre>
      <p>To try it, add one script tag to your page and call <code>mount()</code> on any element.</p>
      <blockquote>
        <p>The fastest DOM is the one you never touch.</p>
      </blockquote>
      <h3>What is next</h3>
      <ul>
        <li>Server-side rendering support</li>
        <li>Better TypeScript types, generated from the source</li>
        <li>A new logo, at last</li>
      </ul>
    </div>
    <div id="side">
      <h4>Trending</h4>
      <ul>
        <li><a href="/css">CSS tricks you forgot</a></li>
        <li><a href="/rss">The quiet return of RSS</a></li>
      </ul>
    </div>
    <div id="foot">
      <p>© 2024 The Daily Byte. All rights reserved.</p>
      <a href="/privacy">Privacy</a>
    </div>
  </div>
  <script>window.__legacy = true;</script>
</body>
</html>
`
