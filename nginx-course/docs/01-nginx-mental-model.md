---
title: Nginx 心智模型：一个请求到底被谁处理了
---

# Nginx 心智模型：一个请求到底被谁处理了

周四晚上发版。你把 `npm run build` 产出的 `dist` 交给运维，半小时后客服工单进来了：页面白屏。你打开本地 `dist/preview` 一切正常，代码没问题；运维说机器没重启、进程活着，`error.log` 里也没有 5xx。两边都有道理，工单在前端、后端、运维之间踢了一整晚，因为没有人说得清：用户浏览器发出的那个 URL，进入这台机器之后，先后经过了谁、在哪一步变成了 404。

这不是谁的锅，是缺少一张地图。这一章不写配置，只画一张图——一个请求从网卡进来到字节离开，Nginx 内部发生了什么。有了它，后面十一章的每一条指令你都知道自己是在"哪个环节"上下功夫。

## 先回答那个问题：dist 放上去之后，谁在伺服它

`npm run dev` 时，伺服页面的是 Vite 的开发服务器——一个 Node.js 进程。`npm run build` 之后呢？生产环境几乎不会再用一个 Node 进程去伺服静态文件（贵、慢、还得防它崩），而是把 `dist` 交给一个专职进程：Nginx。

在机器上执行 `ps aux | grep nginx`，你会看到两类进程：

```text
root     1421  ...  nginx: master process
www-data 1422  ...  nginx: worker process
www-data 1423  ...  nginx: worker process
```

一个 master，N 个 worker——这就是经典的 master/worker 模型（master-worker model）。分工很干脆：

- **master**：读配置文件、绑定 80/443 端口、管理 worker 的生死。它不碰任何用户请求。
- **worker**：真正接客的进程。每个 worker 独立处理成千上万个连接。

为什么拆成两层？最直接的收益是**平滑重载**。你改完配置执行 `nginx -s reload`，master 重新读配置，然后通知老 worker"处理完手头的连接就退休"，同时按新配置拉起新 worker。全程没有一个请求被掐断——这就是发版时敢直接 reload 的底气。

worker 数量通常等于 CPU 核数，配置里那句 `worker_processes auto;` 说的就是这件事。

## 事件驱动：一个 worker，单线程，几万连接

worker 怎么做到一个人伺候几万个连接？答案是事件驱动（event-driven）：每个 worker 是单线程的，靠操作系统提供的 I/O 多路复用（Linux 上是 epoll）同时监听一大堆 socket，谁的缓冲区有数据就处理谁，处理完立刻去看下一个——绝不守着一个连接干等。

听着耳熟吗？这就是你天天在写的模型。浏览器的事件循环、Node.js 的事件循环、Nginx 的 epoll，是同一个思想的三种实现：**单线程 + 非阻塞 I/O + 事件队列**。区别只是 Nginx 把它用 C 写到了极致，一个 worker 就能扛数万并发连接。早年的 Apache 默认"一个连接一个线程/进程"，一万个连接就是一万个执行流，内存直接爆掉——Nginx 在 2004 年前后成名，靠的就是这件事。

对前端工程师来说，这个事实有个实用推论：**Nginx worker 处理请求时几乎不消耗应用层逻辑，它只是搬运字节**。所以给静态文件加一层 Nginx 不是"多一跳变慢"，而是把昂贵的应用进程解放出来只算业务。

## 一个请求的五步旅程

Nginx 官方文档把 HTTP 请求处理划分为 11 个阶段，那是模块开发者的视角。前端的视角记五步就够用，全书每一章都挂在这五步上：

```text
                 ┌────────────────────────────────────────────┐
 用户浏览器 ────▶│ ① 选 server：哪个站点？(listen / server_name)│
   GET /a.js     ├────────────────────────────────────────────┤
                 │ ② 选 location：URI 命中哪条规则？           │
                 ├────────────────────────────────────────────┤
                 │ ③ handler：本块怎么处理？                   │
                 │    静态文件(root) / 代理(proxy_pass) / ...  │
                 ├────────────────────────────────────────────┤
                 │ ④ 响应处理：压缩(gzip)、缓存头(expires)、    │
                 │    跨源头(add_header)                       │
                 ├────────────────────────────────────────────┤
                 │ ⑤ 日志：access_log 记一行                   │
                 └────────────────────────────────────────────┘
                                              响应字节 ◀────┘
```

