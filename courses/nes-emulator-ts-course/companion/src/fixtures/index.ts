// 课程自产测试卡带：用代码现场拼 iNES 字节流，零版权 ROM、零外部下载。

export function makeNromCartridge(opts: {
  prg: number[]
  chr?: number[]
  mirroring?: 'horizontal' | 'vertical'
}): Uint8Array {
  const { prg, chr = [], mirroring = 'horizontal' } = opts
  if (prg.length % 0x4000 !== 0) throw new Error('PRG must be a multiple of 16KB')
  const header = [
    0x4e, 0x45, 0x53, 0x1a, // magic "NES\x1a"
    prg.length / 0x4000, // PRG 16KB 单位数
    Math.ceil(chr.length / 0x2000), // CHR 8KB 单位数
    mirroring === 'vertical' ? 0b0001 : 0b0000, // flags6：bit0 镜像方向
    0, 0, 0, 0, 0, 0, 0, 0, 0, // 补齐 16 字节头
  ]
  return Uint8Array.from([...header, ...prg, ...chr])
}

// 把程序放进 PRG 并补好 $FFFC/$FFFD 复位向量（16KB PRG 时向量落在 PRG 末两字节）
export function prgWithReset(code: number[], start: number): number[] {
  const prg = new Array<number>(0x4000).fill(0)
  prg.splice(0, code.length, ...code)
  prg[0x3ffc] = start & 0xff // $FFFC：入口低字节
  prg[0x3ffd] = (start >> 8) & 0xff // $FFFD：入口高字节
  return prg
}
