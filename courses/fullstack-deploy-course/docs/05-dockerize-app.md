---
title: 容器化：多阶段构建与一键应用栈
---

# 容器化：多阶段构建与一键应用栈

代码在本地好好的，部署日却总有新剧情：服务器上装依赖从半小时起跳；好不容易装完，进程起不来，报的是某个原生模块的错——本机安装目录里那个二进制是给 Windows 编译的，服务器的 Linux 加载不了；换台机器重来，端口又被占了。三件事凑在一起，「在我机器上能跑」就成了行业笑话的固定开头：这句话说的全是实话，却句句只在你的机器上成立。「装依赖半小时」也不全是网慢：每次部署都在让一台新机器从零回答「这套代码依赖什么、每个依赖要为这个平台编译成什么」——这个问题每台机器各答一遍，答案还不总一样。

说这话的人并不算错，错的只是账算得不全。开发机确实凑齐了运行这套代码的全部条件：对的 Node 版本、对平台编译的依赖、恰好空闲的端口。麻烦在条件没法跟着代码一起交付。此前的章节已经收走了一半：部署交付的是自包含的构建产物，不再需要工程目录与开发依赖；环境差异走运行期注入，换环境不用重建产物。还剩两件：目标机器必须装了版本相符的 Node；应用与数据库这套「多服务拓扑」得靠手工一条条拼起来。

本章把这两件也铸进交付物。五块新积木：多阶段构建、镜像层缓存、非 root 运行、容器健康检查、Compose 应用栈。收尾的门槛是一条命令：构建镜像、拉起整套应用栈、等待健康、跑完落库往返断言、拆除并验证清理——全程无需人在场，任何一个环节不达标都以非 0 退出码收场。

## 工具箱

本章调用四块旧积木。

部署单元——一次部署交付的最小整体，本课此前是一个自包含的 .output：代码、依赖、运行时一起换版本（第 1 章）。本章给它升级：连「机器」一起打包。

构建期与运行期配置——判定口诀「换环境会不会变」：会变的走运行期，构建完成后仍可注入（第 3 章）。本章是这条分界线最重的一次落地：镜像在构建期铸成，环境在容器启动时注入。

环境变量注入——NUXT_ 前缀的环境变量在进程启动时覆盖 runtimeConfig 的键（第 3 章）。本章的注入方从 shell 换成容器编排，变量名一个字母都不用改。

fail-fast 配置校验——缺配置的进程带清单退出非 0，不带病上岗（第 3 章）。本章它的观众多了一个：容器编排器——负责拉起并看管容器的工具（本章就是 Docker Compose）——看得见退出码。

## 镜像：把凑齐条件的那台机器铸成文件

镜像——一个自包含的只读文件包：Node 运行时、依赖、应用产物都封在里面，任何装了容器引擎的机器都能原样把它跑起来。容器——镜像的一次运行实例：从镜像起步，加上一层可写的进程空间。可以把它想成「把 node_modules 和运行环境一起打包的行李箱」：拖到哪台机器都行，打开就是原来收拾好的样子。Dockerfile 是镜像的构建脚本：一行指令描述一步「在这台从零装环境的机器上做什么」，构建引擎照着执行，产出镜像。

先做个反事实，看它解决的是哪一环。没有镜像时，让代码在新机器上跑起来，需要对齐一串条件：装哪个版本的 Node、依赖要为哪个操作系统与 CPU 架构编译、系统库里有没有缺的共享库、端口是否空闲。每台机器对齐一遍，每次部署重复一遍，任何一处漂移都是一次排障。构建产物解决了「代码与依赖」的自包含（第 1 章），但把「装了 Node 的机器」留成了前提；镜像把最后这个前提也收进交付物：运行时、产物、进程环境一次铸好，之后换机器只是「拿同一个文件去跑」。

反方向也要检验：镜像不是把开发机整个克隆。它从一份几行的 Dockerfile 出发，只装声明过的东西——这正是它比「机器快照」可复现的原因：任何人拿着同一份 Dockerfile 与同一份源码，构建出行为一致的镜像。

构建从「上下文」开始。`docker build` 发送给引擎的不是你的整块磁盘，而是一个划定目录的快照（构建上下文）；Dockerfile 里的 COPY 拷的是上下文里的文件，不是磁盘上的文件。这给了第一道安全边界：.dockerignore 在门口裁掉不该进上下文的东西。本课工程的这份守门文件全文如下。

```text
# companion/.dockerignore · 构建上下文的门卫：列在里面的东西不进上下文，也就不进任何镜像层
# （上下文是发送给 docker build 的文件集合——COPY . . 拷的是「上下文里的 . 」，不是磁盘上的 . ）

# 宿主机的安装与构建结果：换环境要重算，拷进去还会污染层缓存、撑大上下文
node_modules
.output
.nuxt

# 密钥：.env 不进上下文——进了就会随 COPY . . 躺进 builder 段的镜像层（正文有泄漏演示）
.env

# 与镜像无关的本机资产：测试与脚本不参与 nuxt build
tests
scripts
```

