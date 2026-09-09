// scripts/gen-cert.mjs · 生成本地演练用的自签名证书（pnpm gen:cert）
//
// 产物：nginx/certs/server.crt + server.key（SAN 含 localhost 与 127.0.0.1，
// 供 https://localhost:8443 与 https://127.0.0.1:8443 两种写法都能完成握手）。
// 边界如实交代：
//   - 自签证书不在任何浏览器的信任链里，客户端要 -k（curl）或手动点「继续访问」；
//   - 它只服务本地演练。生产用 CA 签发（Let's Encrypt 一条链路在正文 runbook），
//     换台机器重新跑一遍本脚本即可，不需要拷贝旧证书；
//   - 正因如此，nginx/certs/ 整个目录在 .gitignore 里——私钥永不入库，
//     与 .env 的纪律同源：仓库里只留生成方式，不留产物本身。
import { spawnSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const CERTS_DIR = join(ROOT, 'nginx', 'certs')
const CRT = join(CERTS_DIR, 'server.crt')
const KEY = join(CERTS_DIR, 'server.key')

mkdirSync(CERTS_DIR, { recursive: true })

// openssl 一条命令完成「自建 CA + 自签」：req -x509 直接产出自签证书，无需先建 CA 再签发。
// 参数逐个说明见正文「自签名证书」一节；-addext 把 SAN 写进证书——
// 现代客户端（浏览器、curl、Node）校验的是 SAN，不再看 CN。
const res = spawnSync(
  'openssl',
  [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '60', '-nodes',
    '-keyout', KEY,
    '-out', CRT,
    '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ],
  { stdio: 'inherit' },
)

if (res.error) {
  console.error(`[cert] 找不到 openssl 命令：${res.error.message} —— Git Bash / WSL / macOS / Linux 自带；Windows 原生终端需自行安装。`)
  process.exit(1)
}
if (res.status !== 0) {
  console.error(`[cert] openssl 退出码 ${res.status}。`)
  process.exit(res.status ?? 1)
}

for (const f of [CRT, KEY]) {
  if (!existsSync(f)) {
    console.error(`[cert] openssl 报成功但 ${f} 不存在——异常现场，请重跑。`)
    process.exit(1)
  }
}

console.log(`[cert] 自签证书已生成（60 天）：`)
console.log(`[cert]   证书 ${CRT}`)
console.log(`[cert]   私钥 ${KEY}（不入库；nginx/certs/ 在 .gitignore）`)
console.log(`[cert] 下一步: pnpm sim:prod 起生产拓扑，或直接 docker compose -f compose.prod.yaml up -d --wait`)
