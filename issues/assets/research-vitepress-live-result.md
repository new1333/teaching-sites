# VitePress「读者可实时看到/听到/玩到运行结果」机制调研

- 调研日期:2026-08-17
- 版本语境:VitePress 1.x(锁定 ^1.6.4,当前最新 1.6.4,已用 npm 核实);不采用 2.0 alpha
- 部署语境:单课独立跑 base=`/`,聚合站下 base=`/{课程名}/`
- 结论速览:默认机制推荐「skill 内置一套全局演示组件(构建期打包运行,零外部依赖)+ public/ 静态产物兜底 + 外部 playground 仅作外链」

---

## 一、方案对比表

| # | 方案 | 依赖 | 交互能力 | 维护成本 | base 兼容风险 | 适用课程形态 |
|---|------|------|----------|----------|---------------|--------------|
| A | 静态产物(PNG/GIF/MP3 放 `public/`,markdown 直接引用) | 无 | 无(只看/听,不可玩) | 极低 | 低(官方自动处理,见 §3.4) | 所有形态的兜底;纯 CLI/纯配置类的主力 |
| B | markdown 内直接写 `<script setup>` + `onMounted` 跑浏览器 API | 无(官方原生) | 高(实时渲染/发声/交互) | 低 | 中(组件内手写资源路径必须 `withBase`) | 一次性、页面局部的小演示 |
| C | skill 生成可复用全局演示组件(`<demo-canvas>`/`<demo-audio>` 等,`enhanceApp` 注册) | 无(官方机制) | 高 | 中(一次性投入,之后每课复用) | 低(统一在组件内 `withBase`) | 长期主力:渲染像素、播放音频、跑交互逻辑 |
| D | 自包含 demo HTML 放 `public/`,iframe 嵌入 | 无 | 最高(完全自由的沙箱页面,可"玩") | 中 | 中(iframe `src` 必须 `withBase`,相对路径会被路由深度弄坏,见 §3.5) | 需要键盘/手柄输入、多文件的"玩到"场景(如模拟器) |
| E | 嵌 `@vue/repl`(Vue 官方 REPL 组件,浏览器内编译) | `@vue/repl`(活跃,npm 4.7.2 / 2026-04) | 高(可编辑代码 + 实时预览) | 中高 | 低(运行时自包含,CDN 加载编译器有网络依赖) | 教 Vue 本身或"改代码看效果"的课程 |
| F | 嵌 Sandpack 自托管运行时 | `@codesandbox/sandpack-react` | 高(可编辑 + npm 依赖预览) | 高(bundler 需自托管才无外域依赖) | 低(iframe 运行时自托管) | 需要 npm 生态依赖的通用 playground |
| G | iframe 嵌外部 playground(TS Playground / StackBlitz / CodeSandbox / CodePen) | 无构建依赖,运行时依赖外部域名 | 高 | 低 | 无 base 风险(绝对 https URL),但有可用性风险(见 §3.6) | 不建议内嵌;仅作"点出去练"的链接 |
| H | 外部 playground 仅作超链接(不嵌 iframe) | 无 | 无(跳走) | 极低 | 无 | 纯链接版 G;TS Playground 分享链接(代码压缩进 URL hash)零维护成本 |

---

## 二、调研发现(按问题逐条)

### 2.1 官方自定义组件机制

- **markdown 即 Vue SFC**:官方文档 "each Markdown file is compiled into HTML and then processed as a Vue Single-File Component"。markdown 里可以直接写 `<script setup>`、`<style>`,这就是交互 demo 的最小形态(B 方案)——不需要任何插件。
  来源:https://vitepress.dev/guide/using-vue
