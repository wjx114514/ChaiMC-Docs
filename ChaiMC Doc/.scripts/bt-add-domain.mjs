// 为 chaimcdoc.fkgw.work 域名启用现有站点，并添加代理透传头
import { Client } from 'ssh2'
const HOST = process.env.DEPLOY_HOST || '156.239.236.106'
const USER = process.env.DEPLOY_USER || 'root'
const PWD = process.env.DEPLOY_PASSWORD
const NEW_DOMAIN = 'chaimcdoc.fkgw.work'

const distDir = '/var/www/chaimc-docs'
const SERVER_NAMES = [NEW_DOMAIN, HOST].join(' ')

const vhostBlock = `server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAMES} _;
    root ${distDir};
    index index.html;
    charset utf-8;

    # --- HTTP / 反向代理透传头（当套 Cloudflare / 反代 / CDN 时正确拿到真实客户端 IP 和协议）---
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Port  $server_port;
    proxy_http_version 1.1;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    location ~* \\.(?:css|js|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp|avif)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        add_header X-Cache "HIT";
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri.html $uri/ /index.html;
    }

    location ~ /\\. {
        deny all;
    }
}
`

function run(conn, cmd) {
  return new Promise((res, rej) => {
    let o = '', e = ''
    console.log('\n$', cmd.length > 220 ? cmd.slice(0, 220) + '…' : cmd)
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
    console.log('✅ SSH 连接成功')

    // 1) 定位 nginx bin + conf
    const nginxBin = (await run(conn, 'which nginx')).trim()
    const V = await run(conn, `${nginxBin} -V 2>&1 | head -40`)
    let prefix = '', confPath = ''
    const pm = V.match(/--prefix=(\S+)/)
    if (pm) prefix = pm[1]
    if (prefix) {
      try { confPath = (await run(conn, `[ -f ${prefix}/conf/nginx.conf ] && echo "${prefix}/conf/nginx.conf"`)).trim() } catch {}
    }
    if (!confPath) confPath = '/www/server/nginx/conf/nginx.conf'
    console.log(`nginx: ${nginxBin}  conf: ${confPath}`)

    // 2) 定位 vhost 目录（找我们之前写的 chaimc-docs.conf，否则回退到默认 vhost 目录）
    let vhostDir = ''
    const tryDirs = [
      '/www/server/panel/vhost/nginx',
      '/www/server/nginx/conf/vhost',
      '/etc/nginx/sites-available',
      '/etc/nginx/conf.d',
    ]
    for (const d of tryDirs) {
      try {
        const out = await run(conn, `[ -d "${d}" ] && (ls "${d}" 2>/dev/null | grep -qi "chaimc" && echo "${d}") || true`)
        if (out && out.includes(d)) { vhostDir = d; break }
      } catch {}
    }
    if (!vhostDir) {
      // 没找到含 chaimc 的已有 vhost，就找第一个存在的目录
      for (const d of tryDirs) {
        try {
          const out = await run(conn, `[ -d "${d}" ] && echo "${d}" || true`)
          if (out && out.includes(d)) { vhostDir = d; break }
        } catch {}
      }
    }
    if (!vhostDir) throw new Error('找不到可写入的 vhost 目录')
    const vhostFile = `${vhostDir}/chaimc-docs.conf`
    console.log(`写入 vhost 文件: ${vhostFile}`)

    // 3) 用 heredoc 写入
    await run(conn, `mkdir -p "${vhostDir}" && cat > "${vhostFile}" <<'CHMC_EOF'\n${vhostBlock}\nCHMC_EOF\n`)
    console.log('✅ vhost 文件已写入')

    // 4) 确保 nginx.conf include 了此 vhost 目录（和之前 deploy 脚本一致）
    let nginxConfText = ''
    try { nginxConfText = await run(conn, `cat "${confPath}"`) } catch {}
    const vhostGlob = `${vhostDir.replace(/\/$/, '')}/*.conf`
    if (nginxConfText && !nginxConfText.includes(vhostGlob)) {
      console.log(`⚠️  nginx.conf 尚未 include ${vhostGlob}，自动追加 include 语句...`)
      const pattern = vhostGlob.replace(/\//g, '\\/')
      await run(conn, `perl -0777 -i -pe 's/(http\\s*\\n?\\s*\\{)/$1\\n    include ${pattern};\\n/' "${confPath}" || true`)
    }

    // 5) 如果是 Debian /etc/nginx/sites-available，还要软链到 sites-enabled
    if (vhostDir === '/etc/nginx/sites-available') {
      await run(conn, `mkdir -p /etc/nginx/sites-enabled && ln -sf "${vhostFile}" /etc/nginx/sites-enabled/chaimc-docs && rm -f /etc/nginx/sites-enabled/default 2>/dev/null; true`)
    }

    // 6) nginx -t 与 reload
    await run(conn, `${nginxBin} -c ${confPath} -t`)
    console.log('✅ nginx -t 通过')
    await run(conn, `${nginxBin} -c ${confPath} -s reload || systemctl restart nginx`)
    console.log('✅ nginx 已重载')

    // 7) 自证：curl 本机，并带上 Host: chaimcdoc.fkgw.work 头模拟真实访问
    console.log('--- curl 本机 127.0.0.1 带 Host 头模拟 chaimcdoc.fkgw.work 访问 ---')
    try {
      const r = await run(conn, `curl -sS -H "Host: ${NEW_DOMAIN}" -o /dev/null -w "HTTP_%{http_code}_size_%{size_download}_\\n" http://127.0.0.1/`)
      console.log('结果：', r)
    } catch {}
    console.log('--- curl 本机 127.0.0.1 带 Host 头访问 /基础教程/1.加入前的准备工作 ---')
    try {
      const r = await run(conn, `curl -sS -H "Host: ${NEW_DOMAIN}" -o /dev/null -w "HTTP_%{http_code}_size_%{size_download}_\\n" "http://127.0.0.1/基础教程/1.加入前的准备工作"`)
      console.log('结果：', r)
    } catch {}

    console.log('\n🎉 完成！')
    console.log(`   server_name：${SERVER_NAMES}`)
    console.log(`   部署后可访问：  http://${NEW_DOMAIN}/ （等 DNS 解析生效后）`)
  } finally { conn.end() }
}
main().catch(e => { console.error('\n❌', e.message || e); process.exit(1) })
