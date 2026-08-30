// companion/demo/aead-tunnel-demo.ts —— 亲手开机：中间人视角看加密两跳
// 第一幕：一笔正常请求穿过抄录探针——链路上抓到的全是「盐 + 密文块」，明文与目标地址都找不到
// 第二幕：探针翻一个密文字节再放行——远端验漆失败，立刻收线（拒收即断开）
// 跑法：cd companion && npm run demo:aead-tunnel
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { deriveSubkey, sealChunk, SALT_LEN } from '../src/crypto'
import { connectViaRelay, startRelayServer } from '../src/relay'
import { startSocks5Server } from '../src/socks5'

const PASSWORD = 'mini-clash-demo-password'
const MARKER = 'secret-payload'

// —— 小工具：事件驱动等待，与测试同一件手艺 ——

type Pipe = net.Socket | Duplex // 能 write、能 on('data') 的就是一根管子

function readExact(sock: Pipe, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    sock.on('data', (b: Buffer) => {
      buf = Buffer.concat([buf, b])
      if (buf.length >= n) {
        sock.removeAllListeners('data')
        sock.removeAllListeners('error')
        resolve(buf)
      }
    })
    sock.once('error', reject)
  })
}

function readUntil(sock: Pipe, needle: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    sock.on('data', (b: Buffer) => {
      buf = Buffer.concat([buf, b])
      if (buf.includes(needle)) {
        sock.removeAllListeners('data')
        sock.removeAllListeners('error')
        resolve(buf)
      }
    })
    sock.once('error', reject)
  })
}

function waitClose(sock: Pipe): Promise<void> {
  return new Promise((resolve) => sock.once('close', () => resolve()))
}

// —— 角色 ——

// 行协议目标站：攒到一行回大写整行
const target = net.createServer((s) => {
  let buf = Buffer.alloc(0)
  s.on('data', (b: Buffer) => {
    buf = Buffer.concat([buf, b])
    const i = buf.indexOf('\n')
    if (i < 0) return
    s.write(buf.subarray(0, i).toString('latin1').toUpperCase() + '\n')
    buf = buf.subarray(i + 1)
  })
})

// 中间人探针：透明转发两个方向，抄录「入口 → 远端」方向经过的全部字节
function startTap(downPort: number): Promise<{ port: number; seen: () => Buffer }> {
  let record = Buffer.alloc(0)
  const tap = net.createServer((front) => {
    const back = net.connect(downPort, '127.0.0.1')
    front.on('data', (b: Buffer) => {
      record = Buffer.concat([record, b]) // 旁观者的全部功课：抄下来，慢慢看
      back.write(b)
    })
    back.on('data', (b: Buffer) => front.write(b))
    const hangup = () => {
      front.destroy()
      back.destroy()
    }
    front.on('close', hangup)
    back.on('close', hangup)
    front.on('error', hangup)
    back.on('error', hangup)
  })
  return new Promise((resolve) => {
    tap.listen(0, '127.0.0.1', () => resolve({ port: (tap.address() as net.AddressInfo).port, seen: () => record }))
  })
}

function connect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => resolve(s))
    s.once('error', reject)
  })
}

// —— 开机 ——

