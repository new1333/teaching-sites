---
title: 练习路线：清空 src，从红到绿
---

# 练习路线：清空 src，从红到绿

课程的 `tests/` 目录是按章 append-only、先红后绿长出来的——这份结构天然是一份 TDD 作业梯子。玩法三句话：

1. 把 `companion/` 复制一份，删掉 `companion/src/vision_rag/` 下的所有 `.py`（保留 `__init__.py`），测试从此全红；
2. 按章序自己写实现：第 2 章的测试只考客户端基座，第 3 章只考渲染与文字层……每读完一章，让对应测试文件从红转绿；
3. 每一步都跑双门槛，旧章测试持续全绿——它就是你自己的 API 兼容哨兵。

```bash
cd companion
python -m pip install -r requirements-dev.txt   # 只需要 pytest 与 ruff
python -m pytest -q                             # 看红
# ……读完第 2 章，写出 client.py 与 fake.py……
python -m ruff check src tests conftest.py       # 门槛一：静态检查
python -m pytest -q                             # 门槛二：测试转绿
```

测试文件与章的对应关系（11 个动手章，3 个原理章无测试）：

| 测试文件 | 对应章 | 你要造出来的东西 |
|---|---|---|
| test_vision_client.py | 第 2 章 | 可插拔传输的客户端与剧本假引擎 |
| test_page_rendering.py | 第 3 章 | 字符位图、合成手册、渲染与计费口径 |
| test_batch_page_cards.py | 第 4 章 | 批量打标、对半拆批、文字层兜底 |
| test_local_tfidf.py | 第 5 章 | 分词、停用词、TF-IDF 打分 |
| test_vision_rerank.py | 第 6 章 | 视觉精排与回退 |
| test_deep_read.py | 第 7 章 | 邻页展开、双通道深读、拒答透传 |
| test_verifiable_delivery.py | 第 8 章 | ask 全漏斗贯通与自包含 HTML |
| test_adaptive_sampling.py | 第 9 章 | 合成帧源、自适应抽帧、场景切换 |
| test_frame_segments.py | 第 10 章 | 帧卡片与段聚合 |
| test_video_qa.py | 第 11 章 | 时间戳互译、切片范围、视频问答 |
| test_micro_zoom.py | 第 12 章 | 动作闸门、峰值定窗、中心裁切放大 |

卡住时回看对应章的「实验场」与「验证」两节——测试断言的行为，正文都讲过为什么。全部转绿后，你就从零拥有了一遍这套管线。
