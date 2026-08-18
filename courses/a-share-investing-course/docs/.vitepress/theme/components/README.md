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

## 交互图表组件（echarts）

定位分工：**静态教学定格图用 `KLineChart`/`LineChart`**（SVG、SSR 直出、零依赖）；需要 **tooltip 读数、缩放平移、主副图十字光标联动、筹码水平直方图、回测读图（净值+回撤+交易点）** 时，才用下面三个 echarts 交互组件。

SSR 硬约束（违反即 `docs:build` 失败）：

- 数据仍然只准来自 `docs/assets/data/*.json`，禁止手写数据。
- 三个组件内部在 `onMounted` 后经 `theme/components/echartsClient.ts` 动态按需加载 echarts；任何组件（含新写的）**禁止顶层 `import echarts`**。
- **禁止在 md 里手写 echarts option** 或直接 `import 'echarts'`——一律走组件 props。

### props 速查

`IndicatorChart`（K 线主图 + 指标副图 + 可选量副图，十字光标联动 + dataZoom）：

| prop | 形态 | 说明 |
| --- | --- | --- |
| `candles` | `{ date, open, high, low, close, volume? }[]` | 同 KLineChart；`showVolume` 默认 true |
| `overlays?` | `{ name, values:(number\|null)[], color? }[]` | 主图均线叠线 |
| `markers?` | `{ index, label, kind?: 'bull'\|'bear'\|'info' }[]` | 主图信号标记（红/绿/灰） |
| `sub?` | 见下 | 指标副图：`bars`（柱，正红负绿，MACD 用）、`lines`（DIF/DEA、K/D/J）、`thresholds`（`{value,label?,band?}` 水平参考线，band 对之间半透明色带，RSI 70/30、KDJ 80/20 用）、`markers`（副图交叉点） |
| `subLabel?` / `height?` / `title?` | `string` / `number`(默认420) / `string` | 副图标题 / 总高 / 标题 |

`ChipDistChart`（筹码分布水平直方图：y=价格低→高，x=筹码量）：

| prop | 形态 | 说明 |
| --- | --- | --- |
| `bins` | `{ price, volume, profitable? }[]` | `profitable` true=获利盘红 / false=套牢盘绿 / 缺省中性灰蓝；tooltip 显示价格档/量/占比 |
| `currentPrice?` / `avgCost?` | `number` | 现价（橙红虚线）/ 平均成本（蓝虚线）markLine |
| `height?` / `title?` | `number`(默认360) / `string` | 总高 / 标题 |

`BacktestChart`（回测净值：传入 `drawdown` 时双 grid 联动 + dataZoom）：

| prop | 形态 | 说明 |
| --- | --- | --- |
| `dates` / `equity` | `string[]` / `number[]` | 时间轴与策略净值（等长） |
| `benchmark?` | `number[]` | 基准（买入持有），青色虚线 |
| `trades?` | `{ index, kind:'buy'\|'sell', note? }[]` | buy 红上箭头 / sell 绿下箭头，note 进 tooltip |
| `drawdown?` | `number[]` | **负数比率**（-0.23 即 -23%）；第二 grid 绿色半透明「水下曲线」 |
| `height?` / `title?` | `number`(默认420) / `string` | 总高 / 标题 |
