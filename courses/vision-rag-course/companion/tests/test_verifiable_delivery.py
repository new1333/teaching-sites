"""第 8 章测试：可核对的交付——引用回收、页图导出与自包含 HTML。

对应大纲 milestone 的四件事：
1. cited_pages：从答案正文正则回收页码，升序去重；不是页码的数字不误伤；
2. ask 贯通：一次调用跑完 粗筛→精排→深读→引用回收；index 注入现成
   卡片时建卡那步整个跳过；
3. 索引覆盖如实声明：只索引了部分页时，答案末尾带覆盖注记——没读过的
   页不许装作读过（本章痛点的正面解法）；
4. 交付物可核对：export_pages 落盘带标签的页图文件；html_preview 产出
   自包含单文件 HTML——零外部引用，页图标签与答案页码一致。
全程零网络：模型由剧本回放。
"""
import re

import pytest

from vision_rag.client import Client
from vision_rag.document import make_handbook, render_pages
from vision_rag.fake import ScriptedTransport, fenced_json
from vision_rag.index import normalize_card
from vision_rag.pipeline import Answer, ask, cited_pages
from vision_rag.report import export_pages, html_preview

QUESTION = "整机保修多久"

INDEX_PAYLOAD = {"pages": [                 # 合成手册整本成卡的剧本回执
    {"page": 1, "type": "封面"},
    {"page": 2, "type": "目录"},
    {"page": 3, "type": "正文", "summary": "保养周期：滤芯 90 日更换"},
    {"page": 4, "type": "正文", "summary": "耗材与周期表格"},
    {"page": 5, "type": "其他", "summary": "保修条款：整机保修一年"},
    {"page": 6, "type": "空白"},
]}

RERANK_REPLY = (fenced_json({"pages": [{"page": 5}]}), "stop")

DEEP_ANSWER = "整机保修一年；易损耗材不在保修范围内 [第5页]。"


def _client(script) -> tuple[Client, ScriptedTransport]:
    """剧本 + 不真睡的 Client：重试节奏照走，一秒不等。"""
    transport = ScriptedTransport(script)
    return Client(transport, sleep=lambda _seconds: None), transport


def _full_script() -> list:
    """整本问答的三幕剧本：建卡（围栏 JSON）→ 精选 → 深读作答。"""
    return [(fenced_json(INDEX_PAYLOAD), "stop"), RERANK_REPLY,
            (DEEP_ANSWER, "stop")]


def _handbook_images() -> list:
    """合成手册的六张页图。"""
    return render_pages(make_handbook())


def _system_of(request: dict) -> str:
    """一次请求的岗位说明书——认出这次调用是漏斗的哪一层。"""
    return request["messages"][0]["content"]


def _sent_labels(request: dict) -> list[int]:
    """从请求文本块里读出送读的页码——只认 [第N页] 打头的标签。"""
    pages = []
    for block in request["messages"][-1]["content"]:
        if block["type"] == "text":
            m = re.match(r"\[第(\d+)页\]", block["text"])
            if m:
                pages.append(int(m.group(1)))
    return pages


# ---- 里程碑 1：cited_pages——从答案正文回收页码 ----

def test_cited_pages_recovers_sorted_and_deduped():
    """页码引用乱序、重复出现：回收结果升序去重——12、10、12 收成 [10, 12]。"""
    text = "先说结论 [第12页]；补充在 [第10页]，再次强调 [第12页]。"
    assert cited_pages(text) == [10, 12]


def test_cited_pages_ignores_numbers_that_are_not_pages():
    """「第 3 版」「第三页」「12 页」都不是页码引用：网眼只认「第＋数字＋页」。"""
    assert cited_pages("手册是第 3 版，共 12 页，见图三。") == []
    assert cited_pages("整机保修一年（第5页）到期。") == [5]


def test_cited_pages_on_empty_or_refusal_answer():
    """空答案与拒答都回收不到页码：返回空列表，不抛错。"""
    assert cited_pages("") == []
    assert cited_pages("资料中未见相关内容：手册里没有预算表的记载。") == []


# ---- 里程碑 2：ask 贯通——一次调用跑完三层漏斗 + 引用回收 ----

def test_ask_runs_the_full_funnel_in_order():
    """三幕剧本一次吃进：建卡（low＋JSON）→ 精选（low＋JSON）→ 深读（high）。"""
    client, transport = _client(_full_script())
    result = ask(client, make_handbook(), QUESTION)
    assert isinstance(result, Answer)
    assert result.answer == DEEP_ANSWER       # 全覆盖：无覆盖注记、无截断注记
    assert result.cited == [5]                # 页码从答案正文里回收，不是另起的账本
    assert transport.calls == 3               # 建卡 1 次 + 精选 1 次 + 深读 1 次
    first, second, third = transport.requests
    assert "索引员" in _system_of(first)
    assert first["response_format"]["type"] == "json_object"
    assert "精选员" in _system_of(second)
    assert second["response_format"]["type"] == "json_object"
    assert "深度阅读" in _system_of(third)
    assert third["reasoning_effort"] == "high"