1. **选 server**：一台机器可能同时伺服多个域名，Nginx 按请求的 Host 头和端口挑出那个 `server { }` 块。
2. **选 location**：在这个 server 内部，按请求 URI 挑出一条 `location { }`，这一步叫 location 匹配（location matching）。规则有精确、前缀、正则之分，优先级算法是第 3 章的主角——也是 `/api` 误伤 `/api-docs` 那类事故的案发现场。
3. **handler**：命中的 location 块决定"怎么处理"——读磁盘上的文件返回（静态服务，第 2 章），或者把请求转发给后端（反向代理，第 5–7 章）。
4. **响应处理**：字节往回走时可以过一层处理：压一压（gzip，第 8 章）、贴个缓存标签（expires，第 9 章）、补几个跨域头（add_header，第 10 章）。
5. **日志**：请求结束写一行 access_log。第 12 章你会学到怎么从这行字里读出 502 的真凶。

开篇那个白屏工单，用这张图复盘：`index.html` 回来了，里面引用的 `/assets/index-3f9c.js` 在第 ③ 步找不到文件，第 ② 步的 location 规则又把它兜底成了 `index.html` 返回 200——浏览器拿着 HTML 当 JS 解析，直接拒绝执行。定位它的全部工作，就是弄清这个 URI 在第 ②、③ 步分别发生了什么。

## 配置文件就是这张图的文本形态

Nginx 的心智模型有个罕见的优点：**进程结构和配置结构是同构的**。上面五步，全部落在 `nginx.conf` 的嵌套块里：

```nginx
# master 读的：进程模型
worker_processes auto;

events {          # 连接层：每个 worker 最多接多少连接
  worker_connections 10240;
}

http {            # HTTP 层：五步旅程的配置都从这层开始
  upstream backend {        # 第 7 章：一组后端
    server 127.0.0.1:8081;
  }

  server {                  # ① 选 server
    listen 80;
    server_name shop.example.com;

    gzip on;                # ④ 响应处理（第 8 章）

    location / {            # ② 选 location + ③ handler
      root /var/www/dist;   #   静态文件（第 2 章）
      try_files $uri /index.html;  # SPA 回退（第 4 章）
    }

    location /api/ {        # ② 另一条规则
      proxy_pass http://backend;   # ③ 反向代理（第 5 章）
    }
  }
}
```

三个要点现在就能立住，后面反复用到：

- **指令沿嵌套向下继承，内层覆盖外层**。`gzip on` 写在 http 层对所有 server 生效，某个 location 里写 `gzip off` 就只关自己。
- **`server_name` + `listen` 决定"哪个站点"，location 决定"哪条规则"**——两级筛选，先粗后细。
- **一份 `nginx.conf` 就是全部状态**。没有隐藏数据库、没有控制台，改完 `nginx -t` 验语法、`nginx -s reload` 生效。排查问题时"配置到底生效没有"永远可以从这份文件出发。

## 这本书的路线：亲手写一个 mini-nginx

读配置教程的通病是：背了一堆指令，遇到新场景还是不会配。这本书的做法是反过来的——**每章学一条指令，就用 Node.js 把这条指令的行为亲手实现一遍**。全书结束你会拥有一个 ~700 行的 mini-nginx：配置键和 nginx.conf 指令逐字相同，行为对齐官方语义，跑在一组真实的 HTTP 测试上。

为什么要自己写一遍？因为"location 优先级"“try_files 回退""proxy_pass 带不带斜杠"这些配置界最容易背了又忘的知识点，一旦你用 `if (rule.type === '=') return rule` 写出来过一次，就再也不需要背诵——它们从"文档里的规则"变成了"你写过的逻辑"。

mini-nginx 的选择是刻意的：Node 的 HTTP 模型（单线程、事件循环）恰好就是 Nginx worker 模型的同构缩微版，你写每一行都能对应到真实 Nginx 在做的事。真实 Nginx 用多 worker + epoll 把这件事做到工业级，差异地图在第 12 章收束成表。

下一章就从第 ③ 步的静态文件开始：`root`、`index`、MIME 类型——让那份 `dist` 第一次正确地跑起来。

---

**本章要点**：master 管进程不碰请求，worker 单线程靠事件驱动扛连接；请求处理五步——选 server、选 location、handler、响应处理、日志；配置结构与进程结构同构，指令内层覆盖外层。全书十二章挂在这五步上。