三行 `node_modules`/`.output`/`.nuxt` 守的是正确性：宿主机的安装与构建结果属于宿主机，拷进镜像既撑大体积，又会盖住容器内重新计算的版本。`.env` 那行守的是密钥——仓库侧的纪律是它永不入库（.env 与密钥管理那套），镜像化之后多一条平行纪律：不进构建上下文。它一旦进了上下文，就会随 `COPY . .` 进到构建阶段的镜像层里——这一步的代价与演示放在验证一节，先记住结论：**.env 的边界在上下文门口，不在最终镜像里**。

## 多阶段构建：工具链不登船

多阶段构建——Dockerfile 分阶段执行：安装与构建阶段带着完整工具链（pnpm、devDependencies、源码），运行阶段只拷产物与生产必需。最终镜像因此又小，又与源码、构建工具不沾边。

为什么必须分阶段？做个反事实：把整段构建塞进一个阶段、直接拿它当最终镜像。「镜像里带上源代码和 devDependencies 才能跑」这个直觉先说句公道话：它来自本机开发的经验——本地跑测试、跑类型检查，确实要完整的 node_modules。不成立的边界在「谁需要」：需要工具链的是生产构建这个动作，不是运行这个进程。构建产物自带被追踪的运行期依赖，node 直接启动（第 1 章的产物形态），不需要工程的 node_modules，更不需要 devDependencies。带上它们，镜像从「能跑的最小集」膨胀成「能开发的全家桶」——更大、更慢、攻击面更宽，源码也一并进了生产。

本课工程的三段式 Dockerfile 全文如下（注释略有精简，终态见 companion）。

```dockerfile
# companion/Dockerfile · 三阶段构建：deps（装依赖）→ build（nuxt build）→ run（只带产物）
#
# 设计要点（本章逐条展开）：
#   1. 层缓存顺序：先拷 package.json + pnpm-lock.yaml 装依赖，后拷源码——
#      改一行源码重建时，依赖层命中缓存，跳过重装（「装依赖半小时」的解药）。
#   2. 多阶段：工具链（pnpm、devDependencies、源码）只活在 deps/build 两段；
#      run 段只 COPY 产物 .output——最终镜像里没有源码，也没有构建工具。
#   3. 非 root：USER node 让进程拿不到容器内最高权限。
#   4. HEALTHCHECK：周期探 /api/health，unhealthy 的容器会被 compose --wait 拦下。

# ── 段一 deps：清单不变，依赖层就不重建 ───────────────────────────────────────
# node:22-alpine 与本课 Node 22 运行时对齐；alpine 变体小，够跑 Node 服务。
FROM node:22-alpine AS deps
WORKDIR /app
# corepack 读 package.json 的 packageManager 字段，激活钉死版本的 pnpm——
# 容器里的包管理器与宿主机严格同版，lockfile 语义才一致。
RUN corepack enable
# 只拷清单，不拷源码：这两行不变，下面的 install 就命中缓存
COPY package.json pnpm-lock.yaml ./
# --frozen-lockfile：锁文件与清单不一致就失败，不允许容器里悄悄改依赖
RUN pnpm install --frozen-lockfile

# ── 段二 build：跑生产构建，产出 .output ─────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
# 依赖从 deps 段整体搬来（含 devDependencies：nuxt build 需要完整工具链）
COPY --from=deps /app/node_modules ./node_modules
# 源码最后进场：它的任何改动只会使 build 段之后的内容失效，依赖层安然无恙
COPY . .
RUN pnpm build

# ── 段三 run：最终镜像，只有运行产物 ─────────────────────────────────────────
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
# 监听边界写明白：容器内进程必须绑 0.0.0.0（绑 127.0.0.1 则端口映射打不进来）
ENV HOST=0.0.0.0 PORT=3000
# .output 自带被追踪的运行期依赖，不需要工程的 node_modules（第 1 章的产物形态）
COPY --from=build --chown=node:node /app/.output ./.output
# 先降权再声明入口：此后的进程（含 HEALTHCHECK 的探测命令）都以 node 用户跑
USER node
EXPOSE 3000
# 探活：200 才算健康。start-period 给进程冷启动宽限，期间失败不计入重试
HEALTHCHECK --interval=3s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? '3000') + '/api/health').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["node", ".output/server/index.mjs"]
```

机制三句话。`FROM ... AS` 给每段起名，段与段各自独立执行。`COPY --from=deps` 让后段取用前段的产物——依赖从 deps 段搬进 build 段，不重装。最终标记成镜像的只有 run 段，前面两段是脚手架，用完即弃。`--chown=node:node` 顺手把产物的属主改成 node 用户——run 段里即将降权的那位，别让它连读自己的产物都要借 root 的权限。

段的分工拿实测数字看最直白。本机构建后两个镜像并排：

