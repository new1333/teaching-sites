# Nginx 前端实战课

面向前端工程师的 Nginx 配置教学站点 + 伴生实现。读法与配置教程相反：**每章学一条指令，就用 TypeScript 把它的行为亲手实现一遍**，全书结束你拥有一个自己写的 mini-nginx。

## 运行

```bash
# 教学站点
pnpm install
pnpm docs:dev        # http://localhost:5173

# 伴生实现（mini-nginx）
cd companion
npm install
npm run typecheck    # tsc --noEmit
npm test             # vitest run，55 个断言
```

## 章节目录

### 地基：从一份 dist 说起
1. Nginx 心智模型：一个请求到底被谁处理了（principle）
2. 静态文件服务：root、index 与 MIME
3. location 匹配：一个 URI 命中哪条规则
4. try_files 与 SPA History 路由回退

### 代理：前端与后端之间的桥
5. 反向代理 proxy_pass：本地联调与同源部署
6. 请求头透传与 WebSocket：X-Forwarded-For 和 Upgrade
7. upstream 负载均衡：发版不再 502

### 上线：性能、缓存与排障
8. gzip 压缩：把 2.3MB 的 vendor.js 降到 600KB
9. 缓存控制：一半用户新一半用户旧的怪事
10. CORS 与 add_header：跨域资源共享在网关层怎么做
11. HTTPS 与安全头：上线 TLS 前前端要懂的常识（principle）
12. mini-nginx vs 真实 Nginx：差异地图与 502/504 排障手册（source-mapping）

## 终点里程碑

一个 642 行 src、零运行时依赖的 mini-nginx（TypeScript + node:http）：

- 配置键与 nginx.conf 指令一一对应（root / try_files / proxy_pass / expires / add_header…）
- 覆盖十大前端场景：静态服务、location 匹配、SPA 回退、反向代理、请求头透传、WebSocket、负载均衡、gzip、缓存控制、CORS
- 验证：`cd companion && npm test`——10 个特性各成一组测试文件，55 个断言全绿
- 第 12 章给出与真实 Nginx 的十二条差异地图，说明每个「教学保真 / 语义近似 / 未实现」

## 目录结构

```
nginx-course/
├── docs/            # VitePress 站点（12 章）
├── companion/       # 伴生实现 mini-nginx（逐章演进）
└── .course/         # 生成管线状态（大纲/圣经/滚动摘要/快照）
```