- **组件注册**:按页 `import` 用一次;常用组件在 `.vitepress/theme/index.ts` 的 `enhanceApp({ app })` 里 `app.component('DemoCanvas', DemoCanvas)` 全局注册(C 方案)。VitePress 刻意不提供 VuePress 式的组件自动注册(issue #157),所以 skill 必须显式约定注册点。
  来源:https://vitepress.dev/guide/extending-default-theme 、https://vitepress.dev/guide/using-vue 、https://github.com/vuejs/vitepress/issues/157
- **命名坑**:组件名 "either contains a hyphen or is in PascalCase",否则被浏览器当内联元素导致 hydration mismatch。skill 生成的组件名建议统一 `<demo-xxx>` 连字符风格。
  来源:https://vitepress.dev/guide/using-vue
- **markdown 内样式**:避免 `<style scoped>`(要给全页每个元素加属性),用 `<style module>`。
  来源:https://vitepress.dev/guide/using-vue

### 2.2 `<ClientOnly>` 与 SSR 构建

- VitePress 构建时在 Node 里做 SSG,"all custom code in theme components are subject to SSR Compatibility";官方规则:"only access browser / DOM APIs in beforeMount or mounted hooks of Vue components"。
  来源:https://vitepress.dev/guide/ssr-compat
- **canvas / AudioContext 的正确姿势**:初始化代码放 `onMounted()`(SSR 不会执行);或包 `<ClientOnly><DemoCanvas/></ClientOnly>`(markdown 里也有 `::: client-only` 容器);或在 `if (!import.meta.env.SSR)` 条件里动态 `import()`。直接在模块顶层摸 `window`/`document` 会构建报错 `window is not defined`。
  来源:https://vitepress.dev/guide/ssr-compat 、https://vitepress.dev/reference/runtime-api 、https://github.com/vuejs/vitepress/issues/596
- 官方还提供 `defineClientComponent` 帮助函数:目标组件 "will only be imported in the mounted hook of the wrapper component",适合包第三方浏览器专用库。
  来源:https://vitepress.dev/guide/ssr-compat
- **音频额外坑**(官方文档之外,属浏览器通用约束):`AudioContext` 受自动播放策略限制,必须由用户手势(按钮点击)`resume()` 后才能出声。skill 的音频演示组件必须设计成「点击播放」而不是「进页自动响」。

### 2.3 静态资源引用与 base 前缀

- **public/ 目录**:文件按原样拷进 dist 根,引用时写根绝对路径(public/icon.png 引用为 `/icon.png`);public/ 里的文件**不能**被 JS import。
  来源:https://vitepress.dev/guide/asset-handling
- **markdown 相对路径**(`./image.png`)会被 Vite 处理:产物加 hash、**base 变化时自动加前缀**——"All your static asset paths are automatically processed to adjust for different base config values"。即 markdown 里 `![](./a.png)` 和 `![](/b.png)` 在 base=`/课程名/` 下都会自动正确。
  来源:https://vitepress.dev/guide/asset-handling
- **`withBase`**:自动处理只覆盖 markdown 静态写法;**组件里动态拼接的 URL(如 `:src="theme.logoPath"`、canvas 里 `fetch` ROM、`new Audio(...)`、iframe `src`)不会被自动处理,必须 `withBase(path)`**(从 `vitepress` 包 import)。这是聚合站场景最大的隐形炸弹。
  来源:https://vitepress.dev/guide/asset-handling
- 4kb 以下被 import 的资源会 base64 内联(可经 `vite.assetsInlineLimit` 配);链接型文件(PDF 等)必须手动放 public/。
  来源:https://vitepress.dev/guide/asset-handling

### 2.4 内嵌可运行代码的现成方案

- **VitePress 1.x 官方没有内置 playground / live-editor 容器**。官方 markdown 扩展只有 tip/warning 容器、代码组等;"live code blocks" 是社区长期诉求(issue #554),官方未实现。凡是声称 VitePress 自带 `::: vue-playground` 容器的说法,实为 VuePress 生态(vuepress-theme-hope)的功能,别混用。
  来源:https://vitepress.dev/guide/markdown 、https://github.com/vuejs/vitepress/issues/554 、https://theme-hope.vuejs.press/guide/markdown/code/vue-playground.html
- **最小形态就是 B**:markdown 的 `<script setup>` 直接跑 Vue,官方原生、零依赖。
- **`@vue/repl` 可嵌进 VitePress 页面**:Vue 官方文档(vuejs/docs,本身是 VitePress 站)就是在自定义 theme 里包 `@vue/repl`,浏览器内编译 SFC、沙箱 iframe 预览;npm 上活跃维护(4.7.2,2026-04)。社区插件 `vitepress-plugin-vue-repl` **已停更**(0.0.9,2023-10,npm 核实),不建议依赖。
  来源:https://github.com/vuejs/repl 、https://github.com/vuejs/theme/issues/30 、https://www.npmjs.com/package/@vue/repl
- **`@vitepress-demo-preview/component`**(2.6.2,2026-02 仍更新):提供组件预览容器,适合"Vue 组件库文档"形态,对非 Vue 课程的通用性一般。
  来源:https://www.npmjs.com/package/@vitepress-demo-preview/component
- **Sandpack**(react.dev 同款):开源的 in-browser bundler + CodeMirror 编辑器;默认从 CodeSandbox CDN 拉 bundler,可自托管到自己的静态空间做到零外域。
  来源:https://sandpack.codesandbox.io/ 、https://danilowoz.com/blog/sandpack

### 2.5 iframe 嵌外部 playground:形式与风险

| 平台 | embed 形式 | 备注 |
|------|-----------|------|
| TypeScript Playground | 无官方 embed API(需求 issue #5324 常年开放);事实做法是 iframe `https://www.typescriptlang.org/play/#code/<lz-string 压缩代码>`;分享链接同构(H 方案) | 代码全在 URL hash 里,链接零维护 |
| StackBlitz | iframe `https://stackblitz.com/edit/{id}?view=preview&hideExplorer=&theme=`;或 JS SDK `embedProjectId` / `embedProject`(可塞文件) | SDK:https://developer.stackblitz.com/platform/api/javascript-sdk |
| CodeSandbox | iframe `https://codesandbox.io/embed/{id}?module=&fontsize=&hidenavigation=&theme=`;define API `codesandbox.io/api/v1/sandboxes/define` 可 POST 压缩文件生成沙箱 | https://codesandbox.io/docs/embeding |
| CodePen | iframe `https://codepen.io/{user}/embed/{pen}?default-tab=result&theme-id=&editable=` | https://blog.codepen.io/documentation/embedded-pens/ |

- **离线/无外部依赖**:以上全部要求读者浏览器能访问外部域名;只有 G/H 以外的 A–F 方案能离线(仓库内自持)。
- **中文网络可用性**:无权威封锁名单,但社区反馈一致:这些平台域名多未整体屏蔽,而是**页面依赖的 Google CDN / unpkg 等第三方资源慢或不可达**,导致编辑器加载失败、预览空白(StackBlitz 的 WebContainers 依赖尤其多)。结论:**只能当"可选外链",不能当内容主通道**。
  来源:TypeScript URL 结构 https://www.typescriptlang.org/_playground-handbook/url-structure.html 、动态生成链接 https://allandeutsch.com/notes/dynamic-ts-playground-links 、embed 需求 https://github.com/microsoft/TypeScript/issues/5324

### 2.6 静态产物(截图/音频)的构建坑

- **大文件放 `public/`,不要走 import**:public/ 文件原样拷贝、不做 hash、不参与内联;而被 import 的大资源可能被 base64 内联进 JS,直接拖慢构建、撑爆 bundle(Vite issue #4454)。**超大 GIF 是已知反面案例**。
- 大站可加 `vite: { build: { reportCompressedSize: false } }` 提速。
- 课程实践建议:截图 PNG 用 markdown 相对路径(`./assets/x.png`,自动 hash + base);音频 mp3/wav、GIF、ROM 等二进制一律 `public/`,组件/HTML 里 `withBase()` 引用;超长动画优先考虑 mp4/webm 替代 GIF(体积差一个数量级)。
  来源:https://vitepress.dev/guide/asset-handling 、https://github.com/vitejs/vite/issues/4454 、https://vite.dev/config/build-options

### 2.7 base 前缀兼容性总表(问题 5)

| 写法 | base=`/` | base=`/课程名/` | 结论 |
|------|----------|-----------------|------|
| markdown `![](/x.png)`(public/) | 对 | 对(自动加前缀) | 可用 |
| markdown `![](./x.png)`(相对) | 对 | 对(自动处理 + hash) | 可用 |
| 组件里 `:src="'/x.png'"` 手写字符串 | 对 | **错**(404,不加前缀) | 必须 `withBase('/x.png')` |
| `new Audio('/x.mp3')` / `fetch('/rom.nes')` | 对 | **错** | 必须 `withBase` |
| iframe `src="./demo.html"` | 看路由深度 | **极易错**:iframe 相对 src 按当前页面 URL 解析,而 VitePress 是客户端路由,页面 URL 深度随章节变化(`/课程/ch1.html` vs cleanUrls 的 `/课程/ch1/`),同一 src 在不同页解析到不同目录 | 必须 `withBase('/demo.html')` 绝对路径 |
| iframe `srcdoc="..."`(内联 HTML) | 对 | 对(与 URL 无关) | base 完全免疫,但内容长了难维护 |
| 外部 https iframe / 外链 | 对 | 对(绝对 URL 不受 base 影响) | base 零风险,风险全在网络可用性 |
| `@vue/repl` / Sandpack 内嵌 | 对 | 对(自成一体) | base 零风险,风险在 CDN 可达性 |

### 2.8 业界参照(问题 6)

- **Vue 官方文档(vuejs/docs)**:VitePress + 自研 Playground 组件包 `@vue/repl`,浏览器内编译 SFC + 沙箱 iframe 预览,另附 "Open in Playground" 跳 play.vuejs.org。→ 自托管运行时 + 外链兜底的双层结构。
  来源:https://github.com/vuejs/theme/issues/30
- **React 官方文档(react.dev)**:全站交互示例嵌 Sandpack(CodeSandbox 开源 in-browser bundler),bundler 默认 CDN、可自托管。→ "把 playground 开源化、搬进自己站"的路线。
  来源:https://danilowoz.com/blog/sandpack 、https://sandpack.codesandbox.io/
- **The Rust Book(mdBook)**:代码块自带 play 按钮,把代码发到官方 play.rust-lang.org 远程编译执行(`book.toml` 里可开 editable)。→ "点一下送外部执行"的极轻路线。
  来源:https://rust-lang.github.io/mdBook/format/mdbook.html
- **MDN Live Samples**:把页面内 HTML/CSS/JS 代码块按 ID 合并,经特殊 URL 渲染进沙箱 iframe,同源自持、零第三方。→ "正文代码块即 demo"的极致自包含路线(与 VitePress 里 B/D 方案精神相同)。
  来源:https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Page_structures/Live_samples

---

## 三、按「可移植性 × 成本」的推荐排序

### 底线方案(每门课必须能做到,零新依赖)

1. **A 静态产物**:截图/音频放对位置(markdown 相对路径或 public/),自动 base 兼容,离线可看可听。
2. **B markdown `<script setup>` + `onMounted`**:页面内一次性小演示(画个位图、响个方波),官方原生能力,skill 只需在写作规范里写清三条纪律:
   - 浏览器 API 只出现在 `onMounted` 或 `<ClientOnly>` 内;
   - 组件内任何资源 URL 一律 `withBase()`;
   - 音频必须「点击后播放」。

### 默认方案(skill 规定的主机制,推荐)

3. **C 全局演示组件库**:skill 自带一套 `<demo-*>` 组件(canvas 渲染器、音频播放器、步进交互器),`enhanceApp` 注册,组件内部封装好 SSR 防护、withBase、autoplay 策略。**运行的是构建期打进 bundle 的 TS 模块**——companion 工程里「纯 TS、无 Node API」的模块(如 CPU/PPU/APU 核心)可直接被 docs 工程构建期 import(建议把 companion 做成 workspace 包依赖,避免 dev server 对 root 外文件的 `fs.allow` 限制),读者点按钮即在浏览器里跑真代码。这是「看到/听到/玩到」的最佳性价比点:零外部域名、base 安全、可移植性最高。
4. **D 自包含 demo 页 + iframe**:需要完整交互(键盘输入、模拟器整机)时,生成独立 HTML 放 `public/demos/`,iframe `:src="withBase('/demos/x.html')"`。注意若 demo 页内部还要加载同目录资源,页面内也要自己处理 base(可从 `iframe` 的 `window.location` 推导,或 skill 生成时注入 base 常量)。

### 进阶方案(可选,特定课程才上)

5. **E `@vue/repl` 内嵌**:教 Vue/前端框架的课程想要"读者改代码立即看效果"时;活跃维护但集成成本中高。社区插件停更,需自己包一层。
6. **F Sandpack 自托管**:需要真 npm 依赖树跑起来的 playground;要自托管 bundler 才能做到无外域,成本最高。
7. **G/H 外部 playground**:只做**外链**(H),不做内嵌(G)。TS Playground 的 `#code/` 压缩链接是零维护的"练手入口";StackBlitz/CodeSandbox 仅作为 companion 工程的"在线打开"备选,且必须标注"需要外网"。

### 只能退到 A/H 的课程形态

- **纯 CLI 课程**(git、shell、构建工具):无浏览器可运行语义 → A(终端输出截图/GIF/短屏录)+ H(复制命令的手把手)。
- **纯配置类课程**(CI YAML、tsconfig、正则等小例外):正则可上 B(浏览器能跑 `RegExp`),YAML/CI 只能 A(产物对比图)+ 外链到可校验站点。
- **依赖 Node 运行时/文件系统/网络的代码**(如 CLI 工具本身):浏览器跑不了 → A(运行输出)+ H(仓库链接 + StackBlitz WebContainers 外链,标注网络要求)。

---

## 四、结论(给 skill 的默认机制建议)

**默认机制 = C(全局演示组件 + 构建期打包运行)+ A(静态产物兜底)+ H(外部 playground 仅外链)三层组合。**

skill 应规定:每门课的 theme 里 `enhanceApp` 注册一套标准 `<demo-*>` 组件(canvas/音频/步进交互),组件纪律固定为「浏览器 API 仅在 `onMounted`、资源 URL 一律 `withBase`、音频需用户手势」;markdown 正文用组件标签嵌入,真代码从 companion 的纯 TS 模块构建期 import 进 bundle,使读者在浏览器里跑到的就是课程教的那份实现——零外部依赖、聚合站 base 安全、完全离线可用。纯 CLI/纯配置类课程明确降级为 A + H(截图/录音产物 + TS Playground 或仓库外链),并在 skill 里写死这条降级规则,避免为不可浏览器化的内容硬造交互。`@vue/repl`/Sandpack 不进默认机制,仅作为特定课程的显式进阶选项。
