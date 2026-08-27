# 视觉 RAG 原理课：让 AI 真正看懂 PDF 与视频

一门讲**视觉 RAG 原理**的 VitePress 课程：先通读做卡片索引、再按三层成本漏斗（免费粗筛 → 便宜精排 → 昂贵深读）回答问题——PDF 带页码引用、视频带时间戳引用，证据递到手上可核对。

**终点里程碑**：读完你将拥有一套千行级、假模型驱动的最小视觉 RAG 管线（PDF 与视频问答全流程可跑通）——`cd companion && python -m pytest -q`，141 个测试全绿；一行命令跑通 ask 并产出可双击核对的自包含 HTML。

## 怎么跑

两条路进入课程站：

```bash
# 路一：项目根聚合站（全部课程一起看）
pnpm dev

# 路二：只看本课程
cd courses/vision-rag-course
pnpm install
pnpm docs:dev
```

伴生实验场（零网络、零密钥、零输入——素材与「模型」全部课程自产）：

```bash
cd companion
python -m pip install -r requirements-dev.txt   # pytest + ruff，src 只用标准库
python -m ruff check src tests conftest.py      # 门槛一
python -m pytest -q                             # 门槛二：141 passed
```

第 8 章「亲手开机」一行命令即可看到可核对的成品：带 [第N页] 引用的答案 + 自包含 HTML（`out/preview.html`），双击即开。

## 章节目录

**第一部 · 全景与地基**

1. 先通读做笔记，再按笔记翻书：两阶段架构与成本漏斗
2. 一个靠得住的视觉模型客户端：重试、宽容解析与密钥纪律

**第二部 · PDF 问答主线**

3. 把页面变成图：渲染分辨率与文字层
4. 每页一张读书卡：批量打标与拆批重试
5. 免费的第一道筛：中文 TF-IDF 粗筛
6. 让模型看图把关：视觉精排
7. 只在刀刃上花力气：深读与引用诚实
8. 把证据递到手上：引用回收与自包含预览

**第三部 · 视频问答**

9. 按时长定密度：视频宏观抽帧
10. 帧卡片与段聚合：把几百帧收进抽屉
11. 漏斗迁移：带时间戳的视频问答
12. 再拉近一点：微观放大层

**第四部 · 走向工程**

13. 换一台引擎：移植差异与双引擎互验
14. 从脚本到 skill：让 AI 知道何时调用你

附录：[术语表](docs/glossary.md) · [差异清单：本课程的简化与真实世界](docs/divergence.md) · [练习路线：清空 src 从红到绿](docs/exercises.md)

## 课程性质

- 备课参考了公开仓库 [liangdabiao/glm-5.3-flash-vision-rag](https://github.com/liangdabiao/glm-5.3-flash-vision-rag)（作者侧学习资料）；课程不复刻其代码，正文与实验场零仓库痕迹。
- 实验场用「假模型」（剧本回放的 ScriptedTransport）驱动全流程：不联网、不花真钱、结果确定；接真实视觉引擎只差一个 transport（第 13 章讲怎么换）。
- 本课程的全部简化集中登记在[差异清单](docs/divergence.md)。
