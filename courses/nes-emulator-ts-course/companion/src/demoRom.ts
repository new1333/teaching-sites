// 内置演示卡带：一张用 6502 机器码现场拼出来的「试机带」——
// 开机画满屏棋盘背景，中间放一枚笑脸精灵，方向键推着它走。
// 与课程测试同款做法（手写字节 + makeNromCartridge 组装），零外部 ROM。
//
// 布局：复位程序 $8000、NMI 程序 $9000、调色板数据 $9100，向量在 $FFFA-$FFFD。

import { makeNromCartridge } from './fixtures'

// ---- 复位段 $8000：等 VBlank → 写调色板 → 铺棋盘 nametable → 开显示，然后原地打转 ----
const code: number[] = [
  0x78, // $8000 SEI：关中断
  0xd8, // $8001 CLD：关十进制模式（2A03 没有这功能，习惯性声明）
  0xa2, 0xff, // $8002 LDX #$FF
  0x9a, // $8004 TXS：栈顶复位到 $FF
  0x2c, 0x02, 0x20, // $8005 BIT $2002：读一次状态，清掉残留的 VBlank 标志
  0x2c, 0x02, 0x20, // $8008 w1: BIT $2002
  0x10, 0xfb, // $800B BPL w1：bit7 还是 0（没进 VBlank）就继续等
  0x2c, 0x02, 0x20, // $800D w2: BIT $2002（等第二次，上电稳定惯例）
  0x10, 0xfb, // $8010 BPL w2
  // 写调色板：$2006 两拍指到 $3F00，再连写 32 格（$2007 自动递增）
  0xa9, 0x3f, // $8012 LDA #$3F
  0x8d, 0x06, 0x20, // $8014 STA $2006：地址高半
  0xa9, 0x00, // $8017 LDA #$00
  0x8d, 0x06, 0x20, // $8019 STA $2006：地址低半 → 指到 $3F00
  0xa2, 0x00, // $801C LDX #$00
  0xbd, 0x00, 0x91, // $801E palLoop: LDA $9100,X：逐字节搬调色板表
  0x8d, 0x07, 0x20, // $8021 STA $2007
  0xe8, // $8024 INX
  0xe0, 0x20, // $8025 CPX #$20：32 格写满？
  0xd0, 0xf5, // $8027 BNE palLoop
  // 铺 nametable：程序生成棋盘——tile 号 = (行号 ^ 列号) & 1 再 +1，交替用 tile 1/2
  0xa9, 0x20, // $8029 LDA #$20
  0x8d, 0x06, 0x20, // $802B STA $2006
  0xa9, 0x00, // $802E LDA #$00
  0x8d, 0x06, 0x20, // $8030 STA $2006：指到 $2000（nametable 0 起点）
  0xa0, 0x00, // $8033 LDY #$00：行号 0-29
  0x84, 0x02, // $8035 rowLoop: STY $02：行号存零页
  0xa2, 0x00, // $8037 LDX #$00：列号 0-31
  0x8a, // $8039 colLoop: TXA
  0x45, 0x02, // $803A EOR $02：列号 ^ 行号
  0x29, 0x01, // $803C AND #$01
  0x18, // $803E CLC
  0x69, 0x01, // $803F ADC #$01：+1 → tile 1 或 2 的棋盘格
  0x8d, 0x07, 0x20, // $8041 STA $2007
  0xe8, // $8044 INX
  0xe0, 0x20, // $8045 CPX #$20
  0xd0, 0xf0, // $8047 BNE colLoop：本行 32 格写完
  0xa4, 0x02, // $8049 LDY $02：取回行号
  0xc8, // $804B INY
  0xc0, 0x1e, // $804C CPY #$1E
  0xd0, 0xe5, // $804E BNE rowLoop：30 行写完
  // 属性表 64 格全 0：全部用背景调色板 0
  0xa2, 0x00, // $8050 LDX #$00
  0xa9, 0x00, // $8052 attrLoop: LDA #$00
  0x8d, 0x07, 0x20, // $8054 STA $2007
  0xe8, // $8057 INX
  0xe0, 0x40, // $8058 CPX #$40
  0xd0, 0xf6, // $805A BNE attrLoop
  // 滚动归零 + 渲染起点复位：调色板写完后 t 停在 $3F20，必须指回 $2000
  0xa9, 0x00, // $805C LDA #$00
  0x8d, 0x05, 0x20, // $805E STA $2005：X 滚动 0
  0x8d, 0x05, 0x20, // $8061 STA $2005：Y 滚动 0（A 仍是 0）
  0xa9, 0x20, // $8064 LDA #$20
  0x8d, 0x06, 0x20, // $8066 STA $2006
  0xa9, 0x00, // $8069 LDA #$00
  0x8d, 0x06, 0x20, // $806B STA $2006：t 指回 $2000，下帧从画面原点渲染
  // 精灵初始位置：屏幕中心附近（Y 从下一行起画，所以给 123）
  0xa9, 0x7b, // $806E LDA #$7B：Y = 123
  0x85, 0x00, // $8070 STA $00
  0xa9, 0x7c, // $8072 LDA #$7C：X = 124
  0x85, 0x01, // $8074 STA $01
  // 开机：NMI 使能 + 背景精灵显示
  0xa9, 0x80, // $8076 LDA #$80
  0x8d, 0x00, 0x20, // $8078 STA $2000：PPUCTRL bit7，每帧末响铃
  0xa9, 0x1e, // $807B LDA #$1E
  0x8d, 0x01, 0x20, // $807D STA $2001：显示背景 + 精灵
  0x4c, 0x80, 0x80, // $8080 mainLoop: JMP mainLoop：活儿全交给 NMI 程序
]

