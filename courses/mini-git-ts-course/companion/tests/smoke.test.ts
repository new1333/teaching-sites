// tests/smoke.test.ts
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.ts'

describe('mini-git 脚手架冒烟测试', () => {
  it('--help 打印用法', () => {
    const out = runCli(['--help'])
    expect(out).toContain('用法')
    expect(out).toContain('--help')
  })

  it('无参数与 --help 输出完全一致', () => {
    expect(runCli([])).toBe(runCli(['--help']))
  })

  it('未知命令给提示而不是崩溃', () => {
    const out = runCli(['frobnicate', '--x'])
    expect(out).toContain("未知命令 'frobnicate'")
  })
})