```text
# docker images（真实输出）
shiplog-stack-app:latest      235MB   # run 段：基镜像 230MB + 产物层 4.9MB
shiplog-stack-migrate:latest  707MB   # build 段（借出的工具镜像，见 Compose 一节）
```

应用镜像只比裸的 node:22-alpine 大 5 MB 左右——那正是 .output 的体积。707 MB 的工具镜像里躺着什么？进去看一眼（.dockerignore 生效后的真实清单）：

```text
# docker run --rm shiplog-stack-migrate:latest sh -c 'ls -a /app'（真实输出）
.  ..  .dockerignore  .env.example  .gitignore  .nuxt  .output
Dockerfile  app  compose.db.yaml  compose.yaml  node_modules  ...
```

源码、完整 node_modules、容器内重新构建出的 .nuxt 与 .output——开发全家桶，一个不少；而 `.env` 不在名单里（`.env.example` 模板在，它本来就是要公开的）。两个镜像一对比，多阶段构建的账就清楚了：**工具链留在岸上，船上只装产物**。

## 镜像层缓存：顺序就是速度

镜像层缓存——Docker 按指令缓存构建结果：每条指令产出一层，指令文本与输入文件不变就复用旧层，变了则该层连同其后所有层重建。

成因是重装的代价。「每次部署 npm install 半小时」的痛，不在于 install 本身慢，而在于它被反复触发：改一行页面代码就要重装全部依赖，等于为一次拼写修改付一次全款。层缓存把这笔账拆开：依赖安装与源码拷贝是两条独立指令。只要「装依赖」那条指令的输入（清单与锁文件）没变，它就直接复用上次的层——那条指令就是 RUN pnpm install，源码变化根本碰不到它。

载体是指令顺序。Dockerfile 里 `COPY package.json pnpm-lock.yaml` 与 `RUN pnpm install` 排在 `COPY . .` 之前——清单先行、源码殿后。这不是代码洁癖，是把「变得慢的输入」与「变得快的输入」分进不同的层：依赖清单几天变一次，源码一天变几十次。

演算用本课工程的实测（你的绝对数字会随机器与网络浮动，不变的机制是「哪一层重跑」）。冷构建一把尺子：

```text
# docker compose build --no-cache app（真实输出节选；整体 33.7s）
#10 [deps 5/5] RUN pnpm install --frozen-lockfile
#10 DONE 15.0s
#13 [build 6/6] RUN pnpm build
#13 DONE 11.8s
```

改一行页面源码再构建（往首页说明文字里加一个词）：

```text
# docker compose build app（真实输出节选；整体 12.7s）
#10 [deps 5/5] RUN pnpm install --frozen-lockfile
#10 CACHED
#12 [build 5/6] COPY . .
#12 DONE 0.0s
#13 [build 6/6] RUN pnpm build
#13 DONE 10.9s
```

`#10 CACHED` 就是全部答案：依赖安装整层复用，重跑的只有源码拷贝与 nuxt build。第三个输入做对照——只往 pnpm-lock.yaml 尾部加一行注释再构建：

```text
# docker compose build app（真实输出节选；整体 37.8s）
#9 [deps 4/5] COPY package.json pnpm-lock.yaml ./
#9 DONE 0.0s
#10 [deps 5/5] RUN pnpm install --frozen-lockfile
#10 DONE 21.9s
```

锁文件变了，清单那层失效，install 连同其后所有层重建。尽管依赖关系其实一个没动——install 自己也报了 Lockfile is up to date, resolution step is skipped。三种输入、三种命运，钉在同一根钉子上：**层的输入变没变，决定它重跑还是复用；顺序决定谁是输入**。

反过来就能诊断「顺序颠倒」的 Dockerfile：如果 `COPY . .` 排在 install 之前，源码就成了依赖层的输入——改任何一行代码，install 必然重跑。开篇那句「装依赖半小时」在容器世界的翻版，多半就是这么写出来的。顺带一提，`docker compose build --profile tools` 一次构建两个目标（应用镜像与工具镜像）。migrate 服务声明了 profiles: [tools]，不带 profile 的 build 会跳过它——它实际在首次 `--profile tools run --rm migrate` 时隐式构建。两个目标共享 deps/build 段：第二个目标的共享段全部 CACHED，只多花十几秒导出层。阶段共享本身就是缓存的又一次兑现。

## 非 root 运行：一行换一个攻击面

非 root 运行——容器内进程用低权限用户跑：容器一旦被攻破，攻击者拿到的也只是普通用户权限，而不是容器内的 root。

先替「容器里用 root 也无妨」说句公道话：容器本身有隔离，教学与本地实验里离攻破场景确实很远，而且多数镜像默认就是 root 起步——不改也能跑，一切功能照旧。不成立的边界在失败模式的代价：应用一旦出现远程代码执行类漏洞，攻击者拿到的身份就是进程的身份。root 在容器内对文件系统与挂载卷有全部权限，是向宿主机横移的更高起点；普通用户至少把「在容器里随意写文件、提权尝试」变成一道墙。这是与「密钥不进仓库」同级的例行纪律：习惯成本一行（USER node），换掉的是最坏情况的下限。