// ---- NMI 段 $9000：每帧一次——读手柄、挪精灵、OAM DMA ----
const nmi: number[] = [
  // 读手柄：strobe 一高一低锁存快照，连读 8 次逐位滚进零页 $10
  0xa9, 0x01, // $9000 LDA #$01
  0x8d, 0x16, 0x40, // $9002 STA $4016：strobe 拉高
  0xa9, 0x00, // $9005 LDA #$00
  0x8d, 0x16, 0x40, // $9007 STA $4016：strobe 落回 0
  0xa9, 0x00, // $900A LDA #$00
  0x85, 0x10, // $900C STA $10：手柄快照清零
  0xa2, 0x08, // $900E LDX #$08：8 个键
  0xad, 0x16, 0x40, // $9010 readLoop: LDA $4016：吐出下一位键态
  0x4a, // $9013 LSR A：bit0 挪进进位 C
  0x26, 0x10, // $9014 ROL $10：C 滚进快照低位
  0xca, // $9016 DEX
  0xd0, 0xf7, // $9017 BNE readLoop：读完 8 位，最先读的 A 键落在 bit7
  // 方向键 → 挪精灵（每帧 2 像素）；$00 是 Y、$01 是 X
  0xa5, 0x10, // $9019 LDA $10
  0x29, 0x08, // $901B AND #$08：Up
  0xf0, 0x04, // $901D BEQ +：没按就跳过两条 DEC
  0xc6, 0x00, // $901F DEC $00
  0xc6, 0x00, // $9021 DEC $00
  0xa5, 0x10, // $9023 +: LDA $10
  0x29, 0x04, // $9025 AND #$04：Down
  0xf0, 0x04, // $9027 BEQ +
  0xe6, 0x00, // $9029 INC $00
  0xe6, 0x00, // $902B INC $00
  0xa5, 0x10, // $902D +: LDA $10
  0x29, 0x02, // $902F AND #$02：Left
  0xf0, 0x04, // $9031 BEQ +
  0xc6, 0x01, // $9033 DEC $01
  0xc6, 0x01, // $9035 DEC $01
  0xa5, 0x10, // $9037 +: LDA $10
  0x29, 0x01, // $9039 AND #$01：Right
  0xf0, 0x04, // $903B BEQ +
  0xe6, 0x01, // $903D INC $01
  0xe6, 0x01, // $903F INC $01
  // 0 号精灵四件套：Y、tile 3（笑脸）、属性 0、X
  0xa5, 0x00, // $9041 +: LDA $00
  0x8d, 0x00, 0x02, // $9043 STA $0200
  0xa9, 0x03, // $9046 LDA #$03
  0x8d, 0x01, 0x02, // $9048 STA $0201
  0xa9, 0x00, // $904B LDA #$00
  0x8d, 0x02, 0x02, // $904D STA $0202
  0xa5, 0x01, // $9050 LDA $01
  0x8d, 0x03, 0x02, // $9052 STA $0203
  // 其余 63 个精灵 Y 一律 $F0（屏幕外藏起来）
  0xa2, 0x04, // $9055 LDX #$04：从 1 号精灵的 Y 位（字节 4）起
  0xa9, 0xf0, // $9057 hideLoop: LDA #$F0
  0x9d, 0x00, 0x02, // $9059 STA $0200,X
  0xe8, 0xe8, 0xe8, 0xe8, // $905C INX ×4：步进到下一个精灵的 Y 位
  0xd0, 0xf5, // $9060 BNE hideLoop：X 绕回 0，说明 64 个都藏完了
  // OAM DMA：OAM 地址归零，把 $0200 整页灌进 PPU 的精灵内存
  0xa9, 0x00, // $9062 LDA #$00
  0x8d, 0x03, 0x20, // $9064 STA $2003
  0xa9, 0x02, // $9067 LDA #$02
  0x8d, 0x14, 0x40, // $9069 STA $4014：DMA 页 = $0200
  0x40, // $906C RTI
]

