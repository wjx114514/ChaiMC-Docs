#!/usr/bin/env node
/**
 * VitePress SSH 部署脚本（方式 B：服务器端构建 + Nginx 托管）
 *
 * 流程：
 *   1. 本地将项目源码打成 .tar.gz（排除 node_modules/.git/.obsidian/构建产物等）
 *   2. 通过 SSH + SCP 上传源码包到服务器
 *   3. 在服务器端：
 *        - 如无 Node.js ≥ 18，自动通过 NodeSource 安装
 *        - 如无 Nginx，自动 apt 安装
 *        - 解压 → npm ci / npm install → npm run build
 *        - 把 .vitepress/dist 拷贝到 /var/www/<站点名>
 *        - 写入 Nginx site 配置并启用 → nginx -t && systemctl reload nginx
 *
 * 使用方法（PowerShell，一行）：
 *   $env:DEPLOY_HOST="156.239.236.106" ;
 *   $env:DEPLOY_USER="root" ;
 *   $env:DEPLOY_PASSWORD="你的密码" ;
 *   npm run deploy:ssh
 *
 * 其他可选环境变量：
 *   DEPLOY_PORT              SSH 端口，默认 22
 *   DEPLOY_SOURCE_DIR        服务器源码目录，默认 /root/chaimc-doc
 *   DEPLOY_DIST_DIR          Nginx 静态文件目录，默认 /var/www/chaimc-docs
 *   DEPLOY_NGINX_SITE        Nginx 配置名，默认 chaimc-docs
 *   DEPLOY_DOMAIN            站点域名（空格分隔多个，含 IP），默认用服务器公网 IP
 */

import { Client } from 'ssh2'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as tar from 'tar'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

function step(msg) {
  console.log(`\n=== ${msg} ===`)
}
function ok(msg) {
  console.log(`  ✅ ${msg}`)
}
function warn(msg) {
  console.warn(`  ⚠️  ${msg}`)
}
function fail(msg, err) {
  console.error(`  ❌ ${msg}`)
  if (err) console.error(err.message || err)
  process.exit(1)
}

// ---------- 读取环境变量 ----------
const CFG = {
  host: process.env.DEPLOY_HOST,
  port: parseInt(process.env.DEPLOY_PORT || '22', 10),
  user: process.env.DEPLOY_USER || 'root',
  password: process.env.DEPLOY_PASSWORD,
  sourceDir: process.env.DEPLOY_SOURCE_DIR || '/root/chaimc-doc',
  distDir: process.env.DEPLOY_DIST_DIR || '/var/www/chaimc-docs',
  nginxSite: process.env.DEPLOY_NGINX_SITE || 'chaimc-docs',
  domain: process.env.DEPLOY_DOMAIN,
}

if (!CFG.host) fail('请设置 DEPLOY_HOST 环境变量')
if (!CFG.password) fail('请设置 DEPLOY_PASSWORD 环境变量')

CFG.domain = CFG.domain || CFG.host

// ---------- 1. 打包源码 ----------
async function packSource() {
  step('1. 打包项目源码（tar.gz）')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chaimc-deploy-'))
  const tarball = path.join(tmp, 'chaimc-doc.tar.gz')

  const exclude = [
    'node_modules',
    '.git',
    '.github',
    '.gitignore',
    '.vitepress/dist',
    '.vitepress/cache',
    '.obsidian',
    '.trash',
    'dist',
    '*.log',
    '.DS_Store',
  ]

  await tar.c(
    {
      gzip: { level: 6 },
      file: tarball,
      cwd: PROJECT_ROOT,
      filter: (p) => {
        const rel = p.replace(/\\/g, '/')
        return !exclude.some((ex) => {
          if (ex.startsWith('*')) return rel.endsWith(ex.slice(1))
          return rel === ex || rel.startsWith(ex + '/')
        })
      },
    },
    ['.'],
  )

  const size = (fs.statSync(tarball).size / 1024).toFixed(1)
  ok(`打包完成：${tarball}（${size} KB）`)
  return tarball
}

// ---------- SSH 封装 ----------
function connectSSH() {
  step(`2. 连接 SSH ${CFG.user}@${CFG.host}:${CFG.port}`)
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn
      .on('ready', () => {
        ok('SSH 已连接')
        resolve(conn)
      })
      .on('error', (e) => reject(e))
      .connect({
        host: CFG.host,
        port: CFG.port,
        username: CFG.user,
        password: CFG.password,
        readyTimeout: 20000,
      })
  })
}