def test_ask_with_prebuilt_index_skips_indexing():
    """index 注入现成卡片：建卡那次调用整个跳过，直接从精选起步。"""
    cards = {p: normalize_card(rec, p)
             for p, rec in enumerate(INDEX_PAYLOAD["pages"], start=1)}
    client, transport = _client([RERANK_REPLY, (DEEP_ANSWER, "stop")])
    result = ask(client, make_handbook(), QUESTION, index=cards)
    assert transport.calls == 2
    assert result.cited == [5]


# ---- 里程碑 3：索引覆盖如实声明 ----

def test_partial_index_gets_an_honest_note():
    """索引只建了 3/6 页：答案末尾声明覆盖范围，深读也只见已索引的页。"""
    cards = {p: normalize_card({"type": "正文", "summary": f"第{p}页摘要"}, p)
             for p in (1, 2, 3)}
    cards[3] = normalize_card(
        {"type": "正文", "summary": "保修条款：整机保修一年"}, 3)
    client, transport = _client([
        (fenced_json({"pages": [{"page": 3}]}), "stop"),
        ("整机保修一年 [第3页]。", "stop"),
    ])
    result = ask(client, make_handbook(), QUESTION, index=cards)
    assert "3/6" in result.answer            # 覆盖范围写进答案，不当哑巴
    assert "没有被读过" in result.answer
    assert result.cited == [3]
    assert _sent_labels(transport.requests[-1]) == [2, 3]   # 未索引的页进不了深读


# ---- 里程碑 4：export_pages——引用页图落盘 ----

def test_export_pages_writes_labeled_files(tmp_path):
    """一个页码一个文件：页码标签写在首行，画面内容随后；目录不存在就建。"""
    out = tmp_path / "out" / "pages"
    paths = export_pages(_handbook_images(), [5, 4], out)
    assert [p.name for p in paths] == ["page-5.txt", "page-4.txt"]
    body = paths[0].read_text("utf-8")
    assert body.startswith("[第5页]")        # 标签与画面同一个文件
    assert "保修" in body


def test_export_pages_unknown_page_is_a_value_error(tmp_path):
    """语料外的页码交不出证据：明确报错，不悄悄抹掉。"""
    with pytest.raises(ValueError):
        export_pages(_handbook_images(), [7], tmp_path)


# ---- 里程碑 5：html_preview——自包含单文件 HTML ----

EXTERNAL_MARKS = ("src=", "href=", "http:", "https:", "<img", "@import", "url(")


def test_html_preview_has_zero_external_references(tmp_path):
    """自包含是硬承诺：全文件找不到任何外链痕迹——样式内联、页图内嵌。"""
    path = html_preview("设备维护手册", QUESTION, DEEP_ANSWER,
                        _handbook_images(), [5], tmp_path)
    assert path.exists() and path.suffix == ".html"
    content = path.read_text("utf-8")
    for mark in EXTERNAL_MARKS:
        assert mark not in content


def test_html_preview_shows_answer_and_cited_page_together(tmp_path):
    """双击看到的东西：问题、答案、引用页的标签与画面同屏。"""
    content = html_preview("设备维护手册", QUESTION, DEEP_ANSWER,
                           _handbook_images(), [5], tmp_path).read_text("utf-8")
    assert "设备维护手册" in content
    assert QUESTION in content
    assert DEEP_ANSWER in content
    assert "[第5页]" in content
    assert "保修" in content                 # 页面画面就内嵌在文件里
    assert content.count("<pre>") == 1


def test_html_preview_labels_match_recovered_citations(tmp_path):
    """端到端对账：ask 回收的每个页码，预览里都有一张带同款标签的页图。"""
    client, _ = _client(_full_script())
    result = ask(client, make_handbook(), QUESTION)
    content = html_preview("设备维护手册", QUESTION, result.answer,
                           _handbook_images(), result.cited,
                           tmp_path).read_text("utf-8")
    for p in result.cited:
        assert f"[第{p}页]" in content
    assert content.count("<pre>") == len(result.cited)


def test_html_preview_escapes_answer_text(tmp_path):
    """答案里的尖括号原样呈现为文本：<script> 不许在预览里变成活的标签。"""
    content = html_preview("手册", QUESTION, "含 <script> 与 & 的答案 [第1页]",
                           _handbook_images(), [1], tmp_path).read_text("utf-8")
    assert "<script>" not in content
    assert "&lt;script&gt;" in content


def test_html_preview_without_citations_still_writes(tmp_path):
    """拒答（回收不到页码）也有交付物：文件照常生成，只是没有页图区。"""
    content = html_preview("手册", QUESTION, "资料中未见相关内容。",
                           _handbook_images(), [], tmp_path).read_text("utf-8")
    assert "资料中未见相关内容" in content
    assert "<pre>" not in content
