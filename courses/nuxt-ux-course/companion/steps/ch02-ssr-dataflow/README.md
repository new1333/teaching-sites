# 蜗牛商店 ——《丝滑体验工程》伴实战场

一个刻意做慢的 Nuxt 4 电商演示站：接口带服务端延迟、数据页走客户端取数。课程逐章把它提速，每层改动都用 `scripts/measure.mjs` 的指标组对账。

## 跑起来

```bash
pnpm install     # 安装依赖（postinstall 会执行 nuxt prepare 生成类型）
pnpm test        # vitest：目录确定性与故障注入的纯逻辑测试
pnpm measure     # 构建 → 起服务器 → 输出指标组报告（默认 reports/measure.json）
pnpm gate:ch1    # 第 1 章门槛：口径完整 / 数值合理 / 重复稳定 / 基线事实
pnpm gate:ch2    # 第 2 章门槛：/products 直出事实 / 单次命中 / 反例页仍在
pnpm dev         # 本地开发（默认 3000 端口）
pnpm build && pnpm start   # 构建并以生产模式起服（PORT 环境变量可改端口，默认脚本用 4311）
```

环境变量：`SKIP_BUILD=1` 让 measure / gate 跳过构建（要求 `.output` 已存在）；`PORT` 改服务器端口。

## 目录速览

- `app/` —— Nuxt 4 应用目录（pages / components / assets）
- `server/api/` —— 数据接口；`_hits` 是命中计数、`_chaos` 是延迟/故障开关（POST `{delayMs, fail}`）
- `server/utils/` —— 确定性商品目录与故障注入状态
- `scripts/` —— 测量与门槛脚本；`lib/` 是共享的服务器生命周期与测量核心
- `steps/chNN-slug/` —— 每章结束态的完整源码快照，根目录始终是最新状态
- `reports/` —— 基线与门槛报告（`baseline.json` 是优化前的对照档案）

## 刻意做慢的来源

`server/utils/chaos.ts` 的 `DEFAULT_DELAYS`：`/api/products` 800ms、`:id` 500ms、`/api/search` 600ms、`/api/favorites` 300ms。想临时关掉：`curl -X POST :4311/api/_chaos -d '{"delayMs":0}'`。
