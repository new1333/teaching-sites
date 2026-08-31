/**
 * 新闻页 fixture：第 2 章起测试与 demo 共用的「真实页面」。
 * 刻意保留真实页面的全部麻烦——导航、按钮、页脚、脚本、独立代码块、
 * 行内 code、嵌套块（blockquote 里套 p）、侧栏、太短的日期串——
 * 抽取引擎的每条规则都能在这页上找到对应的靶子。
 */
export const NEWS_PAGE_HTML: string = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Lightweight DOM library hits version 2.0 - The Daily Byte</title>
</head>
<body>
  <header>
    <h1>The Daily Byte</h1>
    <nav>
      <a href="/">Home</a> |
      <a href="/topics">Topics</a> |
      <a href="/archive">Archive</a> |
      <a href="/about">About</a>
    </nav>
    <button type="button">Subscribe</button>
  </header>
  <main>
    <article>
      <h2>Lightweight DOM library hits version 2.0</h2>
      <p class="byline">By Jane Doe</p>
      <p class="date">Nov 8</p>
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
    </article>
    <div class="sidebar">
      <h3>Trending</h3>
      <ul>
        <li><a href="/css">CSS tricks you forgot</a></li>
        <li><a href="/rss">The quiet return of RSS</a></li>
      </ul>
    </div>
  </main>
  <footer>
    <p>© 2024 The Daily Byte. All rights reserved.</p>
    <a href="/privacy">Privacy</a>
  </footer>
  <script>window.__data = { userId: 42 };</script>
</body>
</html>
`