载体在 Dockerfile 的两处。`COPY --from=build --chown=node:node` 把产物属主交给 node 用户——node:22-alpine 自带 uid 1000 的这个用户，不用自己建；`USER node` 声明此后的一切——ENTRYPOINT 起的进程、HEALTHCHECK 的探测命令——都以该用户执行。证据一行命令：

```text
# docker compose exec -T app whoami（真实输出）
node
```

## 容器健康检查：让编排器看得见「能服务」

容器健康检查——对容器周期性执行一段探测（HTTP 请求或命令），按退出码判定健康与否：0 健康，1 不健康；不健康的容器，编排器会标记、等待或拒绝。

成因是「在跑」与「能服务」的差距。编排器本来就知道容器死没死（进程退出它看得见），但它看不见进程的内部状态：进程活着、端口却在挂掉边缘、依赖已经连不上——这些只有应用自己知道。健康检查给应用开了一扇对机器说话的窗：一个便宜的、语义明确的探针端点。db 服务上其实已经挂着一个先例——pg_isready 探针，`--wait` 等的就是它转绿；本章给应用补上同等的设施。

载体有三件。其一，探针端点本身：

```ts
// companion/server/api/health.get.ts · 全文
// HEALTHCHECK / 编排器的 --wait 探的都是这里：200 + {status:"ok"} —— 进程活着且能应答 HTTP。
// 探测是周期性的（interval 3s），所以这个端点必须便宜：不查数据库、不做业务逻辑
// ——「数据库能不能连」是另一类健康信号（分级讨论在生产加固一章）。
// appEnv 顺带回报：健康检查响应本身成了环境变量注入的活证据。
export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  return { status: 'ok', appEnv: config.public.appEnv }
})
```

四行，走的是既有积木的接口：文件路径即路由（server API），公有配置随环境注入（环境变量注入）。它刻意不碰数据库——探针每三秒打一次，贵了拖垮自己；「活着」与「能接活」是两个问题，分开讨论（生产加固一章）。其二，Dockerfile 的 HEALTHCHECK 指令，四个参数各管一段：`interval` 探测周期；`timeout` 单次探测的限时；`start-period` 启动宽限期，期间的失败不计入重试，给冷启动留时间；`retries` 连续失败多少次才判不健康。其三，消费方：`docker compose up -d --wait` 会等到所有服务 healthy 才返回——有健康检查的服务等 healthy，没有的等 running；等不到就以非 0 退出。

这套设施的严格之处，演练里会让你亲眼看到：探针 404 时，编排器拒绝宣布「起来了」。

## Compose 应用栈：一份文件描述整套拓扑

Compose 应用栈——用一份 compose.yaml 声明多服务应用（应用、数据库、反代）及其网络、卷、依赖关系与健康等待，一条命令拉起整套拓扑。成因还是排障成本：应用、数据库、网络别名、启动顺序、健康等待，手工拼要五六个步骤，错一步的症状要绕很远才浮出水面；写成声明，拓扑本身成了可审查、可版本化的文件。

你手里已经有一份只起单个服务的编排（compose.db.yaml 起开发库）。本章的栈是它的完整形态，全文如下（注释略有精简，终态见 companion）。

