---
title: 反向代理与 HTTPS：给应用一个正式入口
---

# 反向代理与 HTTPS：给应用一个正式入口

网址发出去十分钟，朋友回来一张截图：浏览器整页通红，一行「您的连接不是私密连接」。你登上一看，应用明明活着——`curl http://服务器IP:3000` 一打就通。可你发出去的是 `https://域名`：443 端口上什么都没有，这就是「https 打不开」的现场；退一步用 IP 加端口访问，能通，但地址栏从此挂着「不安全」；偶尔还有第三种——入口在、后端死，浏览器收一页 502。更扫兴的在后头：服务器重启一次，连 `IP:3000` 都没了，应用容器没人负责拉起来。

这些现象拆开看，是同一个缺口的三张脸：应用直接对公网「裸奔」，没有一个正式入口。IP 加端口不是正式入口——用户记得住域名，记不住 `:3000`；明文 HTTP 不是正式入口——现代浏览器对没有证书的站点直接亮红；崩溃后靠人手工恢复的也不是正式入口——正式的东西要能自己站起来。本章在本地把这套「正式入口」完整搭一遍：四块新积木——反向代理、TLS 终止、自签名证书、进程守护与重启策略。收尾的门槛仍是一条命令：起生产拓扑、经 https 跑完全部断言、杀掉应用进程验证自动恢复、拆除验清理；真实服务器上的对应动作，以一份移交清单收口。

## 工具箱

本章调用三块旧积木。

部署单元——一次部署交付的最小整体，本课当前形态是封着 .output 的容器镜像（第 1 章）。本章它退到内网：不再直接见公网流量。

Compose 应用栈——一份编排文件声明多服务拓扑，`docker compose up -d --wait` 拉起并等健康，`down` 拆除（第 5 章）。本章用同一套语法，把拓扑从「应用加数据库」扩成「应用加数据库加入口」。

容器健康检查——HEALTHCHECK 周期探 /api/health，编排器据此等待或拒绝（第 5 章）。本章它多接一个消费者：入口服务等应用转绿后才起。

## 反向代理：统一入口的守门人

反向代理——挡在应用前面的一个服务器进程（本章用 Nginx）：统一接收 80/443 的公网流量，按规则转发给后端服务，顺带承担 TLS、请求体限额、压缩这些「门口的事」。

先处理一个流传很广的印象：「Nginx 是用来提速的」。这个直觉有出处——压缩响应、托管静态文件、缓存，确实是 Nginx 的经典用法，性能叙事也最容易传播。但把它的职责缩成提速，就看漏了主职。做个反事实：没有反向代理的多服务拓扑是什么样？每个服务各自监听端口、各自对公网开口；数据库旁边那个管理面板占 8081，API 占 3000、WebSocket 占 3001；防火墙规则跟着端口清单走；要上 HTTPS，每个服务各自配证书。入口分散，信任面跟着分散——「关掉一个端口」再也说不清牵连着谁。反向代理把这幅图收拢成一个点：公网只见 80 与 443，其余一切只在内部网络里说话。它是拓扑的塑造者，提速只是副业之一。

载体是一行指令。Nginx 配置里的 `proxy_pass http://app:3000` 把进入的请求转交给后端——这里的 `app` 不是公网域名，是 compose 网络里的服务名主机名（Compose 应用栈那套解析，原样生效）。于是「应用监听在哪」从「用户要记的地址」退化成「内部实现细节」：用户只认 443 一个门，门后转给谁，运维说了算。

本课的这份配置全文如下（nginx 自己的全部家当就这一个文件，挂载方式见演练；注释略有精简，终态见 companion）。

