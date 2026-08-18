# 可视化组件使用契约（章写作智能体必读）

正文嵌图表只有一条路：`docs/assets/data/*.json`（由 `companion` 的 `npm run export-docs` 真实计算产出）+ 全局注册的组件。**禁止手写数据 JSON、禁止外采数据。**

## 数据文件形态

`docs/assets/data/{NN}-{name}.json`（两位章号开头，与正文同名族）：

```json
{
  "candles": [{ "date": "D1", "open": 10, "high": 10.5, "low": 9.8, "close": 10.2, "volume": 12000 }],
  "overlays": [{ "name": "MA5", "values": [null, 10.1, 10.15] }],
  "markers": [{ "index": 3, "label": "锤子", "kind": "bull" }]
}
```

- `candles`：时间旧→新（与 companion 的 Candle 一致）；`volume` 可省（省略则不画副图）。
- `overlays.values` 与 candles 等长，头部不足处用 `null`（如均线未成形）。
- `markers.index` 指向 candles 下标；`kind`: `bull`（低点下红三角）/ `bear`（高点上绿三角）/ `info`（高点上圆点）。A股配色：红涨绿跌。

## 正文嵌入写法

```md
<script setup>
import demo from './assets/data/05-hammer.json'
</script>

<KLineChart :candles="demo.candles" :overlays="demo.overlays" :markers="demo.markers" title="下跌末端的锤子线" />
```

- 章文件在 `docs/` 下，数据相对路径 `./assets/data/…`。
- 纯折线（资金曲线、破产概率、筹码轮廓）用 `LineChart`：`:series="[{ name: '策略', values: […], area: true }]"`，可选 `:labels`、`:percent-y="true"`。
- 一章多个图就多个 `<script setup>` import + 多个组件实例（一个 md 只需一个 `<script setup>` 块，放章首）。
- 需要强调纵轴缩放效应时用 `log-scale` 对比。

## 数据生成

在 `companion/` 内维护 `scripts/export-docs-data.ts`（`npm run export-docs`），固定种子、确定性输出，写出到 `docs/assets/data/`。每章新图表 → 在脚本里加对应导出段，重跑命令。正文写「上图由 companion 的 XX 模块现场算出」时，必须与脚本实际调用一致。
