/**
 * 程序化纹理——代码即图案，不依赖任何图片文件。
 *
 * 纹理数据只是一块 RGBA 字节表：逐像素 4 个字节（R、G、B、A 各占
 * 一个），按「第 0 行 → 第 1 行 → …」逐行排队，总字节数 = size²×4。
 * checkerboard 按格子算颜色：格边 = size / cells 像素，格 (cx, cy) 的
 * 颜色由 (cx + cy) 的奇偶定黑白。
 *
 * 原点约定（承重，测试锁住）：数组第 0 行是 UV 的 v=0 行，也就是纹理
 * 的底边——UV 原点在左下角，下标 (0,0) 是左下角像素。图片文件的存储
 * 习惯正相反：第 0 行是顶行。所以直接上传图片文件而不开
 * UNPACK_FLIP_Y_WEBGL 时，文件的顶行会落在 v=0 的底边上——贴上去整个
 * 上下颠倒；那个开关在上传时把行序倒一次。而本函数按 UV 约定生成，
 * 第 0 行生来就是底边，直接上传即正立。
 *
 * 颜色约定：格 (0,0)（左下角）为黑 (0,0,0,255)，相邻格互反——
 * (cx+cy) 偶为黑、奇为白 (255,255,255,255)；黑白格数沿每条边都是
 * cells。约定 size 是 cells 的整倍数（格边是整数像素，格子方正）。
 */
export function checkerboard(size: number, cells: number): Uint8Array {
  const data = new Uint8Array(size * size * 4)
  const edge = size / cells // 格边（像素）：一格里挤着 edge×edge 个像素
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dark = (Math.floor(x / edge) + Math.floor(y / edge)) % 2 === 0
      const level = dark ? 0 : 255 // 黑白两档，写满 RGBA 四个字节
      const o = (y * size + x) * 4
      data[o] = level
      data[o + 1] = level
      data[o + 2] = level
      data[o + 3] = 255
    }
  }
  return data
}
