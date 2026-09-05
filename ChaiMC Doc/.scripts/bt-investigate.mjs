// 侦查宝塔面板：bt 命令、面板数据存储、已有网站情况
import { Client } from 'ssh2'
const HOST = process.env.DEPLOY_HOST || '156.239.236.106'
const USER = process.env.DEPLOY_USER || 'root'
const PWD = process.env.DEPLOY_PASSWORD
function run(conn, cmd) {
  return new Promise((res, rej) => {
    let o = '', e = ''
    console.log('\n$', cmd.slice(0, 200) + (cmd.length > 200 ? '…' : ''))
    conn.exec(cmd, { pty: true }, (err, s) => {
      if (err) return rej(err)
      s.on('close', c => c === 0 ? res(o) : rej(new Error(`[exit ${c}] ${e || o}`)))
       .on('data', d => { o += d; process.stdout.write(d) })
       .stderr.on('data', d => { e += d; process.stderr.write(d) })
    })
  })
}
async function main() {
  if (!PWD) throw new Error('需设置 DEPLOY_PASSWORD')
  const conn = new Client()
  await new Promise((res, rej) => conn.on('ready', res).on('error', rej).connect({ host: HOST, username: USER, password: PWD, readyTimeout: 20000 }))
  try {
    console.log('=== 1. 宝塔 CLI 是否存在 ===')
    try { await run(conn, 'which bt 2>/dev/null; echo ---; bt 2>&1 | head -60; echo ---; ls /www/server/panel/ 2>/dev/null | head -30') } catch (e) { console.log(e.message) }

    console.log('\n=== 2. 面板数据库/数据文件位置 ===')
    try { await run(conn, 'ls /www/server/panel/data/ 2>/dev/null | head -60; echo ---; find /www/server/panel/data -maxdepth 2 \\( -name "*.db" -o -name "*.json" \\) 2>/dev/null | head -30') } catch (e) { console.log(e.message) }

    console.log('\n=== 3. 已有网站注册（若有）===')
    try {
      await run(conn, 'for f in /www/server/panel/data/*.json; do echo "--- $f ---"; cat "$f" 2>/dev/null | head -100; done')
    } catch (e) { console.log(e.message) }

    console.log('\n=== 4. BT 默认网站根目录 & 已存在 wwwroot 站点 ===')
    try { await run(conn, 'ls -la /www/wwwroot/ 2>/dev/null; echo ---; ls /www/server/panel/vhost/nginx/ 2>/dev/null') } catch (e) { console.log(e.message) }

    console.log('\n=== 5. 我们之前的 vhost 状态 ===')
    try { await run(conn, 'ls -la /www/server/nginx/conf/vhost/ 2>/dev/null; echo ---; grep -n "chaimc-docs\\|156.239.236.106" /www/server/nginx/conf/nginx.conf 2>/dev/null | head -20') } catch (e) { console.log(e.message) }
  } finally { conn.end() }
}
main().catch(e => { console.error('❌', e.message || e); process.exit(1) })