function execCmd(conn, cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    conn.exec(cmd, { pty: true, ...opts }, (err, stream) => {
      if (err) return reject(err)
      stream
        .on('close', (code) => {
          if (code === 0) resolve({ code, stdout, stderr })
          else reject(new Error(`命令失败 (exit ${code}):\nCMD: ${cmd.slice(0, 400)}\nSTDERR: ${stderr}\nSTDOUT: ${stdout}`))
        })
        .on('data', (d) => {
          stdout += d
          process.stdout.write(d)
        })
        .stderr.on('data', (d) => {
          stderr += d
          process.stderr.write(d)
        })
    })
  })
}

function uploadFile(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err)
      sftp.fastPut(localPath, remotePath, (err2) => {
        if (err2) return reject(err2)
        resolve()
      })
    })
  })
}

/** 通过 SSH heredoc 直接写入小文本文件，避免 sftp 流事件在部分服务端阻塞 */
function writeFileViaHeredoc(conn, content, remotePath) {
  const marker = '__CHMC_EOF_MARKER_' + Math.random().toString(36).slice(2, 10) + '__'
  const safe = content.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/`/g, '\\`')
  return execCmd(conn, `mkdir -p "$(dirname '${remotePath}')" && cat > '${remotePath}' <<'${marker}'\n${safe}\n${marker}\n`)
}