target.listen(0, '127.0.0.1', () => {
  const tport = (target.address() as net.AddressInfo).port
  void Promise.all([startRelayServer({ port: 0 }), startRelayServer({ port: 0, password: PASSWORD })]).then(
    async ([plainRelay, cipherRelay]) => {
      const tapHolder = await startTap(cipherRelay.port) // 探针立在密文中继前面：站在第二跳线路上抄包
      void startSocks5Server({
        port: 0,
        onConnect: (t) => connectViaRelay({ host: '127.0.0.1', port: tapHolder.port }, t, PASSWORD),
      }).then(async (entry) => {
        console.log('目标站已监听:            127.0.0.1:' + tport)
        console.log('明文中继已监听（对照用）: 127.0.0.1:' + plainRelay.port)
        console.log('密文中继已监听（已上锁）: 127.0.0.1:' + cipherRelay.port)
        console.log('中间人探针已监听:         127.0.0.1:' + tapHolder.port)
        console.log('SOCKS5 入口已监听:        127.0.0.1:' + entry.port)
        console.log('（入口 → 探针 → 密文中继：探针就站在第二跳的线路上抄包。）')
        console.log('')

        // —— 第一幕：一笔正常请求，穿过探针 —— 
        console.log('—— 第一幕：一笔正常请求穿过中间人 ——')
        const browser = await connect(entry.port)
        browser.write(Buffer.from([0x05, 0x01, 0x00])) // SOCKS5：你好，我只会无认证
        await readExact(browser, 2)
        const ip = '127.0.0.1'.split('.').map(Number)
        browser.write(Buffer.from([0x05, 0x01, 0x00, 0x01, ...ip, tport >> 8, tport & 0xff])) // CONNECT 目标站
        await readExact(browser, 10)
        browser.write(MARKER + '\n') // 应用写下的明文载荷
        const echoed = await readUntil(browser, 'SECRET-PAYLOAD')
        console.log(`应用视角: 写入 '${MARKER}'，收到回声 '${echoed.toString().trim().toUpperCase()}' —— 链路可用`)
        await new Promise((r) => setTimeout(r, 100)) // 给探针一点时间把尾部字节抄完

        const seen = tapHolder.seen()
        console.log(`中间人视角: 共抄到 ${seen.length} 字节`)
        console.log(`  开头 32 字节（盐）:            ${seen.subarray(0, SALT_LEN).toString('hex')}`)
        console.log(`  随后 36 字节（第 0 块的开头）: ${seen.subarray(SALT_LEN, SALT_LEN + 36).toString('hex')}……`)
        console.log(`  在抄录里找明文载荷 '${MARKER}' → ${seen.includes(Buffer.from(MARKER)) ? '找得到（泄露！）' : '找不到'}`)
        const connectBytes = Buffer.from([0x01, ...ip, tport >> 8, tport & 0xff])
        console.log(`  在抄录里找目标地址 ${connectBytes.toString('hex')} → ${seen.includes(connectBytes) ? '找得到（泄露！）' : '找不到'}`)
        browser.destroy()

        // —— 第二幕：同一个探针搬到明文中继前面，同样的请求再走一遍（对照组）—— 
        console.log('')
        console.log('—— 第二幕：对照——同样的请求走第 4 章明文链路 ——')
        const plainTap = await startTap(plainRelay.port)
        const plainLink = await connectViaRelay(
          { host: '127.0.0.1', port: plainTap.port },
          { host: '127.0.0.1', port: tport },
        )
        plainLink.write(MARKER + '\n')
        await readUntil(plainLink, 'SECRET-PAYLOAD')
        await new Promise((r) => setTimeout(r, 100))
        const plainRecord = plainTap.seen()
        console.log(`中间人视角: 共抄到 ${plainRecord.length} 字节`)
        console.log(`  开头即是明文 CONNECT 帧:       ${plainRecord.subarray(0, 7).toString('hex')}（目标一目了然）`)
        console.log(`  在抄录里找明文载荷 '${MARKER}' → ${plainRecord.includes(Buffer.from(MARKER)) ? '找得到（裸奔）' : '找不到'}`)
        plainLink.destroy()

        // —— 第三幕：中间人翻一个密文字节再放行 —— 
        console.log('')
        console.log('—— 第三幕：翻一个密文字节，看远端什么反应 ——')
        const raw = await connect(cipherRelay.port)
        const salt = Buffer.from('0123456789abcdef0123456789abcdef') // 演示用定值盐，与测试同一件手艺
        const key = deriveSubkey(PASSWORD, salt)
        const body = Buffer.from(MARKER + '\n')
        const frame = Buffer.concat([Buffer.from([body.length >> 8, body.length & 0xff]), body]) // 第 4 章数据帧
        const broken = Buffer.from(sealChunk(key, 1, frame))
        broken[2 + 16 + 3] ^= 0xff // 跳过「2 字节加密长度 + 16 字节长度火漆」，翻载荷密文里的一个字节
        raw.write(Buffer.concat([salt, sealChunk(key, 0, connectBytes), broken]))
        await waitClose(raw) // 远端拆到坏块即收线
        console.log('中间人翻了一个字节放行 → 远端验漆失败，连接立刻被收线，坏块一个字节也没进目标')
        console.log('（对照：第 4 章明文链路上，改一个字节会原样流进目标——协议毫无察觉。）')
        console.log('')
        console.log('收摊。真实部署里中间人站在你与远端之间的网络路径上；教学版把他搬进本机回环，形状不变。')
        process.exit(0)
      })
    },
  )
})