```nginx
# companion/nginx/nginx.conf · 反向代理与 TLS 终止的全量配置
#
# 拓扑：浏览器 --TLS--> nginx(443) --HTTP--> app:3000 --SQL--> db:5432

worker_processes auto;

events {
  worker_connections 1024;
}

http {
  # WebSocket 升级的正确姿势：Upgrade 头存在才传 Connection: upgrade，否则 close。
  # 直接写死 Connection "upgrade" 会让普通 keep-alive 请求也要求升级。
  map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
  }

  server {
    listen 80; # 宿主映射 4181：本地演练的明文入口
    server_name _;

    # $host 不带端口：真实服务器（80/443 标准端口）上这一跳直达 https 同路径。
    # 本地演练里 https 在 8443 非标准端口，跳转目标的端口对不上——差异登记见「简化与差异登记」附录。
    return 301 https://$host$request_uri;
  }

  server {
    listen 443 ssl; # 宿主映射 8443：本地演练的 TLS 入口
    server_name _;

    # 证书由 scripts/gen-cert.mjs 生成到 nginx/certs/，以只读卷挂进容器；
    # 私钥不入库（.gitignore），换机器重新生成即可——它本来就只是演练用的自签证书
    ssl_certificate     /etc/nginx/certs/server.crt;
    ssl_certificate_key /etc/nginx/certs/server.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # 实践项：POST body 上限。默认 1m，部署日志带长 summary 也会被 413 拦下
    client_max_body_size 10m;

    location / {
      # 服务名即主机名：app 是 compose 网络里的服务，nginx 与它同栈不同容器
      proxy_pass http://app:3000;

      proxy_http_version 1.1;

      # 四个标准代理头：后端要还原「客户端视角」全靠它们（正文有抽走 Host 的对照实验）
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;

      # WebSocket：升级请求透传（实时功能、开发期 HMR 都走这里）
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;

      # 后端死了要快速失败：默认的 60s 连接超时会把「后端不在」拖成一分钟的挂起请求，
      # 排障时看到的是迟迟不来的 504 而不是立刻的 502——窗口越短，恢复越快被看见
      proxy_connect_timeout 2s;
    }
  }
}
```

四个代理头值得逐个点名，它们是「后端还原客户端视角」的全部依据。不显式设置时，nginx 传给后端的 Host 是 `app:3000` 这个上游地址——应用看到的「我被谁访问」就错了；`Host $host` 把浏览器输入的主机名原样交回。`X-Real-IP` 是直连 nginx 的客户端地址；没有它，应用日志里的每个访客都是 nginx 的内网 IP。`X-Forwarded-For` 是逐跳追加的代理链，`$proxy_add_x_forwarded_for` 在已有链尾补上本跳。`X-Forwarded-Proto` 告诉后端客户端用的是 https——应用要生成绝对链接或重定向时，靠它避免把用户带回明文。这四个头不设，功能多半也能跑；代价是日志、限流、审计在悄悄说谎。

## TLS 终止：加解密停在门口

TLS——给浏览器与服务器之间那条通道加密的协议，https 里的 s 就是它。证书——服务器出示的身份证明，由受信任的签发方（证书机构，CA）背书。

TLS 终止——HTTPS 的加解密在反向代理这一层结束：nginx 持有证书、跟浏览器完成握手，转给后端的走栈内明文 HTTP。证书全栈只配一处，应用对 TLS 全程无感。

「证书要配在应用里」这个直觉先说句公道话：Node 进程确实能自己讲 TLS，不少入门教程也正是这么教的——一个进程、一份证书、直接监听 443，跑得通。不成立的是边界：那是单进程世界的方案。搬到多服务拓扑里，每个服务各自持证书、各自管 443、各自处理续期；换一次证书，全部应用跟着重启；传输层的麻烦漏进业务代码，SSR、API、WebSocket 各自配一遍。终止在门口，这些账就只剩一本：**证书只配一处，内网走明文，应用专心做业务**。

两个真实现场能钉死「应用自己不讲 TLS」这件事。其一，对一个纯 HTTP 的端口发起 https 请求。拿本课应用栈的 4180 出入口做实验：

```text
# curl https://127.0.0.1:4180/（真实输出；应用栈在跑）
curl: (35) schannel: next InitializeSecurityContext failed: SEC_E_INVALID_TOKEN (0x80090308) \
- The token supplied to the function is invalid
```

握手在第一个字节就崩了。客户端等的是 TLS 握手报文，收到的是 HTTP 服务器的明文应答，互相听不懂。退出码 35（SSL connect error）是稳定信号；报错原文随 curl 的 TLS 后端而异——本机是 Windows 的 schannel，OpenSSL 系的 curl 文本不同，机制相同。其二，对空端口发起 https 请求（443 无人监听时的「打不开」）：

```text
# curl -k https://127.0.0.1:8443/（真实输出；8443 上没有任何进程）
curl: (7) Failed to connect to 127.0.0.1 port 8443 after 2038 ms: Could not connect to server
```

退出码 7，连接被拒——跟 TLS 无关，门都没敲到。两条报错并排放着，「https 打不开」这个笼统症状就已经开始分层：连不上是入口层的事，握不上手是协议层的事。

组装一次完整的路径，让你合上书也画得出来。一次 `https://localhost:8443/` 请求的全部七跳：

