// 调试：找 nginx 的 conf 路径和安装信息
import { Client } from 'ssh2'
const HOST = process.env.DEPLOY_HOST || '156.239.236.106'
const USER = process.env.DEPLOY_USER || 'root'
const PWD = process.env.DEPLOY_PASSWORD
function run(conn, cmd) {
  return new Promise((res, rej) => {
    let o = '', e = ''
    console.log('\n$', cmd)
    conn.exec(cmd, { pty: true }, (err, s) => {
      if (err) return rej(err)
      s.on('close', (c) => c === 0 ? res(o) : rej(new Error(`[${c}] ${e || o}`)))
       .on('data', d => { o += d; process.stdout.write(d) })
       .stderr.on('data', d => { e += d; process.stderr.write(d) })
    })
  })
}
async function main() {
  const conn = new Client()
  await new Promise((res, rej) => conn.on('ready', res).on('error', rej).connect({ host: HOST, username: USER, password: PWD, readyTimeout: 20000 }))
  try {
    await run(conn, 'which nginx && nginx -V 2>&1 | head -40')
    await run(conn, 'ls -la /etc/nginx 2>&1; echo ---; find / -name "nginx.conf" 2>/dev/null | head -10; echo ---; find / -name "mime.types" -path "*nginx*" 2>/dev/null | head -5; echo ---; systemctl status nginx --no-pager -l 2>&1 | head -20')
  } finally { conn.end() }
}
main().catch(e => { console.error('❌', e.message || e); process.exit(1) })