```yaml
# companion/compose.yaml · 应用栈：app + db 一键拉起（pnpm compose:sim 走这里）
#
# 与 compose.db.yaml 的分工：
#   compose.db.yaml —— 开发库：宿主端口 54329，给 pnpm dev / vitest / psql 用；
#   compose.yaml    —— 应用栈：app + db 整套拓扑，db 不映射宿主端口（只有栈内网络可达）。
# 项目名刻意不同（shiplog vs shiplog-stack）：两套容器、两个卷互不干扰，可同时运行。
name: shiplog-stack

services:
  app:
    build:
      context: .        # 构建上下文是本目录（.dockerignore 在同门口生效）
      target: run       # 用 Dockerfile 的 run 段作为最终镜像（多阶段构建的出口）
    container_name: shiplog-stack-app
    environment:
      # 同一变量、不同值：宿主开发走 127.0.0.1:54329，容器内走服务名 db:5432——
      # db 是 compose 网络里的服务名主机名，只有栈内解析得到
      NUXT_DB_URL: postgres://ship_log:ship_log@db:5432/ship_log
      # 演一套「非本机」的环境名：页面上会显示 staging，证明变量真的注入了容器
      NUXT_PUBLIC_APP_ENV: staging
    ports:
      - "4180:3000"     # 宿主 4180 → 容器 3000（41xx 段避开常用端口）
    depends_on:
      db:
        condition: service_healthy   # db 健康检查转绿之前，app 不起

  db:
    image: postgres:16-alpine        # 与开发库同版本：同一家 PostgreSQL，两处编排
    container_name: shiplog-stack-db
    environment:
      POSTGRES_USER: ship_log
      POSTGRES_PASSWORD: ship_log
      POSTGRES_DB: ship_log
    # 注意没有 ports：这座库不暴露给宿主机，只在栈内网络提供服务
    volumes:
      - db-data:/var/lib/postgresql/data   # 数据放卷里：容器删了重建，数据仍在
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ship_log -d ship_log"]
      interval: 2s
      timeout: 3s
      retries: 15

  # 一次性迁移执行器：借用 Dockerfile 的 build 段（那里有完整工具链与迁移账本），
  # 在栈内网络跑与宿主机同一条 drizzle-kit migrate。profiles 让它不随 up 启动，
  # 只被 docker compose run --rm migrate 显式调用。
  # 简化声明：迁移时机（起前跑 vs 启动时跑）此处按最简可行执行，完整取舍在数据库运维一章。
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

四个机制值得逐个点名。

服务名就是主机名。栈内 app 连数据库的地址写的是 `db:5432`——不是 IP，是服务名：同一个 compose 项目里的容器互相用服务名解析。于是 NUXT_DB_URL 出现了两个合法值：宿主开发是 `postgres://…@127.0.0.1:54329/…`，栈内是 `postgres://…@db:5432/…`。同一个变量名、两套拓扑、零改码零重建——运行期配置那套判定术的第二次兑现。连接串换环境会变，所以它活在注入里：启动时新值喂给连接池，镜像一字不动。顺带注意 db 服务没有 ports 映射：这座库只对栈内开口，「数据库不暴露给宿主机」是生产拓扑的基本姿势，本地栈从第一天就这么摆。

数据卷——把持久数据挂进容器生命周期之外的存储：容器销毁重建，卷里的数据仍在。成因在容器文件系统的天性：它随容器生、随容器死，`docker compose down` 删掉容器时一并蒸发——对无状态的应用无所谓，对数据库就是灾难。载体是 volumes 两处声明：db 服务把 PostgreSQL 的数据目录挂到卷 `db-data` 上，顶层再声明这个卷。演算是演练幕二的断言：写进库的记录活过一次 down/up；反事实也在断言里——如果数据落在容器文件系统上，幕二必然一条不剩。

健康等待把拓扑串成顺序。app 的 `depends_on` 写了 `condition: service_healthy`：db 的探针没转绿之前，app 容器根本不创建。加上 `up -d --wait` 自己等 app 健康，一条命令的实际语义是「起库 → 等库好 → 起应用 → 等应用好」，失败在任何一站都当场退出非 0。

两份编排文件的取舍。保留 compose.db.yaml、新立 compose.yaml，而不是把 db 合并进一份加开关：两者的读者场景不同。开发时要的是三秒起一座宿主可达的库（dev、集成测试、psql 都连 54329），栈演练时要的是完整拓扑与网络隔离。项目名不同（shiplog 与 shiplog-stack），容器名、网络、卷全部错开，两套可以同时跑。合并成一份固然少一个文件，但换来的是每次起开发库都拖着 profile 开关——教学上不值。

迁移的执行方案如实交代简化。迁移账本由 Drizzle schema 生成，躺在 server/db/migrations；生成与执行它的工具 drizzle-kit 在 devDependencies 里。两样东西都在 build 段的工具镜像中。于是 migrate 服务借用那个镜像，在栈内网络跑与宿主机完全相同的一条 schema 迁移命令：`node node_modules/drizzle-kit/bin.cjs migrate`。同一份账本、同一个 journal，连的库换成栈内的 db。`profiles: [tools]` 让它不随 `up` 启动，只在显式 `run --rm` 时出现，跑完即走。它执行的位置是「应用起之前」——这与部署主线的顺序（先迁移、后换版本）同构。这个时机的完整论证（前置与内嵌的失败窗口对比）是数据库运维一章的正题，本章按最简可行执行。

## 演练：从 unhealthy 到全绿

先交代本章的改动面。新增五件：Dockerfile、.dockerignore、compose.yaml、server/api/health.get.ts、scripts/compose-sim.mjs（登记为 `pnpm compose:sim`）；package.json 补 `packageManager` 字段与一条 script。既有代码一行未动——迁移账本、域逻辑、配置门卫原样进镜像。

门槛命令在本课全部既有门槛之上新增一件：

```bash
# 用法示例 · companion 目录内
pnpm compose:sim   # build → up --wait → 迁移 → e2e → down，一键应用栈演练
```

### 红：进程活着，编排器不认

Dockerfile 与 compose.yaml 就位，但应用还没有 /api/health——这不是遗漏，是本章的红。构建镜像、起库、跑迁移、起应用，一路顺利，直到 `--wait`：

```text
# docker compose up -d --wait（真实输出节选）
 Container shiplog-stack-db Healthy
 Container shiplog-stack-app Started
 Container shiplog-stack-app Waiting
container shiplog-stack-app is unhealthy
```