```text
# 一次 https 请求的每一跳（本地演练的端口；真实服务器为 443）
 1. 浏览器：向 443 发起 TLS 握手，验证书、协商密钥          ← 加密从这里开始
 2. nginx   ：出示证书、完成握手，解密出明文请求 "GET /"
 3. nginx   ：按 location / 的规则，转给 proxy_pass 的上游 app:3000
 4. app     ：Node 进程收到的是普通 HTTP——它不知道也不需要知道外面是 https
 5. app     ：渲染首页要读数据，向 db:5432 发 SQL（栈内明文）
 6. 返回路上：app 的明文响应交回 nginx
 7. nginx   ：用握手协商的密钥加密响应，发还浏览器          ← 加密到这里结束
```

加密覆盖的正是「不可信的地带」——公网。栈内两跳（nginx 到 app、app 到 db）在 Docker 的内部网络里，外面摸不进来。TLS 终止不是「少加密了内网」，而是「把加密精确铺在需要它的那段路上」。

## 自签名证书：先在本地把链路走通

自签名证书——自己给自己签发的证书：不在任何浏览器或操作系统的信任链里，客户端要么显式放行（curl 的 `-k`），要么亮红警告。用途是把 HTTPS 的完整链路在本地演练通；生产环境换 CA 签发的证书，链路一个字节都不用改。

成因是验证条件的错位。CA 签发证书前要核验「你真的控制这个域名」——Let's Encrypt 的常见做法是从公网向你的 80 端口发一个验证请求（HTTP 挑战）。本地演练没有公网 IP、没有域名，这条路走不通；而本地要验证的东西——nginx 能不能挂证书、握手能不能完成、跳转对不对——不依赖证书由谁签发。自己签一张，链路先通；等拓扑搬上真服务器，把证书文件换成 CA 的，其余零改动。这是「自签 vs CA」的全部差异：信任从哪来，不在链路怎么走。

载体是一条 openssl 命令（`scripts/gen-cert.mjs` 包了跨平台的一层，命令本体如下）：

```bash
# 用法示例 · 生成自签证书（或直接 pnpm gen:cert）
openssl req -x509 -newkey rsa:2048 -sha256 -days 60 -nodes \
  -keyout nginx/certs/server.key -out nginx/certs/server.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

`req -x509` 一步产出自签证书，无需先建 CA 再签发；`-days 60` 是有效期；`-nodes` 让私钥不加密存储（本地演练的取舍）。`-addext` 那行是新手最常漏的：现代客户端（浏览器、curl、Node）校验的是证书里的主题备用名称（SAN），CN 只是旧时代的遗物——漏了 SAN，`https://127.0.0.1` 永远握不上手，因为证书里只认 `localhost`。生成结果可查：

```text
# openssl x509 -in nginx/certs/server.crt -noout -subject -ext subjectAltName（真实输出）
subject=CN=localhost
X509v3 Subject Alternative Name:
    DNS:localhost, IP Address:127.0.0.1
```

它「不在信任链里」不是理论，当场可见：

```text
# curl https://localhost:8443/（真实输出；不带 -k）
curl: (60) schannel: SEC_E_UNTRUSTED_ROOT (0x80090325) - The certificate chain was issued \
by an authority that is not trusted.
```

退出码 60（证书校验失败）。加 `-k`，同一个地址立刻 200——请求一模一样，变的只是客户端信不信这张证书。浏览器的红警告页（开篇截图那张）就是这行报错的图形版。

证书产物不进仓库，与 `.env` 是同一条纪律的两副面孔：仓库里只留生成方式（脚本加正文），不留产物本身。`nginx/certs/` 整个目录在 .gitignore 里；私钥尤其如此——它一旦进了 git 历史，删掉当前副本也追不回。换台机器，重跑一遍脚本，十秒后有一张新的。

## 进程守护与重启策略：死了要有人拉

进程守护与重启策略——让服务在进程崩溃、机器重启之后自动恢复原位的机制：容器场景是编排文件里的 restart 约定，裸机场景是 systemd 这样的 init 系统单元。可以把它想成给服务配一个不下班的保姆：它不修 bug，只保证「倒了就扶起来」。

成因看一下没有它的世界。本课应用栈的 `compose.yaml`（第 5 章）里就没有 restart 约定——那不是疏漏，是演练栈的合理默认：跑完就拆，没人需要它自愈。但如果把它当生产配置照搬，后果实测如下（应用栈在跑，杀掉应用容器）：

