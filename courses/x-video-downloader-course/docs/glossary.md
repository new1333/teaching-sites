# 术语表

全书术语一句话定义。首现章节的教学详解见各章正文。

| 术语 | 英文 | 一句话定义 |
| --- | --- | --- |
| 浏览器插件（扩展） | browser extension | 装进浏览器的小程序，能在你访问的网页里和浏览器本身做事，本课做的是它 |
| Manifest V3 | Manifest V3 | Chrome 给插件定的第三代说明书规范，规定了插件能要什么权限、代码怎么组织 |
| manifest.json | manifest.json | 插件的唯一入口文件：声明插件叫什么、要什么权限、各段代码在哪 |
| 未打包扩展 | load unpacked | 开发阶段的装载方式：把本地文件夹直接挂进浏览器，不用上传商店 |
| content script | content script | 跑在你访问的页面里的插件代码：能摸 DOM，但拿不到多数浏览器 API |
| service worker（插件后台） | extension service worker | 插件的后台代码：能拿浏览器 API（监听网络、下载），但没有任何页面/DOM 能力，且闲下来会被浏览器休眠 |
| 权限声明 | permissions | manifest 里向浏览器报备的能力清单：API 权限（如 webRequest）与站点权限（host_permissions） |
| host_permissions | host_permissions | manifest 里声明允许访问哪些网站（如 x.com、twimg.com），也是跨域请求被豁免的依据 |
| 被动监听 | passive listening | 只能看请求流过、不能拦截或改写的观察模式；MV3 里 webRequest 只剩这种用法 |
| blob: URL | blob URL | 浏览器给内存里一块数据发的临时门牌，页面刷新就作废，不是硬盘上的文件地址 |
| MSE（媒体源扩展） | Media Source Extensions | 让网页用 JS 一段段喂视频给 `<video>` 播放的标准，喂进去后 src 只显示 blob: 门牌 |
| HLS | HTTP Live Streaming | 苹果发明的流媒体方案：把视频切成小分片、配一张清单，边下边播 |
| m3u8 播放列表 | m3u8 playlist | HLS 的清单文件，纯文本：写着有哪些清晰度或分片、各在什么地址 |
| master playlist | master playlist | 一级清单：只列各清晰度变体（带宽/分辨率）和它们的二级清单地址，不含分片 |
| media playlist | media playlist | 二级清单：列某一档清晰度的全部分片地址与时长 |
| 分片 | segment | 视频被切成的小段（通常几秒一段），播放器按清单顺序逐段取用 |
| EXTINF | EXTINF | m3u8 里的标签行，写每个分片的时长，下一行就是分片地址 |
| EXT-X-STREAM-INF | EXT-X-STREAM-INF | master 清单里的标签行，写一档清晰度的带宽/分辨率/编码，下一行是它的清单地址 |
| BANDWIDTH | BANDWIDTH | 一档清晰度播放时每秒要吞的数据量，数字越大一般越清晰 |
| 清晰度变体 | variant | 同一个视频预先压好的多份不同画质拷贝，各有一套分片 |
| EXT-X-MAP | EXT-X-MAP | media 清单里指向初始化分片的标签：fMP4 格式的流要先取它才能解码后续分片 |
| 字节拼接 | byte concatenation | 把按顺序取回的分片原样首尾相接成一个文件；同编码参数的流拼完即可播放 |
| 并发抓取 | concurrent fetching | 同时开几个请求下分片、按原顺序交货，比一个接一个快 |
| chrome.downloads | chrome.downloads API | 插件后台用的浏览器下载 API：给个 URL 和文件名，浏览器替你存盘 |
| a[download] | anchor download attribute | 页面侧的落盘方式：造一个带 download 属性的链接点一下，把内存里的 Blob 存成文件 |
| CORS 豁免 | CORS exemption | 插件在 host_permissions 报备过的站点上发请求，不受网页世界跨域限制 |
| SPA | single-page application | 只加载一次页面的应用：之后所有『翻页』都是 JS 换 DOM，浏览器从不重新加载 |
| MutationObserver | MutationObserver | 浏览器提供的 DOM 监控 API：指定的容器里长出/变化了什么，就回调通知你 |
| data-testid 锚点 | data-testid anchor | 页面元素上测试专用的稳定属性，比 class 更适合当选择器；X 的推文元素带着 data-testid="tweet" |
| 状态机 | state machine | 把一个东西的生命周期明确划成几个状态、规定谁能变到谁，避免逻辑糊成一团 |
| 消息传递 | runtime messaging | 插件两个世界之间唯一的通话方式：sendMessage 发小票、监听端回执 |
| CSP（内容安全策略） | Content Security Policy | 页面/插件声明『只允许从哪加载什么』的白名单；MV3 还额外禁止插件运行远程代码 |
| 打包 zip | packaging | 把扩展目录压成一个 zip 上传商店；store 只认这个格式 |
| Chrome Web Store | Chrome Web Store | Chrome 官方插件商店，插件的发布与审核都在这里 |
| 权限最小化 | least privilege | 只报备功能真正用到的最小能力集：用户公示更短、审核答得出用途、失守时爆炸半径最小 |
| MV3 砍掉 blocking webRequest 的来龙去脉 | MV2 to MV3 migration | 2019 年 Chrome 宣布用声明式 DNR 取代 webRequest 拦改、2024-2025 逐步禁用 MV2 的七年迁移战；观察用法保留，拦改只剩企业策略扩展 |
| Blob | Blob object | 内存里的一段数据包着文件式的元信息（类型、大小），能整体交给下载、播放等 API 使用；两个世界都造得出它 |
| URL.createObjectURL | URL.createObjectURL | 把一块内存数据注册成 blob: 临时门牌的页面侧 API；service worker 里没有它（MDN：available in Web Workers, except for Service Workers） |
