"""第 5 章测试：免费的第一道筛——分词、停用词与 TF-IDF 粗筛。

对应大纲 milestone 的断言：
1. 稀有词压倒高频词：74 页都含「审批」、只有 1 页含「预算表」的语料上，
   问「预算表审批」，第一名恰是那 1 页；
2. 词频封顶：某页把关键词重复 100 次，得分不再随次数线性上涨（8 次
   与 100 次并列，封顶线以下仍分高下）；
3. 加权字段生效：卡片标题/摘要/关键词按 3 倍计入，扫描页靠卡片而非
   空文字层被检回；无词命中回退全部页序。
全程零网络：粗筛本来就是纯本地计算。
"""
import pytest

from vision_rag.document import make_handbook
from vision_rag.index import normalize_card
from vision_rag.scoring import page_document, score_pages, tokenize


def _card(page, summary="", type_="正文", headings=None, keywords=None):
    """一张规整过的读书卡：字段从简，只留下测试关心的部分。"""
    return normalize_card({"type": type_, "summary": summary,
                           "headings": headings or [],
                           "keywords": keywords or []}, page)


# ---- 里程碑 0a：分词——中文滑二字窗、英文数字整段、去停用词 ----

def test_tokenize_slides_two_char_windows_over_chinese():
    terms = tokenize("每90日更换滤芯")
    assert terms == {"90", "日更", "更换", "换滤", "滤芯"}
    # 「每」单字成不了窗口；「日更」是跨词边的噪音窗口——对称噪音，留着无害


def test_tokenize_keeps_english_and_numbers_whole():
    terms = tokenize("GLM-4.5v 的 token 数")
    assert terms == {"glm", "4.5v", "token"}         # 整段成词、统一小写


def test_tokenize_drops_stop_words():
    terms = tokenize("怎么保养设备")
    assert "怎么" not in terms                        # 问法词：扔
    assert {"保养", "设备"} <= terms                   # 实义词：留
    assert tokenize("怎么") == set()                  # 整句都是问法词：一个不剩
    assert tokenize("what is GLM") == {"glm"}         # 英文停用词同理


# ---- 里程碑 0b：page_document——卡片字段重复 3 次＋文字层 1 次 ----

def test_page_document_repeats_card_fields_three_times():
    card = _card(1, summary="更换滤芯", type_="正文",
                 headings=[{"level": 1, "text": "保养周期"}], keywords=["皮带"])
    doc = page_document(card, "正文出现一次")
    assert doc.count("保养周期") == 3                  # 标题 ×3
    assert doc.count("更换滤芯") == 3                  # 摘要 ×3
    assert doc.count("皮带") == 3                      # 关键词 ×3
    assert doc.count("正文出现一次") == 1              # 文字层只 ×1


# ---- 里程碑 1：稀有词压倒高频词 ----

def test_rare_word_outranks_everywhere_word():
    """74 页满篇「审批」、只有第 75 页有「预算表」：第一名恰是第 75 页。"""
    cards, texts = {}, []
    for p in range(1, 75):
        cards[p] = _card(p, summary="常规审批记录说明")
        texts.append("审批记录：" + "审批、" * 11)      # 词频 15，远超封顶
    cards[75] = _card(75, summary="年度预算表明细")
    texts.append("预算表见本页附后")
    ranked = score_pages(cards, texts, "预算表审批")
    assert ranked[0] == 75                            # 稀有词压倒满书的高频词
    assert set(ranked) == set(range(1, 76))           # 75 页全部有得分、全进榜
    assert ranked[1] in range(1, 75)                  # 第二名起才是「审批」页


# ---- 里程碑 2：词频封顶防「长页霸榜」 ----

def test_term_frequency_cap_keeps_long_page_from_dominating():
    """第 1 页写 8 次、第 2 页抄 100 次：并列第一，按页序稳定输出。"""
    cards = {1: _card(1, summary="普通说明"),
             2: _card(2, summary="普通说明"),
             3: _card(3, summary="无关内容")}
    texts = ["保养 " * 8, "保养 " * 100, "别的主题"]
    ranked = score_pages(cards, texts, "保养")
    assert ranked == [1, 2]                           # 100 次没抬动：封顶后并列


def test_cap_boundary_seven_versus_nine():
    """封顶线（8 次）以下词频仍分高下：7 次 < 9 次。"""
    cards = {1: _card(1, summary="普通说明"), 2: _card(2, summary="普通说明")}
    texts = ["保养 " * 7, "保养 " * 9]
    assert score_pages(cards, texts, "保养") == [2, 1]


# ---- 里程碑 3a：加权字段生效 ----

def test_card_fields_lift_page_above_plain_text():
    """同一个词：躺在摘要里（×3）的页，压过只在正文出现 1 次的页。"""
    cards = {1: _card(1, summary="滤芯更换要点"), 2: _card(2, summary="常规说明")}
    texts = ["本页没有那个词", "滤芯出现在正文一次"]
    assert score_pages(cards, texts, "滤芯") == [1, 2]


def test_scanned_page_found_through_card_not_text_layer():
    """手册第 5 页是扫描件：文字层为空，粗筛靠卡片摘要把它检回第一。"""
    doc = make_handbook()
    texts = [p.text for p in doc.pages]
    cards = {1: _card(1, summary="设备手册封面"), 2: _card(2, summary="目录列表"),
             3: _card(3, summary="保养周期说明"), 4: _card(4, summary="耗材表格"),
             5: _card(5, summary="整机保修一年，易损耗材不在保修范围内"),
             6: _card(6, summary="空白页", type_="空白")}
    ranked = score_pages(cards, texts, "保修范围")
    assert texts[4] == ""                             # 第 5 页文字层确实是空的
    assert ranked[0] == 5                             # 命中完全来自卡片字段


# ---- 里程碑 3b：无词命中回退全部页序 ----

def test_no_hit_falls_back_to_all_pages_in_order():
    cards = {1: _card(1, summary="保养说明"), 2: _card(2, summary="保养说明"),
             3: _card(3, summary="保养说明")}
    texts = ["保养正文一", "保养正文二", "保养正文三"]
    assert score_pages(cards, texts, "退货政策") == [1, 2, 3]   # 全不沾：回退页序


def test_stopwords_only_question_returns_all_pages():
    cards = {1: _card(1, summary="保养说明"), 2: _card(2, summary="保养说明")}
    assert score_pages(cards, ["保养一", "保养二"], "怎么") == [1, 2]


# ---- 参数纪律 ----

def test_texts_shorter_than_pages_is_a_value_error():
    cards = {1: _card(1), 2: _card(2), 3: _card(3)}
    with pytest.raises(ValueError):
        score_pages(cards, ["只有两条", "不够长"], "保养")


def test_empty_corpus_returns_empty():
    assert score_pages({}, [], "保养") == []
