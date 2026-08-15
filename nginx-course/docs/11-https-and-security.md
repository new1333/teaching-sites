---
title: HTTPS 与安全头：上线 TLS 前前端要懂的常识
---

# HTTPS 与安全头：上线 TLS 前前端要懂的常识

全站升级 HTTPS 的第二天，工单列表比发版还热闹。地址栏的锁是灰的，点开一看「此页面包含不安全的资源」：三个接口还写着 `http://api.example.com`，浏览器直接拦截——升级 HTTPS 后的页面里，任何 http 资源都成了"混合内容（mixed content）"。客服还没回复完，聊天室的用户又来了：WebSocket 全断了，前端还连的 `ws://`——HTTPS 页面里只允许 `wss://`。第三天，市场部发现从某些运营商网络进来的老用户（http 链接跳转过来的）页面右下角有运营商插的广告 iframe——HTTP 明文传输，中间人想插什么插什么。

这一章没有 mini-nginx 代码——TLS 握手在 Node 里也是一行 `https.createServer` 的事，难点从来不在实现，而在**理解每个环节解决什么问题、前端要配合改什么**。它是全书的 principle 章之二，也是上线前的 checklist。

## 证书链：三层的信任传递

HTTPS = HTTP + TLS。TLS 解决两件事：**加密**（中间人看不到内容，运营商插广告的空间消失）和**身份**（你连的确实是 example.com，不是钓鱼站）。身份靠证书证明，而证书本身是一条三层信任链：

```text
根证书（Root CA）              ← 内置在操作系统/浏览器里，信任的起点
  └─ 签发 → 中间证书（Intermediate）  ← CA 替自己隔离风险用的层
        └─ 签发 → 叶子证书（你的）    ← 绑定你的域名，发给你
```

浏览器验证时从叶子往上追到根，任何一环缺失或域名不匹配，连接报证书错误。前端最该记住的两个证书坑：

1. **部署时必须把中间证书一起部署**（fullchain 而不是只放叶子证书）。漏掉中间证书的现象很有迷惑性：**你自己电脑打开正常**（可能缓存过中间证书），部分用户浏览器报「证书链不完整」——又是"一半用户有问题"的家族事故。
2. **证书有有效期**，Let's Encrypt 免费 90 天，忘了续期就是全站红色警告页。务必上自动续期（certbot timer / acme.sh cron），不要指望人肉记忆。

## Nginx 侧的最小 HTTPS 配置

上线 TLS 的网关配置骨架，逐段都有存在理由：

```nginx
server {
  listen 443 ssl;
  server_name shop.example.com;

  ssl_certificate     /etc/nginx/certs/fullchain.pem;  # 叶子 + 中间证书，一个都不能少
  ssl_certificate_key /etc/nginx/certs/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;                 # 老协议有已知漏洞，别开
}

server {
  listen 80;
  server_name shop.example.com;
  return 301 https://$host$request_uri;                # http 全量跳 https
}
```

`301` 那个 server 块回答了"老用户的 http 链接怎么办"——永久重定向到 https。但 301 有个真空期：用户**第一次**访问 http 时，重定向响应本身还是明文的，中间人可以篡改它（这就是运营商劫持的原理）。补上这块缺口的是 **HSTS（HTTP Strict Transport Security）**：

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

它告诉浏览器："这个域名一年内只许用 https，直接在本地拒绝 http 访问"。第一次之后，连那次明文重定向都省了——中间人篡改的窗口从"每次访问"缩到"第一次访问"。`includeSubDomains` 把所有子域名一起管上（注意：上它之前确认没有任何子域名还只能跑 http，否则会直接打不开）。

## 前端配合清单：混合内容的完整拆除

网关配好了，前端侧的活儿一样具体：

- **接口地址全部走协议相对或 https**。`http://api.example.com` 在 https 页面里被拦，`//api.example.com`（协议相对）或干脆同源 `/api`（第 5 章的代理方案）都行。检查生产配置里的 API baseURL 是不是写死了 `http://`。
- **WebSocket 换 `wss://`**，且注意第 6 章的知识点依然成立：wss 穿透代理同样需要 Upgrade 头透传。
- **图片、字体、iframe 等子资源**：被动混合内容（img/audio/video）浏览器目前多会自动升级或放行，但**主动混合内容**（script、fetch、XHR、websocket）一律硬拦。别赌策略，统一换干净。
- **`crossorigin` 的资源**换完协议后重新过一遍第 10 章的跨域授权。

## CSP：给页面装一道内容防火墙

最后一个安全头值得单独认识——内容安全策略（CSP）。前面所有手段是"修好自己"，CSP 是"就算有 XSS 注入，也让他加载不了外部脚本"：

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; connect-src 'self' https://api.example.com; img-src 'self' data: https:" always;
```

语义按资源类型白名单化：脚本只许自家域，接口只许自家和 api 域，图片放开 https。它的调试姿势要记住：先上 `Content-Security-Policy-Report-Only`（只上报不拦截，看 console 里的违规报告），确认无误再切换到强制模式——直接上强制 CSP 打断第三方脚本，是另一种"上线即事故"。

顺带收个尾：`add_header` 在这里全部带了 `always` 参数——第 10 章说过 add_header 默认不对 4xx/5xx 生效，安全头恰恰要在错误页上也生效，这个参数是标准搭配。

## 验证（这一章的"测试"是工具链）

- **SSL Labs**（ssllabs.com/ssltest）：在线扫你的域名，证书链完整性、协议版本、加密套件一次给全，A 是及格线。
- **浏览器 DevTools 的 Security 面板**：一眼看混合内容还剩几个，点开能定位到具体资源。
- `curl -I http://shop.example.com`：确认 301 跳 https；`curl -I https://...` 确认 HSTS 头在场。

---

**本章要点**：TLS 一次解决加密与身份，证书链三层缺一不可（部署 fullchain、自动续期）；http→https 用 301，HSTS 补上"第一次访问"的明文窗口；前端要拆干净混合内容——接口、wss、子资源全换；CSP 用 Report-Only 起步再转强制，安全头记得带 `always`。
