// 一次性修复：在服务器完成 Nginx 配置并启用站点
import { Client } from 'ssh2'

const HOST = process.env.DEPLOY_HOST || '156.239.236.106'
const PORT = parseInt(process.env.DEPLOY_PORT || '22', 10)
const USER = process.env.DEPLOY_USER || 'root'
const PWD = process.env.DEPLOY_PASSWORD

const distDir = '/var/www/chaimc-docs'
const siteName = 'chaimc-docs'
const nginxConf = `# VitePress 静态站点 - 自动部署生成
server {
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

    location ~ /\\. {
        deny all;
    }
}
`

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    console.log(`$ ${cmd.split('\n')[0].slice(0, 120)}${cmd.includes('\n') ? ' …(多行)' : ''}`)
    conn.exec(cmd, { pty: true }, (e, stream) => {
      if (e) return reject(e)
      stream
        .on('close', (code) => {
          if (code === 0) resolve(out)
          else reject(new Error(`[${code}] ${err || out}`))
        })
        .on('data', (d) => { out += d; process.stdout.write(d) })
        .stderr.on('data', (d) => { err += d; process.stderr.write(d) })
    })
  })
}

async function main() {
  if (!PWD) throw new Error('需设置 DEPLOY_PASSWORD')
  const conn = new Client()
  await new Promise((res, rej) =>
    conn.on('ready', res).on('error', rej).connect({
      host: HOST, port: PORT, username: USER, password: PWD, readyTimeout: 20000,
    }),
  )
  console.log('✅ connected')
  try {
    // 先用 heredoc 写入 nginx 配置
    await exec(conn, `mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d && cat > /etc/nginx/sites-available/${siteName} <<'TEEK_NGINX_EOF'\n${nginxConf}\nTEEK_NGINX_EOF\n`)
    console.log('✅ 已写入 nginx 站点配置')
    // 启用：sites-enabled 软链 + conf.d 复制，双保险
    await exec(conn, `ln -sf /etc/nginx/sites-available/${siteName} /etc/nginx/sites-enabled/${siteName} && rm -f /etc/nginx/sites-enabled/default 2>/dev/null; cp -f /etc/nginx/sites-available/${siteName} /etc/nginx/conf.d/${siteName}.conf`)
    // 同时确保 nginx.conf 中 sites-enabled 已被 include
    await exec(conn, `grep -q 'sites-enabled' /etc/nginx/nginx.conf || sed -i 's|\\tinclude /etc/nginx/conf.d/\\*.conf;|&\\n\\tinclude /etc/nginx/sites-enabled/*;|' /etc/nginx/nginx.conf`)
    await exec(conn, 'nginx -t')
    console.log('✅ nginx -t 通过')
    await exec(conn, 'systemctl reload nginx || systemctl restart nginx')
    console.log('✅ nginx 已重载')
    // 自检
    try {
      const r = await exec(conn, 'curl -sSf -o /dev/null -w "HTTP %{http_code} | size=%{size_download}\\n" http://127.0.0.1/')
      console.log('✅ 本机自检：', r.trim())
    } catch (e) {
      console.warn('⚠️ 本机 curl 自检失败：', e.message)
    }
    // 外网访问链接
    console.log(`\n🎉 站点可访问：http://${HOST}/`)
  } finally {
    conn.end()
  }
}
main().catch((e) => { console.error('❌', e.message || e); process.exit(1) })