```text
# docker kill shiplog-stack-app 后等 6 秒（真实输出）
# docker ps -a --filter name=shiplog-stack-app --format '{{.Names}} :: {{.Status}}'
shiplog-stack-app :: Exited (137) 6 seconds ago

# curl -s http://127.0.0.1:4180/（真实输出）
curl: (7) Failed to connect to 127.0.0.1 port 4180 after 2045 ms: Could not connect to server
```

`Exited (137)`——137 是被 SIGKILL 杀死的退出码。六秒过去，没有谁把它扶起来；开篇第三个现象「重启后没了」，在容器世界就是这个画面的日常版。恢复要靠人：登机器、`docker compose up -d`、确认健康。半夜两点的这套动作，正是 restart 约定要删除的东西。

载体是 compose 服务上的一行：`restart: unless-stopped`。三个常用值的语义一次说清：`no`（默认）死了就躺着；`always` 总是拉起，连 docker 引擎重启后也拉；`unless-stopped` 与 always 只差一件事——你手动停掉的，就让它停着。运维上最后这个差别最常用：维护时 `docker stop` 是明确意图，不该被策略覆盖。生产拓扑里长跑的服务（app、db、nginx）都写 `unless-stopped`；一次性容器（migrate）刻意不写——它跑完正常退出，配上重启策略就成了无限循环。守护是常驻服务的事。

这条约定区分两种「死」：**进程自己死了，拉起；人叫它停，尊重**。两者在本地都能实地验证，演练一节有对照。

## 演练：从三个红到 sim:prod 全绿

先交代改动面。新增五件：`nginx/nginx.conf`、`scripts/gen-cert.mjs`（登记 `pnpm gen:cert`）、`compose.prod.yaml`、`scripts/sim-prod.mjs`（登记 `pnpm sim:prod`）、证书目录的 .gitignore 条目；package.json 加两条 scripts。应用代码一行未动——镜像、健康探针、迁移账本全部原样复用，新拓扑只是给它们前面加了道门。

门槛命令在既有体系之上新增一条：

```bash
# 用法示例 · companion 目录内
pnpm sim:prod   # 起生产拓扑 → https e2e → 杀进程验自动恢复 → down -v 验清理
```

### 红：缺口各自的原样报错

三个红都来自真实运行，分别是「没有门」「门里没证书」「死了没人拉」。

红一，443 上没有入口。上一节的 `curl: (7)` 就是它：8443 无人监听，连接被拒。应用还在 3000 上好好跑着——这正是「IP:3000 能访问，https 打不开」的机械解释：能访问的那个口子，和 https 要敲的那个门，是两个端口。

红二，配了证书，客户端不信。nginx 挂上自签证书之后，`curl: (60)` 那条 SEC_E_UNTRUSTED_ROOT 出场——握手能完成、证书能出示，卡在「你不被信任」。这一步很重要：它证明链路其余环节都通了，只剩信任这一件事，而信任问题生产环境由 CA 解决。

红三，没有 restart 约定的世界。`Exited (137)` 躺平那幕。三个红对应三块积木，各修各的。

开发路上还撞上第四个红，值得留档——它其实是旧积木的兑现。第一版 `compose.prod.yaml` 里把环境名写成了 `NUXT_PUBLIC_APP_ENV: prod`，起栈时 `--wait` 直接失败；应用日志是配置门卫的拿手格式：

```text
# docker logs shiplog-prod-app（真实输出，节选）
[config] 必需环境变量校验失败（1 项）：
  - NUXT_PUBLIC_APP_ENV: 只允许 local、staging 或 production
```

启动期配置校验那套清单，在新的生产拓扑里原样守门——环境名差一个字母都上不了岗。顺带看到 restart 约定的另一面：修好之前，容器在「启动、退出、再启动」之间循环（`docker inspect` 显示 `restarting`）——策略连崩溃循环也会一直拉，它做的是「扶起来」，不是「治好」；治好得靠人读清单。把值改成 `production`，转绿。

### 转绿：一份生产拓扑

`compose.prod.yaml` 全文如下（注释略有精简，终态见 companion）。取舍先说：为什么独立一份文件，而不是在 `compose.yaml` 上叠加 override？叠加能省掉这份重复，但生产拓扑最关键的一处改动是「删掉 app 的宿主端口映射」，在叠加语法里要用特殊的 reset 标记、读起来隐晦；独立文件让「谁能被公网摸到」一眼可读，代价是 app 与 db 的定义有重复——两份编排文件的读者场景本来就不同（调试直连 vs 生产拓扑），靠两套门槛各自兜底。这与开发库、应用栈当初分立两份文件，是同一个决定。

