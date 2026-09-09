# companion/Dockerfile · 三阶段构建：deps（装依赖）→ build（nuxt build）→ run（只带产物）
#
# 设计要点（正文第 5 章逐条展开）：
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
