"""report.py —— 把证据递到手上：引用页导出与自包含 HTML 预览。

第 7 章的深读给出带 [第N页] 引用的回答，这一章解决「回答之后」：
答案说第 5 页，就交得出第 5 页的画面。两个交付物：
1. export_pages：引用页图逐页落盘，页码标签写在文件首行；
2. html_preview：答案与引用页图合成一个自包含 HTML（self-contained
   HTML，即不依赖任何外部文件的单文件网页）——双击即开，转发即走。
自包含是硬承诺：文件内没有一处外部资源引用——样式内联在 <style>，
页图以 <pre> 网格原样内嵌。声明的简化：真实世界的页图是 PNG 字节，
预览里以 base64 内联成 <img>；实验场的「图」是字符网格，直接当
文本嵌进 <pre>——形态不同，纪律相同：收件人不需要任何别的文件。
"""
from __future__ import annotations

import html
from pathlib import Path

_PREVIEW_STYLE = """<style>
body{font-family:system-ui,"Microsoft YaHei",sans-serif;max-width:920px;margin:0 auto;padding:24px;color:#222}
.q{font-size:15px;color:#555;margin-bottom:8px}
.answer{white-space:pre-wrap;background:#f6f7f9;padding:16px 20px;border-radius:10px;font-size:15px;line-height:1.7}
h2{margin-top:36px;border-bottom:2px solid #e8e8e8;padding-bottom:6px}
section{margin:18px 0 32px}
h3{color:#666;font-weight:600;margin-bottom:0}
pre{background:#fff;border:1px solid #ddd;border-radius:6px;padding:8px;overflow-x:auto;font-size:12px;line-height:1.15;margin:6px 0 0}
</style>"""


def _images_by_page(page_images: list) -> dict[int, object]:
    """页图按页码建索引：一个页码一张图，交付时按答案引用取用。"""
    return {img.page_no: img for img in page_images}


def export_pages(page_images: list, pages: list[int], out_dir) -> list[Path]:
    """把选中的页图逐页落盘：一个页码一个文件，标签写首行，返回路径列表。

    声明的简化：真实世界导出的是 PNG 页图；实验场的页图是字符网格，
    落盘即 .txt——形态不同，纪律相同：页码与画面一起交付。语料外的
    页码交不出证据，抛 ValueError 说破、不悄悄跳过——交付物与答案
    对不上账，比缺一个文件更糟。
    """
    images = _images_by_page(page_images)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for p in pages:
        if p not in images:
            raise ValueError(
                f"第{p}页不在页图里：可导出的页码为 {sorted(images)}")
        path = out / f"page-{p}.txt"
        path.write_text(f"{images[p].label}\n{images[p].bitmap.render()}\n",
                        encoding="utf-8")
        paths.append(path)
    return paths


def html_preview(doc_name: str, question: str, answer: str,
                 page_images: list, pages: list[int], out_dir) -> Path:
    """答案＋引用页图合成一个自包含 HTML 文件，返回它的路径。

    问题、答案、每页「标签＋画面」都住在这一个文件里：样式内联、页图
    内嵌，全文件零外部引用——收件人双击就能核对，不需要原书，也不需
    要任何别的文件。答案与画面都经 html.escape 转义：答案里的尖括号
    只是文字，不许在预览里变成活的标签。语料外的页码抛 ValueError：
    交不出的证据不能悄悄抹掉，对账的缺口要当场合上。
    """
    images = _images_by_page(page_images)
    parts = [("<!DOCTYPE html>\n<html lang=\"zh\">\n<head>\n"
              '<meta charset="utf-8">\n'),
             f"<title>{html.escape(doc_name)} · 问答预览</title>\n",
             _PREVIEW_STYLE, "\n</head>\n<body>\n",
             f"<h1>{html.escape(doc_name)}</h1>\n",
             f'<div class="q">问题：{html.escape(question)}</div>\n',
             f'<div class="answer">{html.escape(answer)}</div>\n',
             "<h2>引用页</h2>\n"]
    for p in pages:
        if p not in images:
            raise ValueError(
                f"第{p}页不在页图里：可嵌入的页码为 {sorted(images)}")
        parts.append("<section>\n"
                     f"<h3>{images[p].label}</h3>\n"
                     f"<pre>{html.escape(images[p].bitmap.render())}</pre>\n"
                     "</section>\n")
    parts.append("</body>\n</html>\n")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    path = out / "preview.html"
    path.write_text("".join(parts), encoding="utf-8")
    return path
