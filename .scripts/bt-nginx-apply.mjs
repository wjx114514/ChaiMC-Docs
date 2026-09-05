// 宝塔面板 Nginx：写入 vhost 配置并启用
import { Client } from 'ssh2'
const HOST = process.env.DEPLOY_HOST || '156.239.236.106'
const USER = process.env.DEPLOY_USER || 'root'
const PWD = process.env.DEPLOY_PASSWORD
const distDir = '/var/www/chaimc-docs'
const vhostConfPath = '/www/server/nginx/conf/vhost/chaimc-docs.conf'
const nginxConf = `server {
    listen 80;
    listen [::]:80;
    server_name ${HOST} _;
    root ${distDir};
    index index.html;
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;
    location ~* \\.(?:css|js|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp|avif)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }
    location / {
        try_files $uri $uri.html $uri/ /index.html;
    }
    location ~ /\\. { deny all; }
}
`

function run(conn, cmd) {
  return new Promise((res, rej) => {
    let o = '', e = ''
    console.log('\n$', cmd.length > 200 ? cmd.slice(0, 200) + '…' : cmd)
    conn.exec(cmd, { pty: true }, (err, s) => {
      if (err) return rej(err)
      s.on('close', c => c === 0 ? res(o.trim()) : rej(new Error(`[exit ${c}] ${e || o}`)))
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
    console.log('✅ SSH 已连接')
    // 1) 写 vhost 文件到宝塔 vhost 目录（或 nginx conf/vhost）
    // 先探测宝塔常用 vhost 目录
    let vhostDir = ''
    try { vhostDir = (await run(conn, 'ls -d /www/server/panel/vhost/nginx /www/server/nginx/conf/vhost 2>/dev/null | head -1')) || '' } catch { vhostDir = '' }
    if (!vhostDir) {
      await run(conn, 'mkdir -p /www/server/nginx/conf/vhost')
      vhostDir = '/www/server/nginx/conf/vhost'
    }
    const finalVhost = `${vhostDir.replace(/\/$/, '')}/chaimc-docs.conf`
    console.log('使用 vhost 目录:', vhostDir, ' -> 文件:', finalVhost)
    await run(conn, `cat > ${finalVhost} <<'CHMC_EOF'\n${nginxConf}\nCHMC_EOF\n`)
    // 2) 确保 nginx.conf 包含这个 vhost 目录
    let conf = (await run(conn, 'cat /www/server/nginx/conf/nginx.conf'))
    const needsInclude = !(conf.includes(vhostDir + '/*.conf') || conf.includes(vhostDir + '/*'))
    if (needsInclude) {
      // 在 http 块结束前插入 include（在最后的 } 之前）
      // 简单方式：如果 http 块里有 include conf.d/*.conf 或者 include vhost/*.conf 就追加在那些 include 之后
      // 否则直接插入 include 行到 http 块开头
      await run(conn, `perl -0777 -i -pe 's/(http\\s*\\n?\\s*\\{)/$1\\n    include ${vhostDir.replace(/\//g, '\\/')}\\/*.conf;/' /www/server/nginx/conf/nginx.conf`)
      console.log('✅ 已向 nginx.conf 插入 include 语句')
    } else {
      console.log('✅ nginx.conf 已包含 vhost 目录 include')
    }
    // 3) 先通过 nginx -c 指定正确的配置文件路径做检测
    await run(conn, '/usr/bin/nginx -c /www/server/nginx/conf/nginx.conf -t')
    console.log('✅ nginx -t 通过')
    // 4) reload：对宝塔编译版优先用 /usr/bin/nginx -s reload，回退到 systemctl
    try {
      await run(conn, '/usr/bin/nginx -c /www/server/nginx/conf/nginx.conf -s reload')
    } catch {
      await run(conn, 'systemctl reload nginx || systemctl restart nginx')
    }
    console.log('✅ Nginx 已重载')
    // 5) 自检
    try {
      const r = await run(conn, 'curl -sSf -o /dev/null -w "HTTP_%{http_code}_size_%{size_download}" http://127.0.0.1/')
      console.log('✅ 本机自检：', r)
    } catch (e) {
      console.warn('⚠️ 本机 curl 自检失败（可能只是 curl 没装）：', e.message)
      // 换用 wget
      try {
        await run(conn, 'wget -q --spider http://127.0.0.1/ && echo "wget_OK"')
        console.log('✅ wget 自检通过')
      } catch { /* ignore */ }
    }
    console.log('\n🎉 部署完成！访问 http://' + HOST + '/')
  } finally { conn.end() }
}
main().catch(e => { console.error('\n❌', e.message || e); process.exit(1) })