退出码 1。此刻值得看三个视角，它们拼出完整的现场。应用自己的日志——进程不但活着，配置门卫还通过了：

```text
# docker logs shiplog-stack-app（真实输出）
[config] 必需配置校验通过（appEnv=staging）
Listening on http://0.0.0.0:3000
```

宿主侧访问首页——200，页面正常，连注入的 staging 都渲染出来了；但探针端点：

```text
# curl -s http://127.0.0.1:4180/api/health（真实输出，节选）
{
  "error": true,
  "url": "http://127.0.0.1:4180/api/health",
  "statusCode": 404,
  "statusMessage": "Page not found: /api/health",
```

健康检查的内部记录——每次探测退出码 1：

```text
# docker inspect --format '{{json .State.Health.Log}}' shiplog-stack-app（节选）
{"ExitCode": 1, …} {"ExitCode": 1, …}
```

三份证据读同一件事：进程健康地跑着，页面健康地服务着，但编排器问的是另一个问题——「你的探针端点应 200 了吗」——而它得到的是 404。红得其所：要的能力（机器可读的健康信号）尚不存在，而不是网络不通、配置不对。也注意这套红里 db 一直是 Healthy：失败被钉在正确的层，没有殃及邻居。

### 转绿：四行端点

补上前面「容器健康检查」一节的那份 server/api/health.get.ts——四行代码，全部由既有积木组装。文件一进源码树，重建只剩源码层：

```text
# pnpm compose:sim 的构建步骤（真实输出节选）
#10 [deps 5/5] RUN pnpm install --frozen-lockfile
#10 CACHED
#13 [build 6/6] RUN pnpm build
…
[sim] 镜像构建完成（11.6s）
```

依赖层 CACHED——加一个端点不需要重装任何依赖，层缓存那张账又一次兑现在眼前。新文件同时被 `pnpm typecheck` 纳入检查（绿）；不新增单测——handler 行为由栈级 e2e 断言承载，这是编排章的测试形态。再跑一轮完整演练（这一轮源码未再变，构建全程命中缓存）：

```text
# companion/scripts/compose-sim.mjs 的运行输出：pnpm compose:sim（真实）
[sim] 第 5 章应用栈演练开始（Docker + Compose 需在运行）
[sim] 镜像构建完成（1.3s）——run 段只含 .output，build 段是工具镜像
[sim] 数据库健康（3.0s）—— 栈内地址 db:5432，不映射宿主端口
[sim] 应用健康（6.4s）—— HEALTHCHECK 已探明 /api/health 返回 200
[sim] /api/health → 200 {status:"ok", appEnv:"staging"}（环境变量真的注入了容器） → PASS
[sim] 容器以非 root 运行（whoami = node） → PASS
[sim] 镜像里只有产物（/app = .output），无 .env、无源码 → PASS
[sim] GET / → 200，页面显示环境 staging（公有配置随容器注入） → PASS
[sim] GET /api/deploys → []（迁移建好的空表，尚未种数据） → PASS
[sim] POST /api/deploys → 201 {id:1}（容器内应用写进栈内数据库） → PASS
[sim] 落库往返：GET 读回新记录，首页裸 HTML 含 "c0ffee5"（SSR 走的栈内 db） → PASS
[sim] 幕二：down 拆除容器（保留卷）→ 重新 up，数据必须活过容器删除
[sim] 容器删了重建，卷中数据仍在（1 条，含 "c0ffee5"） → PASS
[sim] 全部断言通过 (8/8)
[sim] 收尾：docker compose down --volumes（还端口、还容器名、清卷）
[sim] 端口 4180 已释放，shiplog-stack-* 容器已清空 → 收尾 PASS
```

输出值得停一分钟细读。「落库往返」一行里，POST 写入的记录出现在首页裸 HTML 中——不执行 JS 的客户端也拿得到它，这是 SSR 的证据：渲染发生在栈内的 Node 进程里，读的也是栈内的库。而「whoami = node」「无 .env、无源码」两条断言，把本章的防线从「写在文件里」变成「门槛每跑一次就重新证明一遍」。

脚本本身是纯编排逻辑，值得看的只有骨架（全文在 companion/scripts/compose-sim.mjs，约两百行）：

```js
// companion/scripts/compose-sim.mjs · 节选：七步流程（断言细节从略）
// 0. 预清理 down --volumes（上次失败的栈先拆干净，每次演练从全新卷出发）
// 1. compose build        —— 多阶段镜像（app 出口 run 段；migrate 借 build 段）
// 2. compose up -d --wait db —— 只起库，等 pg_isready 转绿
// 3. compose --profile tools run --rm migrate —— 栈内跑迁移账本
// 4. compose up -d --wait —— 起 app，等 HEALTHCHECK 转绿
// 5. e2e 断言（/api/health、whoami、镜像内容、页面、落库往返）
// 6. 幕二：down（保留卷）→ up --wait → 断言数据仍在
// 7. finally：down --volumes + 验端口已释放、shiplog-stack-* 容器已清空
```