```yaml
# companion/compose.prod.yaml · 生产拓扑：app + db + nginx（pnpm sim:prod 走这里）
#
# 与 compose.yaml 的分工：
#   compose.yaml      —— 应用栈：app 映射宿主 4180，开发调试直接打应用；
#   compose.prod.yaml —— 生产拓扑：宿主入口只剩 nginx 的 80/443（本地映射 4181/8443），
#                        app 与 db 都不映射宿主端口，只在栈内网络可达。
# 项目名 shiplog-prod 与前两者错开：三套容器、各自的网络与卷，互不干扰。
name: shiplog-prod

services:
  app:
    build:
      context: .
      target: run
    container_name: shiplog-prod-app
    environment:
      NUXT_DB_URL: postgres://ship_log:ship_log@db:5432/ship_log
      NUXT_PUBLIC_APP_ENV: production
    # 注意没有 ports：应用不再有宿主入口，流量一律经 nginx 的 443 进来——
    # 「绕过反代直连应用」这条路在生产拓扑里不存在
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped # 崩溃自动拉起；手动 docker stop 之后的「停」被尊重

  db:
    image: postgres:16-alpine
    container_name: shiplog-prod-db
    environment:
      POSTGRES_USER: ship_log
      POSTGRES_PASSWORD: ship_log
      POSTGRES_DB: ship_log
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ship_log -d ship_log"]
      interval: 2s
      timeout: 3s
      retries: 15
    restart: unless-stopped

  nginx:
    image: nginx:1.27-alpine # 固定 tag：与 postgres:16-alpine 同一条「不漂移」纪律
    container_name: shiplog-prod-nginx
    # 生产拓扑唯一的宿主入口：本地演练用 4181/8443，真实服务器换成 80/443（runbook 有对照表）
    ports:
      - "4181:80" # 明文入口：nginx 只做一件事——301 跳 https
      - "8443:443" # TLS 入口：证书在这里终止，转发明文 HTTP 给 app:3000
    volumes:
      # 整份配置挂为容器的 /etc/nginx/nginx.conf（nginx 容器启动时读的就是这个路径）
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      # 证书目录只读挂载：nginx 只需要读，不需要改
      - ./nginx/certs:/etc/nginx/certs:ro
    depends_on:
      app:
        condition: service_healthy # app 健康探针没绿之前，入口不起——避免「入口在、后端死」的 502 窗口
    restart: unless-stopped

  # 一次性迁移执行器：与 compose.yaml 的 migrate 同构（借 build 段工具镜像 + tools profile）。
  # 刻意不写 restart：它跑完就退出，而 unless-stopped 连「正常退出」也会拉起重跑——
  # 一次性容器配重启策略等于无限循环。守护是常驻服务的事。
  migrate:
    build:
      context: .
      target: build
    profiles: [tools]
    environment:
      NUXT_DB_URL: postgres://ship_log:ship_log@db:5432/ship_log
    command: node node_modules/drizzle-kit/bin.cjs migrate
    depends_on:
      db:
        condition: service_healthy

volumes:
  db-data:
```

拓扑上有三处新语法。app 没有任何 ports——「直连应用」这条路在生产拓扑里不存在，`docker port shiplog-prod-app` 输出为空是它的可验证形态。nginx 的两个端口映射是全栈唯一的宿主入口；镜像 tag 固定 `nginx:1.27-alpine`，与 postgres 同一条不漂移纪律。nginx 的 `depends_on` 写了 `condition: service_healthy`——容器健康检查那块积木的新消费者：app 的探针没绿，入口不创建，起栈顺序由声明自动排队。

门槛跑起来是这个样子（真实输出）：

```text
# companion/scripts/sim-prod.mjs 的运行输出：pnpm sim:prod（真实，docker compose 进度行从略）
[prod] 第 6 章生产拓扑演练开始（Docker + Compose 需在运行）
[prod] 镜像构建完成（1.1s）——与 compose.yaml 共用同一份 Dockerfile
[prod] 栈已就绪（7.8s）—— 入口 https://127.0.0.1:8443，app 无宿主端口
[prod] https /api/health → 200 {status:"ok", appEnv:"production"}（TLS 在 nginx 终止，明文进 app） → PASS
[prod] https GET / → 200，SSR 页面显示环境 production → PASS
[prod] 自签证书细节可验（CN=localhost，SAN 含 localhost 与 127.0.0.1） → PASS
[prod] app 无宿主端口映射（docker port 为空）——唯一入口是 nginx 的 4181/8443 → PASS
[prod] http:4181 → 301 https://127.0.0.1/（明文入口只做跳转） → PASS
[prod] 落库往返：POST → 201，首页裸 HTML 含 "502feed"（https 全链路 + 栈内 db） → PASS
[prod] 幕二：向 app 容器的 PID 1 发 SIGTERM（模拟进程自行崩溃）→ 等自动重启恢复
[prod] 崩溃窗口内入口状态序列：502 → 200
[prod] 崩溃 → 自动重启 → 服务恢复（RestartCount 0→1，1.8s），卷中数据仍在 → PASS
[prod] 全部断言通过 (7/7)
[prod] 收尾：docker compose down --volumes（还端口、还容器名、清卷）
[prod] 端口 4181/8443 已释放，shiplog-prod-* 容器已清空 → 收尾 PASS
```