// ---- 调色板数据 $9100：32 格 = 通用背景色 + 4 组背景 + 4 组精灵 ----
const paletteData: number[] = [
  0x0f, 0x21, 0x01, 0x12, // 背景 0：底黑；tile 1 用色 1（米白）、tile 2 点阵用色 3（深蓝）
  0x0f, 0x0f, 0x0f, 0x0f, // 背景 1-3：备而未用
  0x0f, 0x0f, 0x0f, 0x0f,
  0x0f, 0x0f, 0x0f, 0x0f,
  0x0f, 0x30, 0x11, 0x16, // 精灵 0：$3F10 镜像回 $3F00；笑脸轮廓用色 1（白）、五官用色 3（红）
  0x0f, 0x0f, 0x0f, 0x0f, // 精灵 1-2：备而未用
  0x0f, 0x0f, 0x0f, 0x0f,
]

// ---- CHR：tile 1 实心块、tile 2 点阵、tile 3 笑脸 ----
function makeChr(): Uint8Array {
  const chr = new Uint8Array(0x2000)
  for (let y = 0; y < 8; y++) {
    chr[1 * 16 + y] = 0xff // tile 1 低平面全 1 → 整块色号 1
    chr[1 * 16 + 8 + y] = 0x00
    chr[2 * 16 + y] = 0xff // tile 2 低平面全 1
    chr[2 * 16 + 8 + y] = 0x55 // 高平面隔列出 1 → 色号 1/3 交替的点阵
  }
  // tile 3 笑脸：8×8 两色手绘位图（X=轮廓、O=五官、.=透明）
  // . X X X X X X .
  // X . . . . . . X
  // X . O . . O . X
  // X . . . . . . X
  // X . O O O O . X
  // X . . . . . . X
  // . X X X X X X .
  // . . . . . . . .
  const faceLo = [0x7e, 0x81, 0xa5, 0x81, 0xbd, 0x81, 0x7e, 0x00]
  const faceHi = [0x00, 0x00, 0x24, 0x00, 0x3c, 0x00, 0x00, 0x00]
  for (let y = 0; y < 8; y++) {
    chr[3 * 16 + y] = faceLo[y]
    chr[3 * 16 + 8 + y] = faceHi[y]
  }
  return chr
}

export function demoRom(): Uint8Array {
  const prg = new Array<number>(0x4000).fill(0)
  prg.splice(0, code.length, ...code)
  prg.splice(0x1000, nmi.length, ...nmi) // $9000 段
  prg.splice(0x1100, paletteData.length, ...paletteData) // $9100 表
  prg[0x3ffa] = 0x00
  prg[0x3ffb] = 0x90 // NMI 向量 → $9000
  prg[0x3ffc] = 0x00
  prg[0x3ffd] = 0x80 // 复位向量 → $8000
  return makeNromCartridge({ prg, chr: Array.from(makeChr()) })
}
