// companion/scripts/lib/server.mjs · 构建产物服务器的生命周期（构建/启动/停止，Windows 兼容）
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const OUTPUT_SERVER = join(ROOT, '.output', 'server', 'index.mjs')
export const NUXT_BIN = join(ROOT, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs')
export const PORT = Number(process.env.PORT ?? 4311)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', ...opts })
    proc.on('error', reject)
    proc.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} 退出码 ${code}`)),
    )
  })
}

/** 确保构建产物存在：SKIP_BUILD=1 时跳过（要求 .output 已在），否则跑 nuxt build */
export async function ensureBuild() {
  if (process.env.SKIP_BUILD === '1') {
    if (!existsSync(OUTPUT_SERVER))
      throw new Error('SKIP_BUILD=1 但 .output 不存在——先完整跑一次 pnpm build')
    return 'skipped'
  }
  await run(process.execPath, [NUXT_BIN, 'build'], { cwd: ROOT })
  return 'built'
}

/** 启动构建产物服务器并等待就绪；返回 { proc, port, base, stop } */
export async function startServer({ port = PORT } = {}) {
  if (!existsSync(OUTPUT_SERVER))
    throw new Error(`未找到构建产物 ${OUTPUT_SERVER}——先跑 ensureBuild() 或 pnpm build`)
  const proc = spawn(process.execPath, [OUTPUT_SERVER], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  proc.stdout.on('data', (d) => (output += d))
  proc.stderr.on('data', (d) => (output += d))

  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null)
      throw new Error(`服务器提前退出（code ${proc.exitCode}）：\n${output}`)
    try {
      const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(1500) })
      if (res.status < 500) return { proc, port, base, stop: () => stopServer(proc) }
    } catch {
      /* 还没起来，继续等 */
    }
    await sleep(200)
  }
  await stopServer(proc)
  throw new Error(`服务器 30s 内未就绪：\n${output}`)
}

/** 停服务器：先常规 kill，Windows 上用 taskkill /T /F 兜底进程树 */
export function stopServer(proc) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) return resolve()
    const finish = () => resolve()
    proc.once('exit', finish)
    proc.kill()
    setTimeout(() => {
      if (proc.exitCode !== null) return
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
          .on('exit', () => {})
          .on('error', () => {})
      }
      setTimeout(finish, 1500)
    }, 800)
  })
}