两个设计决定说一下。断言失败不直接退出进程——收尾拆除放在 finally，失败的运行同样还端口、清容器，与既有 e2e 脚本的纪律一致。Windows 上有一条额外教训值得留档：容器显示 Healthy 只证明「容器内探针通」，宿主侧的端口代理在 up 后的瞬间可能仍会拒绝连接，所以断言前脚本先轮询宿主可达。「容器内健康」与「宿主可访问」是两个时刻。

既有门槛全数复跑无回退：typecheck、test（15 条）、build、e2e:ch1 到 e2e:ch4、db:up/db:down 体系照常，新文件没碰开发库的编排。

## 验证：先猜，再跑

四组实验，每组先把预测押在纸上（离散值：CACHED 还是重跑、几条记录、二选一），再动手对照。

实验一：层缓存的三种输入。往 app/pages/index.vue 的说明文字里加一个词，跑 `docker compose -f compose.yaml -p shiplog-stack build app`。先猜：`RUN pnpm install --frozen-lockfile` 那一步显示 CACHED 还是重跑？总耗时与 33.7s 的冷构建比差多少？对照：CACHED，约 12.7s——重跑的只有源码拷贝与 nuxt build。变体两连：先往 pnpm-lock.yaml 尾部加一行 `# note` 再 build（install 重跑，约 37.8s，锁文件是慢层的钥匙），再 `git checkout -- pnpm-lock.yaml` 复原。最后 `docker compose build --no-cache app` 看全冷重建（约 33.7s）。解释：三层输入各不相同——源码、锁文件、无缓存——层的命运由输入单独决定，这正是把清单与源码分层的原因。

实验二（定向破坏）：拆掉 .env 的门。把 .dockerignore 里 `.env` 那一行注释掉（只改这一行），构建工具段并读取：

```bash
# 用法示例 · companion 目录内
docker build --target build -t leak-demo:tmp .
docker run --rm leak-demo:tmp sh -c 'cat /app/.env'
```

先猜：cat 打印「No such file or directory」还是打印出文件内容？二选一，再跑。对照：.env 的全部内容原样打印——注释、连接串、环境名都在（本课是教学假凭据；换成一串生产密钥，同样的命令就是泄漏现场）。哪条没变也值得看：最终应用镜像（run 段）仍然不含 .env——多阶段把密钥挡在了最终交付物之外。所以这是两道门各守一段：.dockerignore 守「进不进上下文与中间层」，多阶段守「进不进最终镜像」。而 builder 段的中间镜像就躺在本机镜像缓存里，任何能跑 docker 的人都能 cat——第一道门不能省。复原：去掉注释，重新 `docker build --target build -t leak-demo:tmp .` 再 cat——No such file or directory；`docker rmi leak-demo:tmp` 清掉演示镜像。

实验三（定向破坏）：抽走容器的连接串。把 compose.yaml 里 app 服务的 `NUXT_DB_URL:` 一行注释掉（只这一行；migrate 服务那行别动），然后：

```bash
# 用法示例 · companion 目录内
docker compose -f compose.yaml -p shiplog-stack up -d --wait db
docker compose -f compose.yaml -p shiplog-stack up -d --wait
```

先猜三选一：全绿等到底；等待超时；当场失败并指认容器。跑完再看 `docker logs shiplog-stack-app`——输出是哪两行？对照：

```text
# docker compose up -d --wait（真实输出节选）
container shiplog-stack-app exited (1)

# docker logs shiplog-stack-app（真实输出）
[config] 必需环境变量校验失败（1 项）：
  - NUXT_DB_URL: 缺失（未设置）
```

当场失败，退出码 1；日志正是那份一次报全的清单——它在进程里管「不带病上岗」，在容器外面管「不让坏容器上岗」。哪条没变：db 照常 Healthy。复原：解除注释，重跑本节两条命令，确认回到全绿，然后 `docker compose -f compose.yaml -p shiplog-stack down --volumes`。

实验四：卷的生死线。手动走一遍栈的完整回合：`up -d --wait db` → `--profile tools run --rm migrate` → `up -d --wait`，然后写入一条记录并读回（POST 仍过请求校验那道门，body 不合法照旧 400）：

```bash
# 用法示例 · companion 目录内（栈在跑；POST 的形状与边界校验规则同 /api/deploys 一贯）
curl -s -X POST http://127.0.0.1:4180/api/deploys -H 'content-type: application/json' \
  -d '{"env":"staging","status":"success","commit":"feedbac","summary":"卷实验：活过 down/up"}'
curl -s http://127.0.0.1:4180/api/deploys
```

GET 确认 1 条后，`docker compose -f compose.yaml -p shiplog-stack down`（不带 --volumes），再 `up -d --wait`，GET。先猜：现在是几条？对照：1 条——容器销毁重建，卷把数据原样交回。变体追问：如果那一步是 `down --volumes`，重跑迁移之后 GET 是几条？（0 条：迁移重放的是结构，数据随卷蒸发——「删卷」与「删容器」是两个量级的动作，备份是另一条防线。）收尾：`down --volumes`。