逐行有两处值得停。`502 → 200` 那一行是开篇现象的正面捕获：进程死去的一瞬间，入口还在、后端没了，nginx 立刻回 502；不到两秒，restart 约定把容器拉起，入口回到 200。`RestartCount 0→1` 是 Docker 记录的「被策略拉起次数」——恢复是约定的功劳，不是巧合。幕二用的崩溃手法也说明一下：演练脚本进容器向 1 号进程发 SIGTERM（应用的 Node 进程对它有优雅退出处理，收到即退出）——进程「自己死了」，正归重启策略管。对照组是 `docker stop`：管理员叫停，本机引擎按手动停止对待，容器就停着，`docker start` 才回来。同为「容器不在了」，一个是故障、一个是意图，策略只认后者为「不拉」。

脚本 `scripts/sim-prod.mjs` 是纯编排逻辑，与应用栈演练同骨架（第 5 章）：预清理、起库、迁移、起栈、断言、崩溃幕、finally 拆除验清理。差异只在对 https 的处理——Node 的 fetch 没有「跳过证书校验」的开关，脚本改用 `node:https` 的最小实现达成 `curl -k` 同款语义。演练的信任边界在「链路对不对」，不在「本机临时证书被谁信任」。断言里还有一条证书细节检查：握手放行的同时读回对端证书，核对 CN 与 SAN——生成命令里写进去的名字，在真实握手里原样出现。

既有门槛全数复跑无回退：typecheck、test（15 条）、build、e2e:ch1 到 e2e:ch4、compose:sim 照常全绿；开发库的起停体系未受影响。

## 验证：先猜，再跑

每个实验的预测先落纸——离散值，一个状态码或二选一——再动手对照。四组实验共用一套现场栈，起法三步（每组收尾都执行末尾的拆除）：

```bash
# 用法示例 · companion 目录内
docker compose -f compose.prod.yaml -p shiplog-prod up -d --wait db
docker compose -f compose.prod.yaml -p shiplog-prod --profile tools run --rm migrate
docker compose -f compose.prod.yaml -p shiplog-prod up -d --wait
# 收尾拆除（还端口还容器清卷）
docker compose -f compose.prod.yaml -p shiplog-prod down --volumes
```

实验一：信任边界。栈在跑，浏览器打开 `https://localhost:8443`。先猜：看到部署日志页面，还是看到整页警告？警告页上点开「高级」能看到证书的哪些字段？命令行对照：`curl -s -o /dev/null -w "%{http_code}\n" https://localhost:8443/` 与加了 `-k` 的同一条，退出码与状态码各是什么？对照：浏览器红警告（点「继续前往」后才是页面）、curl 不带 `-k` 退出码 60、带 `-k` 状态码 200。解释：服务端链路完全相同，变的只有客户端对这张自签证书的信任——生产环境把证书换成 CA 签发，这个差别就消失了，其他一概不动。

实验二（定向破坏）：改错一跳的端口。把 `nginx/nginx.conf` 里 `proxy_pass http://app:3000;` 改成 `http://app:3001`（只改这一处）。nginx.conf 是挂载进容器的文件，而 nginx 只在启动时读它——改完要让入口重读一遍：`docker compose -f compose.prod.yaml -p shiplog-prod restart nginx`。先猜二选一：入口 502，还是页面照常？再跑 `curl -sk -o /dev/null -w "%{http_code}\n" https://127.0.0.1:8443/api/health`。对照：502——nginx 活着、app 也 healthy（`docker ps` 可证），坏的是「反代到应用」这一跳的地址。哪条没变也值得看：`docker ps` 里三个容器都健康——这就是定位法的价值：502 从不说明「服务器挂了」，只说明「入口到后端这一段断了」，断点要一层层圈。复原：改回 3000，再 `restart nginx`，确认 200。

