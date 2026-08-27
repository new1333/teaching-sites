"""第 3 章测试：把页面变成图——渲染分辨率与文字层。

对应大纲 milestone 的三条断言：
1. make_handbook 合成手册 + render_pages 产出带 [第N页] 标签的页图；
2. 扫描页文字层为空可程序检出（text == "" 且 is_scanned 为真）；
3. approx_tokens 按「声明的简化模型」估算页图成本——dpi 从 110 到 220，
   每页成本恰好多 4 倍（边长翻倍，像素翻四倍）。
"""
from vision_rag.bitmap import Bitmap
from vision_rag.client import img_block
from vision_rag.document import (
    Page,
    SynthDoc,
    approx_tokens,
    make_handbook,
    render_pages,
)


def _has_ink(page: Page) -> bool:
    """页图上有没有「墨」——任何非空白字符都算。"""
    return any(row.strip() for row in page.bitmap.rows)


# ---- 位图本身：尺寸、渲染与不变量 ----

def test_bitmap_knows_its_size_and_renders():
    bm = Bitmap(["A B", "C D"])
    assert (bm.width, bm.height) == (3, 2)
    assert bm.render() == "A B\nC D"


def test_bitmap_rejects_ragged_and_empty_rows():
    import pytest

    with pytest.raises(ValueError):
        Bitmap(["AB", "ABC"])   # 各行必须等宽
    with pytest.raises(ValueError):
        Bitmap([])              # 空位图不存在


# ---- 合成手册：六种页齐备，扫描页与空白页可分辨 ----

def test_handbook_has_the_promised_page_kinds():
    doc = make_handbook()
    assert len(doc.pages) == 6
    assert doc.pages[0].text.strip()        # 封面有字
    assert any("目录" in p.text for p in doc.pages)
    assert any("耗材" in p.text for p in doc.pages)   # 表格页
    scanned = [p for p in doc.pages if p.text == "" and _has_ink(p)]
    blank = [p for p in doc.pages if p.text == "" and not _has_ink(p)]
    assert len(scanned) == 1                # 恰好一页扫描页：有墨、无文字层
    assert len(blank) == 1                  # 恰好一页空白页：无墨、无文字层


def test_scanned_page_detected_programmatically():
    doc = make_handbook()
    scanned = next(p for p in doc.pages if p.text == "" and _has_ink(p))
    assert scanned.text == ""               # 文字层是空字符串，不是空格
    assert scanned.is_scanned is True       # 程序一眼检出：这页没有文字层
    assert doc.pages[0].is_scanned is False # 排版页有文字层
    blank = next(p for p in doc.pages if p.text == "" and not _has_ink(p))
    assert blank.is_scanned is True         # 空白页同样没有文字层——检测的语义如此


# ---- 渲染：页码标签与图像一次绑定 ----

def test_render_pages_labels_bind_page_numbers():
    imgs = render_pages(make_handbook())
    assert [img.page_no for img in imgs] == [1, 2, 3, 4, 5, 6]
    assert [img.label for img in imgs] == [f"[第{i}页]" for i in range(1, 7)]
    assert all(isinstance(img.bitmap, Bitmap) for img in imgs)


def test_label_and_image_travel_together_into_request():
    imgs = render_pages(make_handbook())
    blocks = img_block(imgs[2].bitmap, label=imgs[2].label)
    assert blocks[0] == {"type": "text", "text": "[第3页]"}   # 标签先上车
    img = blocks[1]
    assert img["type"] == "image_url"
    prefix, _, b64 = img["image_url"]["url"].partition(",")
    assert prefix.startswith("data:") and "base64" in prefix
    import base64
    # 同一次请求里的图，就是这一页的图——标签与图像同车，出处不用猜
    assert base64.b64decode(b64).decode("utf-8") == imgs[2].bitmap.render()


# ---- DPI 旋钮：默认档、放大与缩小 ----

def test_default_dpi_keeps_stored_shape():
    doc = make_handbook()
    default, named = render_pages(doc), render_pages(doc, dpi=110)
    for d, n in zip(default, named):
        assert d.label == n.label                     # 默认档就是 110
        assert d.bitmap.render() == n.bitmap.render()
    for page, img in zip(doc.pages, render_pages(doc)):
        assert img.bitmap.width == page.bitmap.width   # 110 是存储形态，原样出场
        assert img.bitmap.height == page.bitmap.height


def test_dpi_220_doubles_edges_and_quadruples_pixels():
    doc = make_handbook()
    for page, img in zip(doc.pages, render_pages(doc, dpi=220)):
        assert img.bitmap.width == 2 * page.bitmap.width    # 边长翻倍
        assert img.bitmap.height == 2 * page.bitmap.height
        pixels = img.bitmap.width * img.bitmap.height
        assert pixels == 4 * page.bitmap.width * page.bitmap.height  # 像素翻四倍


def test_dpi_zooms_the_grid_character_by_character():
    doc = SynthDoc([Page("小小的一页", Bitmap(["AB", "CD"]))])
    img = render_pages(doc, dpi=220)[0]
    assert (img.bitmap.width, img.bitmap.height) == (4, 4)
    assert img.bitmap.render().splitlines()[0] == "AABB"    # 每个字符放大成 2×2


def test_dpi_can_also_shrink():
    doc = make_handbook()
    for page, img in zip(doc.pages, render_pages(doc, dpi=55)):
        assert 1 <= img.bitmap.width < page.bitmap.width     # 旋钮也能拧小
        assert 1 <= img.bitmap.height < page.bitmap.height


# ---- 声明的简化计费模型：像素 ÷ 750，向上取整 ----

def test_approx_tokens_is_paper_verifiable():
    full = Bitmap(["x" * 50] * 30)          # 1500 像素 ÷ 750 = 2
    assert approx_tokens(full) == 2
    half = Bitmap(["x" * 25] * 30)          # 750 像素 ÷ 750 = 1
    assert approx_tokens(half) == 1
    odd = Bitmap(["x" * 27] * 28)           # 756 像素 → 向上取整到 2
    assert approx_tokens(odd) == 2
    assert approx_tokens(full, pixels_per_token=375) == 4   # 旋钮可调，比值可算


def test_cost_exactly_quadruples_from_110_to_220():
    doc = make_handbook()
    cheap = render_pages(doc, dpi=110)
    dear = render_pages(doc, dpi=220)
    for c, d in zip(cheap, dear):
        assert approx_tokens(d.bitmap) == 4 * approx_tokens(c.bitmap)  # 恰好 4 倍
    assert approx_tokens(cheap[0].bitmap) == 2                          # 每页 2 token
    total_cheap = sum(approx_tokens(i.bitmap) for i in cheap)
    total_dear = sum(approx_tokens(i.bitmap) for i in dear)
    assert (total_cheap, total_dear) == (12, 48)                        # 整本 12 → 48