## 收束：把「我的机器」变成交付物

开篇那串剧情现在可以逐句销案了。「装依赖半小时」——依赖安装被铸成独立的镜像层，只在清单或锁文件变化时重算，改一行源码的重建里它是 CACHED；绝对耗时随机器与网络浮动，不变的机制是「哪一层重跑」。「node_modules 拷过去缺原生依赖」——镜像里的依赖是在目标平台（Linux 容器）内现场安装、现场编译的，从不再跨机器搬运安装目录。「端口冲突」——栈有自己的网络与固定的宿主映射（4180），多服务拓扑写进声明文件，起停一条命令。「在我机器上能跑」——能跑的那台机器，连同 Node 运行时、产物、健康探针一起，被打包成了镜像：换任何一台装了容器引擎的机器，都是同一个文件、同一份行为。

组装式一句话：**部署单元（.output）+ 运行期注入（compose 的 environment）+ fail-fast（缺配置即退出）+ 本章五块新积木 ⇒ 镜像化的一键应用栈**。老积木一行未改地进了容器——配置门卫的清单、迁移账本、落库往返断言，全部原样生效，这是「只换底座、不动门面」的又一次机械证据。

本章落成的五块积木，后面的章节都在调用：

- 多阶段构建——deps/build/run 三段，工具链不登船，最终镜像只含产物与运行必需；
- 镜像层缓存——指令输入定复用，清单先行、源码殿后；
- 非 root 运行——USER node 一行，压低容器被攻破时的下限；
- 容器健康检查——HEALTHCHECK 周期探针加 /api/health，编排器据此等待与拒绝；
- Compose 应用栈——compose.yaml 声明整套拓扑，`up -d --wait` 拉起、`down` 拆除，数据活在卷里。

两行去向：栈的前方加入 Nginx 反向代理与 TLS（第 6 章）；镜像构建这步进入 CI 流水线（第 8 章）。

## 自查

四道题换了团队与情境。先合上本章默答，再展开对照；卡壳的那道，答案末尾带着回查指针。

<details>
<summary>1. 同事的单阶段 Dockerfile 把 COPY . . 写在了 npm install 之前。每次改一行源码，CI 上的镜像构建都要七八分钟。哪条指令的输入里包含了源码？为什么 install 永远重跑？改成分层后，哪些步骤能 CACHED？</summary>

COPY . . 的输入是全部源码（.dockerignore 排除项之外），而它排在 install 之前，源码就成了 install 层的上游输入。改任何一行代码，COPY 层失效，其后所有层（含 install）连带重建。分层后（先拷 manifest 与 lockfile 装 deps、再拷源码构建），改源码时 deps 段与 install 全部 CACHED，重跑的只有源码拷贝与构建段。回查「镜像层缓存」一节三种输入的对照。</details>

<details>
<summary>2. 另一个团队的镜像健康检查探的是 GET /（首页，SSR 且读数据库），而不是独立探针。列出至少两个后果。</summary>

至少可以说：其一，探针贵——首页要走完整渲染与数据库往返，每三秒打一次是稳定的自压测；其二，语义混淆——「进程活着」与「依赖可用」被绑在一个答案上，数据库抖动会让编排器判定应用不健康，而此时的正确处置未必是重启应用；其三，首页改版（重定向、加缓存）可能悄悄改变探针语义。回查「容器健康检查」关于端点要便宜的论证。</details>

<details>
<summary>3. 为了本机调试方便，有人给 compose.yaml 的 db 服务加了 ports: "54330:5432"，让 psql 直连栈内库。这个改动换到了什么、付出了什么？如果要保留它，什么姿势更稳？</summary>

换到宿主直连的便利（psql、图形客户端、手工查询）。付出的是：栈内拓扑对宿主机开了口子，「数据库只在网络内服务」的边界被打破——这个边界正是生产库的基本姿势，本地习惯会跟着人上生产。更稳的姿势是把它标成调试专用（独立 override 文件或 profile），平时不开；连上后凭据也仍是 compose 里那套教学值，生产环境绝不能照搬。回查「Compose 应用栈」关于 db 不映射端口的说明。</details>

<details>
<summary>4. 服务器磁盘告警，同事执行了 docker compose down -v 「清理空间」。除了容器，还失去了什么？表结构怎么回来？数据呢？</summary>

-v 连数据卷一起删：失去的是卷里的全部数据。表结构可以靠迁移账本重放（up 后跑 migrate，结构与 journal 复原）；数据不会自己回来——除非有备份可恢复，这正是「备份没恢复过就不算备份」要接管的地方（数据库运维一章）。日常拆栈用不带 -v 的 down：还容器还端口，数据原地不动。回查「数据卷」与实验四。</details>
