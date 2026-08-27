"""Bitmap：字符位图——实验场里所有「图」的统一形态。

一个 Bitmap 就是一张等宽的字符网格：一个字符是一个像素，
render() 把网格铺成一段文本。真实世界的图是 PNG/JPEG 字节；
这里用字符网格代替，为的是整本书里每张图都看得见、数得清、
测试能逐字符断言（第 2 章的 img_block 已经只认 render()，零改动兼容）。
"""
from __future__ import annotations


class Bitmap:
    """等宽字符网格。不变量：至少一行、行行同宽——破坏即 ValueError。

    crop(x, y, w, h) 与 center_crop(w, h) 已随第 12 章微观放大加入。
    """

    def __init__(self, rows: list[str]):
        if not rows:
            raise ValueError("位图至少要有一行")
        width = len(rows[0])
        if any(len(row) != width for row in rows):
            raise ValueError(f"位图各行必须等宽：首行 {width} 字符，存在不等宽的行")
        self.rows = list(rows)

    @property
    def width(self) -> int:
        """横向字符数（这张「图」的宽）。"""
        return len(self.rows[0])

    @property
    def height(self) -> int:
        """纵向字符数（这张「图」的高）。"""
        return len(self.rows)

    def render(self) -> str:
        """铺成一段文本：行与行以换行相连。"""
        return "\n".join(self.rows)

    def crop(self, x: int, y: int, w: int, h: int) -> Bitmap:
        """挖出一块子位图：左上角 (x, y)（先列后行），宽高 w×h。

        越界、非正尺寸即 ValueError——画面之外的格子无从谈起。挖出的
        格点与原图逐字符相同：裁切只做减法，不造新画面（与抽帧的
        「采样不造画面」同一脾气）。
        """
        if w <= 0 or h <= 0:
            raise ValueError(f"裁切尺寸必须为正，收到 {w}×{h}")
        if x < 0 or y < 0 or x + w > self.width or y + h > self.height:
            raise ValueError(f"裁切区域越界：({x}, {y}) 起的 {w}×{h} "
                             f"超出 {self.width}×{self.height}")
        return Bitmap([row[x:x + w] for row in self.rows[y:y + h]])

    def center_crop(self, w: int, h: int) -> Bitmap:
        """挖出正中的一块：先算左上角偏移，再走 crop 的老路。

        余量为奇时偏左上——(width - w) // 2 向下取整，纸笔可复算，
        不掷硬币。w 或 h 超过原图即 ValueError：放大不归 Bitmap 管，
        「放大看」是把小块单独送模型、让同样的分辨率只花在细节上。
        """
        if w > self.width or h > self.height:
            raise ValueError(f"中心裁切尺寸不能超过原图：{w}×{h} "
                             f"超出 {self.width}×{self.height}")
        return self.crop((self.width - w) // 2, (self.height - h) // 2, w, h)
