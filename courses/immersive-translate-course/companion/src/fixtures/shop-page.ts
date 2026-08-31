/**
 * 商品列表页 fixture：第 7 章起测试与 demo 共用的「重复文本现场」。
 * 刻意制造本章的三种账：12 张卡片写着同一句 CTA（去重的靶子）、
 * 26 句互不相同的商品文案（打包的靶子）、整页可以原样重来一遍（缓存的靶子）。
 * 页面上没有 nav/footer/code——那些规则第 2 章已经练过，这里不掺和。
 */
export const SHOP_PAGE_HTML: string = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Summer Sale - The Daily Byte Shop</title>
</head>
<body>
  <main>
    <h1>Summer Sale: Twelve Deals</h1>
    <div class="grid">
      <div class="card">
        <h3>Maple Desk Lamp</h3>
        <p>Warm light for late-night readers.</p>
        <p class="cta">Add to cart</p>
      </div>
      <div class="card">
        <h3>Cedar Bird House</h3>
        <p>Built to survive ten winters.</p>
        <p class="cta">Add to cart</p>
      </div>
      <div class="card">
        <h3>Wool Desk Mat</h3>
        <p>Soft landing for busy hands.</p>
        <p class="cta">Add to cart</p>
      </div>
      <div class="card">
        <h3>Copper Pour Over Kettle</h3>
        <p>Slow coffee for slow mornings.</p>
        <p class="cta">Add to cart</p>
      </div>
      <div class="card">
        <h3>Linen Tote Bag</h3>
        <p>Carries more than it looks.</p>
        <p class="cta">Add to cart</p>
      </div>
      <div class="card">
        <h3>Walnut Phone Stand</h3>
        <p>Angled for lazy scrolling.</p>
        <p class="cta">Add to cart</p>
      </div>
      <div class="card">
        <h3>Glass Spice Jars</h3>
        <p>Airtight and easy to label.</p>
        <p class="cta">Add to cart</p>
      </div>
      <div class="card">
        <h3>Cotton Bath Towel</h3>
        <p>Thick enough to hide in.</p>
        <p class="cta">Add to cart</p>
      </div>
      <div class="card">
        <h3>Steel Bookends</h3>
        <p>Hold your heaviest chapters.</p>
        <p class="cta">Add to cart</p>
      </div>
      <div class="card">
        <h3>Leather Key Fob</h3>
        <p>Gets better with rain.</p>
        <p class="cta">Add to cart</p>
      </div>
      <div class="card">
        <h3>Ceramic Mug Set</h3>
        <p>Six cups, zero chips.</p>
        <p class="cta">Add to cart</p>
      </div>
      <div class="card">
        <h3>Bamboo Cutting Board</h3>
        <p>Kind to your knives.</p>
        <p class="cta">Add to cart</p>
      </div>
    </div>
  </main>
</body>
</html>
`
