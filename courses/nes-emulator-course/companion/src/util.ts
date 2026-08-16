// 数值归一化:6502 是 8 位机,地址 16 位,溢出必须静默回卷。
export const u8 = (v: number): number => v & 0xff
export const u16 = (v: number): number => v & 0xffff
export const i8 = (v: number): number => (v << 24) >> 24