// ---------- Nginx 配置 ----------
function nginxConfig() {
  // 支持 space / comma / semicolon / Chinese comma 分隔的多域名
  const names = String(CFG.domain || CFG.host)
    .split(/[\s,，;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!names.includes(CFG.host) && CFG.host) names.push(CFG.host)
  const serverNames = names.join(' ') + ' _'
  return `server {
    listen 80;
    listen [::]:80;
    server_name ${serverNames};
    root ${CFG.distDir};
    index index.html;
    charset utf-8;

    # HTTP / 反向代理透传头（套 Cloudflare / CDN / 反代时拿到真实客户端 IP 与协议，避免 URL 错乱）
    proxy_set_header Host              \$host;
    proxy_set_header X-Real-IP         \$remote_addr;
    proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host  \$host;
    proxy_set_header X-Forwarded-Port  \$server_port;
    proxy_http_version 1.1;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # VitePress 静态资源长缓存
    location ~* \\.(?:css|js|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp|avif)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    # 支持 clean URL：/xxx -> /xxx.html
    location / {
        try_files \$uri \$uri.html \$uri/ /index.html;
    }

    location ~ /\\. {
        deny all;
    }
}
`
}

// ---------- 主流程 ----------
async function main() {
  console.log('🧰 ChaiMC Doc SSH 部署（方式 B：服务器端构建）')
  console.log(`   服务器     : ${CFG.user}@${CFG.host}:${CFG.port}`)
  console.log(`   源码目录   : ${CFG.sourceDir}`)
  console.log(`   站点目录   : ${CFG.distDir}`)
  console.log(`   Nginx 站点 : ${CFG.nginxSite} (server_name: ${CFG.domain})`)

  const tarball = await packSource()
  const conn = await connectSSH()
  const remoteTar = `${CFG.sourceDir}/chaimc-doc.tar.gz`

  try {
    // 3. 准备目录 + 上传
    step('3. 上传源码包到服务器')
    await execCmd(conn, `mkdir -p "${CFG.sourceDir}" "${CFG.distDir}"`)
    await uploadFile(conn, tarball, remoteTar)
    ok(`已上传 -> ${remoteTar}`)

    // 4. 解压
    step('4. 解压源码包')
    await execCmd(conn, `tar -xzf "${remoteTar}" -C "${CFG.sourceDir}" && rm -f "${remoteTar}"`)
    ok('解压完成')

    // 5. 安装 Node.js (如未装)
    step('5. 检查 Node.js 环境')
    let nodeVer
    try {
      const { stdout } = await execCmd(conn, "node -v 2>/dev/null || echo '__NO_NODE__'")
      nodeVer = stdout.trim()
    } catch {
      nodeVer = '__NO_NODE__'
    }
    if (nodeVer.includes('__NO_NODE__') || !nodeVer.startsWith('v')) {
      warn('未检测到 Node.js，正在通过 NodeSource 安装 Node.js 20 LTS ...')
      const cmds = [
        'apt-get update -y',
        'apt-get install -y ca-certificates curl gnupg',
        'mkdir -p /etc/apt/keyrings',
        'curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg',
        "echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main' > /etc/apt/sources.list.d/nodesource.list",
        'apt-get update -y',
        'apt-get install -y nodejs',
      ]
      for (const c of cmds) await execCmd(conn, c)
    }
    const nv = (await execCmd(conn, 'node -v')).stdout.trim()
    const npmv = (await execCmd(conn, 'npm -v')).stdout.trim()
    ok(`Node.js ${nv} / npm ${npmv}`)

    // 5b. 锁定 package-lock（无 package-lock 时生成占位，避免 npm install 因缺少 lock 反复变动）
    //     （注：不要调用 npm approve-scripts，因为 npm 官方包无此子命令，由本项目本地 allowScripts 配置保证即可）

    // 6. 安装依赖
    step('6. 安装 npm 依赖')
    await execCmd(
      conn,
      `cd "${CFG.sourceDir}" && npm config set fund false && if [ -f package-lock.json ]; then npm ci; else npm install; fi`,
    )
    ok('依赖安装完成')

    // 7. 构建 VitePress
    step('7. 在服务器执行 npm run build')
    await execCmd(conn, `cd "${CFG.sourceDir}" && npm run build`)
    ok('构建成功')

    // 8. 拷贝到 nginx 目录
    step('8. 同步构建产物到 Nginx 站点目录')
    await execCmd(conn, `rm -rf "${CFG.distDir}"/* && cp -a "${CFG.sourceDir}/.vitepress/dist/." "${CFG.distDir}/"`)
    ok(`已同步到 ${CFG.distDir}`)

    // 9. 安装 Nginx (如未装) —— 支持标准 Ubuntu Nginx / 宝塔面板(www/server/nginx)
    step('9. 检查并配置 Nginx')
    let nginxInfo = {
      bin: '',
      conf: '',
      vhostDir: '',
      reloadCmd: '',
    }
    try {
      nginxInfo.bin = (await execCmd(conn, "which nginx 2>/dev/null || echo '__NO_NGINX__'")).stdout.trim()
    } catch {
      nginxInfo.bin = '__NO_NGINX__'
    }
    if (nginxInfo.bin.includes('__NO_NGINX__')) {
      warn('未检测到 Nginx，正在 apt 安装标准 Ubuntu nginx ...')
      await execCmd(conn, 'apt-get update -y && apt-get install -y nginx && systemctl enable --now nginx')
      nginxInfo = {
        bin: '/usr/sbin/nginx',
        conf: '/etc/nginx/nginx.conf',
        vhostDir: '/etc/nginx/sites-available',
        reloadCmd: 'systemctl reload nginx || systemctl restart nginx',
      }
    } else {
      ok(`Nginx 存在：${nginxInfo.bin}`)
      // 探测编译参数
      let prefix = ''
      let confArg = ''
      try {
        const { stdout } = await execCmd(conn, `${nginxInfo.bin} -V 2>&1 || true`)
        const pm = stdout.match(/--prefix=(\S+)/)
        const cm = stdout.match(/--conf-path=(\S+)/)
        if (pm) prefix = pm[1]
        if (cm) confArg = cm[1]
      } catch {
        /* ignore */
      }
      if (!confArg) {
        // 探测常见路径
        const probes = [
          `${prefix}/conf/nginx.conf`,
          '/www/server/nginx/conf/nginx.conf',
          '/www/server/nginx/conf/proxy.conf',
          '/etc/nginx/nginx.conf',
        ]
        const { stdout } = await execCmd(
          conn,
          `for f in ${probes.map((p) => `"${p}"`).join(' ')}; do [ -f "$f" ] && echo "$f" && break; done; echo __END__`,
        )
        confArg = stdout.split('\n').map((l) => l.trim()).find((l) => l && l !== '__END__') || ''
      }
      nginxInfo.conf = confArg
      if (!nginxInfo.conf) nginxInfo.conf = '/etc/nginx/nginx.conf'

      // 探测 vhost include 目录
      // 1) /etc/nginx/sites-available (Debian standard)
      // 2) /www/server/panel/vhost/nginx (BT panel modern)
      // 3) /www/server/nginx/conf/vhost (BT panel old)
      // 4) /etc/nginx/conf.d
      const vhostProbes = [
        '/etc/nginx/sites-available',
        '/www/server/panel/vhost/nginx',
        '/www/server/nginx/conf/vhost',
        '/etc/nginx/conf.d',
      ]
      const vr = (await execCmd(
        conn,
        `for d in ${vhostProbes.map((d) => `"${d}"`).join(' ')}; do [ -d "$d" ] && echo "$d" && break; done; echo '__NO_DIR__'`,
      )).stdout.trim()
      nginxInfo.vhostDir = vr.includes('__NO_DIR__') ? vhostProbes[0] : vr

      // 决定 reload 命令：BT panel 下用 nginx -s reload，标准下 systemctl
      const isBt = nginxInfo.conf.includes('/www/server/')
      nginxInfo.reloadCmd = isBt
        ? `${nginxInfo.bin} -c ${nginxInfo.conf} -s reload || systemctl restart nginx`
        : `systemctl reload nginx || systemctl restart nginx || ${nginxInfo.bin} -s reload`
    }

    ok(`Nginx bin=${nginxInfo.bin}  conf=${nginxInfo.conf}  vhostDir=${nginxInfo.vhostDir}`)

    // 10. 写入并启用站点配置
    step('10. 写入并启用 Nginx 站点配置')
    await execCmd(conn, `mkdir -p "${nginxInfo.vhostDir}"`)
    const vhostFile = `${nginxInfo.vhostDir.replace(/\/$/, '')}/${CFG.nginxSite}.conf`
    const nginxBlock = nginxConfig()
    // 用 heredoc 写入，避免 sftp 流阻塞
    await writeFileViaHeredoc(conn, nginxBlock, vhostFile)

    // 对于 Debian 风格（sites-available / sites-enabled），再建软链
    if (nginxInfo.vhostDir === '/etc/nginx/sites-available') {
      try {
        await execCmd(
          conn,
          `mkdir -p /etc/nginx/sites-enabled && ln -sf "${vhostFile}" "/etc/nginx/sites-enabled/${CFG.nginxSite}" && rm -f /etc/nginx/sites-enabled/default 2>/dev/null; true`,
        )
      } catch {
        /* ignore */
      }
    }

    // 如果 nginx.conf 里尚未 include 我们的 vhost 目录，向 http 块补一条
    let nginxConfText = ''
    try {
      nginxConfText = (await execCmd(conn, `cat "${nginxInfo.conf}"`)).stdout
    } catch {
      nginxConfText = ''
    }
    const inclPattern = `${nginxInfo.vhostDir.replace(/\/$/, '')}/*.conf`.replace(/\//g, '\\/')
    const vhostGlob = `${nginxInfo.vhostDir.replace(/\/$/, '')}/*.conf`
    if (nginxConfText && !nginxConfText.includes(vhostGlob)) {
      warn(`nginx.conf 尚未 include ${vhostGlob}，自动追加...`)
      // 替换第一个 http { ... 的起始
      await execCmd(
        conn,
        `perl -0777 -i -pe 's/(http\\s*\\n?\\s*\\{)/$1\\n    include ${inclPattern};\\n/' "${nginxInfo.conf}" || true`,
      )
    }

    // 测试 & 重载
    const testCmd = nginxInfo.conf
      ? `${nginxInfo.bin} -c ${nginxInfo.conf} -t`
      : `${nginxInfo.bin} -t`
    await execCmd(conn, testCmd)
    ok('nginx -t 通过')
    await execCmd(conn, nginxInfo.reloadCmd)
    ok('Nginx 已重载')

    // 11. 简单自测
    step('11. 部署自检（访问本机 80 端口）')
    try {
      const { stdout } = await execCmd(
        conn,
        `curl -sSf -o /dev/null -w "HTTP %{http_code} | size=%{size_download}" http://127.0.0.1/ || echo '__FAIL__'`,
      )
      if (stdout.includes('FAIL')) {
        warn('无法在本机 curl 到 80，请确认 nginx 已启动')
      } else {
        ok(stdout.trim())
      }
    } catch (e) {
      warn(`curl 失败：${e.message}`)
    }

    step('✅ 部署完成！')
    console.log(`   访问地址：http://${CFG.host}/`)
    if (CFG.domain && CFG.domain !== CFG.host) {
      console.log(`   （你还可以通过配置的 server_name 域名访问：${CFG.domain}）`)
    }
  } finally {
    try { fs.unlinkSync(tarball) } catch {}
    conn.end()
  }
}

main().catch((e) => fail('部署失败', e))