实验三（定向破坏）：抽走守护。把 `compose.prod.yaml` 里 app 服务那行 `restart: unless-stopped` 注释掉（只这一行），重新 `up -d --wait`。然后复刻演练的崩溃手法：`docker exec shiplog-prod-app kill -TERM 1`。先猜二选一：几秒内回到 200；还是持续 5xx 不恢复。每秒探一次 `curl -sk -o /dev/null -w "%{http_code}\n" https://127.0.0.1:8443/api/health`，探十次。对照：持续 502 或 504（本机引擎两种都可能出现——连接被拒是 502，连接挂起到超时是 504，都是「入口在、后端死」），`docker ps -a` 里 app 停在 Exited，`docker inspect` 的 RestartCount 不再增长。哪条没变：nginx 与 db 不受连坐，坏局被钉在 app 一个容器里。复原：解除注释、`down --volumes` 后重新起栈，用演练同款命令确认几秒内恢复 200。

实验四：两种「停」的待遇。栈在跑（restart 就位）。先执行 `docker stop shiplog-prod-app`，等 5 秒，看 `docker ps -a` 与入口状态码——先猜：容器自己回来了吗？再用 `docker start shiplog-prod-app` 拉起。对照：stop 之后容器停在 Exited，策略没有多管闲事——unless-stopped 里「除非被停」的 unless，尊重的正是这次手动停。追问一个：如果把维护场景写成「想停到明天」，用 stop 合适还是把 restart 改成 no 合适？（stop 是动作、作用于这次；改 no 是约定、作用于策略——临时维护用前者，长期下线才动后者。）收尾：`down --volumes`。

## 移交清单：真实服务器上的对应动作

本章的拓扑是「本地模拟的生产」，搬到一台真服务器上，动作如下。清单里每步都标了本地是否验证过——没验证的不装作验证过。

前提对照表，先对齐两套世界：

| 项 | 本地演练 | 真实服务器 |
|---|---|---|
| 入口端口 | 4181 / 8443 | 80 / 443 |
| 域名 | localhost、127.0.0.1 | 你买的域名（DNS A 记录指到服务器 IP） |
| 证书 | 自签（pnpm gen:cert） | Let's Encrypt 等 CA 签发 |
| 栈 | 本机 Docker Desktop | 服务器上的 Docker 引擎 |

1. 买一台云服务器，装 Docker 与 Compose 插件。装完 `systemctl enable docker`——让引擎本身开机自启，restart 约定才有意义（容器策略由引擎执行，引擎不跑，谁都别想起）。本地已验证等价物：Docker Desktop 常开。
2. 配 DNS：域名服务商处加 A 记录，指到服务器公网 IP。`dig 你的域名` 验证解析。本地无法验证——这是纯网络侧动作。
3. 收紧防火墙：`ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable`，SSH 之外只留两个 web 端口。数据库的 5432 本来就不映射宿主端口——拓扑替你省了一条规则。本地无法完整验证 ufw 行为（Windows 无 ufw；端口收敛的效果由 sim:prod 的「app 无宿主端口」断言部分覆盖）。
4. 把仓库拷上服务器，`compose.prod.yaml` 的 ports 两行改成 `"80:80"` 与 `"443:443"`，跑 `gen:cert` 先用自签证书把栈拉起来——和本地演练完全相同的步骤。
5. 换 CA 证书：安装 certbot 后一条链路——`certbot --nginx -d 你的域名`。它验证域名控制权、签发证书、改写 nginx 配置挂上新证书，并装好自动续期的定时任务。本地无法验证（需要公网可达的 80 端口与真实域名）；这是「自签换 CA」的机械替换点，链路其余不变。
6. 守护的裸机对照：如果哪天有个进程不适合容器化，systemd 单元是同款语义的另一种载体——`Restart=always` 的 unit 文件让 init 系统做保姆。本课主线全程用容器的 restart 约定，此条按了解记。

哪些是本地演练覆盖不到的，集中说一遍：DNS 生效、公网 80/443 的可达性、CA 签发与续期、ufw 的真实拦截行为——这四样只有真机能证明。「本地模拟拓扑 vs 真实 VPS」「自签 vs CA 证书」两组差异已登记到「简化与差异登记」附录，移交前对一遍那张表。

## 收束：三个现象，一张诊断地图

