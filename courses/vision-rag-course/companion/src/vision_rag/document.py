"""document.py —— 把「文档」变成「带页码标签的页图」。

真实世界：PyMuPDF 打开 PDF，逐页渲染 PNG、抽取文字层。
实验场：make_handbook 造一本合成手册（字符位图当页图），render_pages
负责 DPI 旋钮与页码绑定。两条声明过的简化：
1. 页图是字符位图（Bitmap），不是 PNG 字节；
2. 合成页以 110 DPI 的形态存储，dpi 参数按比例缩放网格——
   绝对像素数与真实 A4 页不同，但「边长翻倍、成本翻四倍」的
   比例律与真实世界一致，这正是要教的那条。
"""
from __future__ import annotations

from vision_rag.bitmap import Bitmap

BASE_DPI = 110  # 合成页的存储形态：默认渲染档（真实工具的常用成本档）
PAGE_W = 50     # 一页的宽：50 字符
PAGE_H = 30     # 一页的高：30 字符 → 1500 像素


class Page:
    """文档的一页：文字层 text + 这页的位图。

    真实 PDF 里两个都从原文件读出。扫描页的 text 是空字符串——
    字印在图片上，文字层根本不存在。
    """

    def __init__(self, text: str, bitmap: Bitmap):
        self.text = text
        self.bitmap = bitmap

    @property
    def is_scanned(self) -> bool:
        """程序检出「这页没有文字层」：文字剥掉空白后什么都不剩。"""
        return not self.text.strip()


class PageImage:
    """一张带页码的页图。页码在渲染那一刻与图像绑定，不可再分。"""

    def __init__(self, page_no: int, bitmap: Bitmap):
        self.page_no = page_no
        self.bitmap = bitmap

    @property
    def label(self) -> str:
        """进请求时贴在图前的页码标签——模型引用页码的物理出处。"""
        return f"[第{self.page_no}页]"


class SynthDoc:
    """一份文档：不过是一列页。真实世界把它换成从 PDF 读出的页列表。"""

    def __init__(self, pages: list[Page]):
        self.pages = list(pages)


def _draw(lines: list[str]) -> Bitmap:
    """把若干文本行画成一整页位图：顶边距 2 行、水平居中、其余留白。"""
    if len(lines) > PAGE_H - 4:
        raise ValueError(f"版心只有 {PAGE_H - 4} 行，画不下 {len(lines)} 行")
    rows = [" " * PAGE_W for _ in range(PAGE_H)]
    for i, line in enumerate(lines):
        rows[2 + i] = line.center(PAGE_W)
    return Bitmap(rows)


def _table_rows() -> list[str]:
    """画一张两列小表的网格行：上下边框夹住三行数据。"""
    border = "+" + "-" * 6 + "+" + "-" * 8 + "+"
    rows = [border]
    for i, (a, b) in enumerate([("耗材", "周期"), ("滤芯", "90 日"),
                                ("皮带", "180 日")]):
        rows.append(f"| {a:<4} | {b:<6} |")
        if i == 0:
            rows.append(border)  # 表头下再压一道
    rows.append(border)
    return rows


def make_handbook() -> SynthDoc:
    """课程自产示例手册：封面、目录、正文、表格、扫描页、空白页，共 6 页。

    第 5 页是扫描件——位图上画着保修条款，文字层却是空字符串：
    「看得见的字」与「机器能抽出的字」在这一页上故意不是一回事。
    """
    cover = Page(
        "设备维护手册\nMODEL-X 系列\n第 3 版",
        _draw(["设备维护手册", "", "MODEL-X 系列", "", "第 3 版"]),
    )
    toc = Page(
        "目录\n1 安装 3\n2 保养 4\n3 保修 5",
        _draw(["目 录", "", "1 安装 ······ 3", "2 保养 ······ 4",
               "3 保修 ······ 5"]),
    )
    body = Page(
        "2 保养周期\n每 90 日更换滤芯，每 180 日校准一次温度探头。",
        _draw(["2 保养周期", "", "每 90 日更换滤芯，", "每 180 日校准一次",
               "温度探头。"]),
    )
    table = Page(
        "耗材与周期\n耗材 周期\n滤芯 90 日\n皮带 180 日",
        _draw(["耗材与周期", ""] + _table_rows()),
    )
    scanned = Page(
        "",  # 扫描页没有文字层：字印在图上，抽出来只能是空字符串
        _draw(["3 保修条款", "", "整机保修一年，", "易损耗材不在",
               "保修范围内。", "", "（盖章处）"]),
    )
    blank = Page("", _draw([]))  # 空白页：图上无墨，文字层也没有
    return SynthDoc([cover, toc, body, table, scanned, blank])


def _resample(rows: list[str], new_w: int, new_h: int) -> list[str]:
    """最近邻缩放字符网格：新格 (x, y) 抄最近的原格字符。

    放大时每个字符长成一块（2×2、4×4……），肉眼看就是「图变清楚了」；
    缩小时按步长抽样。DPI 旋钮的全部实现就是这一个函数。
    """
    h, w = len(rows), len(rows[0])
    out = []
    for y in range(new_h):
        src = rows[min(h - 1, y * h // new_h)]
        out.append("".join(src[min(w - 1, x * w // new_w)] for x in range(new_w)))
    return out


def render_pages(doc: SynthDoc, dpi: int = BASE_DPI) -> list[PageImage]:
    """逐页出图：页码从 1 起编号，与缩放后的位图一起装进 PageImage。

    dpi 是清晰度旋钮：110 为存储形态原样出场，220 边长翻倍、
    像素与成本翻四倍；页码标签不受旋钮影响——第 3 页永远是第 3 页。
    """
    if dpi <= 0:
        raise ValueError(f"dpi 必须是正数，收到 {dpi}")
    scale = dpi / BASE_DPI
    images = []
    for page_no, page in enumerate(doc.pages, start=1):
        bm = page.bitmap
        new_w = max(1, round(bm.width * scale))
        new_h = max(1, round(bm.height * scale))
        images.append(PageImage(page_no, Bitmap(_resample(bm.rows, new_w, new_h))))
    return images


def approx_tokens(bitmap: Bitmap, pixels_per_token: int = 750) -> int:
    """声明的简化计费模型：像素总数 ÷ 每 token 像素数，向上取整。

    与任何平台真实价格无关——只保留一条方向性事实：
    图越清晰（像素越多）越贵，成本随两条边长按平方涨。
    """
    if pixels_per_token <= 0:
        raise ValueError(f"pixels_per_token 必须是正数，收到 {pixels_per_token}")
    pixels = bitmap.width * bitmap.height
    return -(-pixels // pixels_per_token)  # 向上取整：不足一个 token 也算一个