开篇那串现象现在可以逐个销案。「连接不是私密连接」——证书不在浏览器信任链：本地是自签的必然，生产由 CA 签发解决；链路本身（握手、挂载、终止位置）已在本地全量演练。「https 打不开」——443 上没有入口：nginx 就位后，这个端口有人应答，80 的流量被 301 送过来。「重启后没了」——没有守护：restart 约定把「进程自己死」拉起、把「人叫它停」留住，`502 → 200` 的两秒窗口就是它在岗的证据。

组装式一句话：应用栈（app 加 db 加卷）+ 容器健康检查（入口等后端转绿）+ 镜像（部署单元）+ 本章四块新积木 ⇒ 一个有正式入口的生产拓扑。旧积木一行未改地进了新拓扑——配置门卫的清单、迁移账本、健康探针，全部原样生效。

四块新积木，后面的章节都在调用：反向代理——统一接收 80/443、按规则转发，标准代理头还原客户端视角；TLS 终止——证书只配在入口一处，后端全程明文；自签名证书——本地演练 HTTPS 链路的可再生产物，生产换 CA；进程守护与重启策略——`restart: unless-stopped` 一行，崩溃自愈、叫停尊重。

最后送一张速查的诊断地图——「打不开网站」的四层定位法，每层一条命令，从外往里：

```text
# 502 / 打不开 的四层定位法（从外往里，哪层断在哪层修）
 1. DNS 层   ：dig 你的域名                → 解析到 IP 了吗
 2. 端口层   ：curl -v https://你的域名     → TCP 通吗、TLS 握手完成吗（退出码 7=没门，60=证书）
 3. 反代层   ：docker ps（nginx 在跑吗）    → 入口活着吗；502/504 说明断点在它身后
 4. 应用层   ：docker ps 看 app 是否 healthy，docker logs 看应用自己说什么
```

502 从来不是「服务器挂了」的意思——它精确地说明「入口活着，入口身后断了」。断点在哪一层，这张表两分钟圈出来。

两行去向：部署脚本将以这套生产拓扑为更新目标（第 9 章）；本地模拟与真实服务器的全部差异，在「简化与差异登记」附录集中对账。

## 自查

四道题，先合卷默答，再展开对照；卡壳的那道，答案末尾有回查指针。

<details>
<summary>1. 另一个团队不肯用反向代理：他们让 Node 应用自己加载证书、直接监听 443，nginx 只做 TCP 转发。TLS 终止发生在哪一层？至少列出两个由此多出来的成本。</summary>

终止发生在应用层（Node 进程里）。多出来的成本至少有：证书管理与续期进入每个应用的配置面，换证书要重启应用；健康探针与内部巡检也得讲 TLS 才能探到；传输层职责漏进业务工程，SSR、API 各配一遍；后端横向扩成多实例时证书要跟着复制。回查「TLS 终止：加解密停在门口」的反事实段。</details>

<details>
<summary>2. 用户报 502，你 SSH 登上服务器。按四层定位法，前两条执行的命令是什么？各自「一切正常」的输出长什么样？</summary>

第一条 `curl -v https://域名`——正常能看到 TLS 握手完成、响应头返回（502 恰恰证明这层通）。第二条 `docker ps`（或 `docker compose -f compose.prod.yaml ps`）——看 nginx 与 app 的状态，正常是都在跑且 app 为 healthy；app 若 Exited 或 unhealthy，断点已圈到应用层，接着 `docker logs` 取证。回查收束的四层定位表与实验二。</details>

<details>
<summary>3. 周五下班前，运维对生产栈执行了 docker stop shiplog-prod-app 做维护。周一发现容器没有自己起来。为什么 unless-stopped 没有把容器拉回来？周一恢复服务应该敲什么命令？</summary>

stop 是管理员的明确意图，unless-stopped 的语义就是尊重手动停止、不再拉起——这不是 bug，是策略与人的分工。恢复用 `docker start shiplog-prod-app`（或 `docker compose up -d`），随后探一下 https 入口回 200。回查「进程守护与重启策略」三值语义与实验四。</details>

<details>
<summary>4. 同事把 nginx/certs/server.key 提交进了仓库，理由是「下一台机器直接 clone 就能用，不用重新生成」。列出至少两个问题，并给出正确做法。</summary>

问题至少两个：私钥进入 git 历史，当前删掉也追不回，仓库的每个 fork、每次克隆、CI 的缓存都多一份泄漏面；而且这张自签证书本来就不该跨机器复用——它存在的意义只是本地把链路走通。正确做法是在新机器重跑 `pnpm gen:cert`，十秒一张新的；仓库里永远只留生成方式（.gitignore 已经挡了目录，误提交需要清理历史）。回查「自签名证书」一节与 .env 的同类纪律。</details>
