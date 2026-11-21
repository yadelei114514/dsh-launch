# DSH Launch

DeepSeek Harness（dsh）的网页管理控制台：启停服务、查看状态与日志、展示并复制 `dsh web` 的 token，以及管理 npm 安装的 dsh 版本。目标环境为单台 Linux 服务器，公网通过反向代理与 HTTPS 访问。

## 架构

- **Node.js / TypeScript** 后端 + 原生网页前端（无前端构建步骤）。
- 每个托管服务是一个独立的 **systemd 系统单元**（`dsh-launch-<id>.service`）；systemd 负责进程守护、开机自启、cgroup 内存限制与日志采集。
- 管理页只接受 **dsh profile（子命令）** 作为启动项，命令、参数与环境变量经后端校验后写入单元，避免变成任意命令执行入口。
- 管理员账号密码以 **scrypt 加盐哈希** 存储，登录走会话 Cookie。
- `dsh web` 每次启动后会打印 `dsh web: http://127.0.0.1:PORT/?token=XXXX`，后端从该服务的新日志中提取 `?token=` 后的值，生成可复制的公网访问链接。

## 目录

```
src/            后端源码（TypeScript）
  cli.ts          命令行入口：serve / install / set-password
  server.ts       HTTP API 与静态页面
  service-manager.ts  服务状态、token 捕获、退避守护
  systemd.ts      单元生成与 systemctl/journalctl 封装
  versions.ts     npm 版 dsh 安装 / 切换 / 回退
  config.ts       配置与服务定义、管理员账号
  password.ts     scrypt 哈希
  session.ts      会话
web/            前端（index.html / app.js / style.css）
deploy/         dsh-launch 自身 systemd 单元与 sudoers 示例
```

## 安装

### 一行安装（源码构建，推荐）

```bash
git clone https://github.com/yadelei114514/dsh-launch.git && cd dsh-launch && npm install && npm run build
```

### 方式一：源码安装（分步）

```bash
git clone https://github.com/yadelei114514/dsh-launch.git
cd dsh-launch
npm install
npm run build
```

### 方式二：本地目录直接安装

```bash
cd /path/to/dsh-launch
npm install
npm run build
```

### 方式三：全局命令安装（本地链接，可任目录使用 dsh-launch）

```bash
cd dsh-launch
npm install && npm run build
npm link          # 将 dsh-launch 链接为全局命令

dsh-launch install      # 交互式初始化
dsh-launch serve        # 启动管理页
```

> 全局安装后可省略 `node dist/cli.js`，直接用 `dsh-launch <命令>`。

### 初始化管理员账号

安装后首次使用需设置管理员账号（用户名可自定义，例如 `admin`；密码在终端交互输入，仅存 scrypt 哈希，不明文落盘）：

```bash
export DSH_LAUNCH_HOME=/var/lib/dsh-launch   # 数据目录，可自定义（默认 ./data）
node dist/cli.js set-password                # 按提示输入用户名与密码
# 用户名可自定义，默认 admin
```

> 也可以在交互式部署 `node dist/cli.js install` 流程中一并设置账号。

### 启动

```bash
node dist/cli.js serve                       # 默认 http://127.0.0.1:8081
# 可用 DSH_LAUNCH_BIND_HOST / DSH_LAUNCH_BIND_PORT 覆盖监听地址
```

生产环境建议按下文「部署」章节用 systemd 常驻，并通过反向代理加 HTTPS。

## 构建

```bash
npm install
npm run build        # 产出 dist/
npm test             # 编译并运行单元测试（12 项：密码哈希、单元生成、输入校验）
```

## 部署（Linux，systemd 系统服务）

1. 安装到 `/opt/dsh-launch`，数据目录用 `/var/lib/dsh-launch`。
2. 建服务账号并给予**受限** sudo（仅 `dsh-launch-*` 单元，见 `deploy/sudoers.d-dsh-launch`）：
   ```bash
   sudo useradd --system --home /var/lib/dsh-launch --shell /usr/sbin/nologin dsh-launch
   sudo mkdir -p /opt/dsh-launch /var/lib/dsh-launch
   sudo cp -r . /opt/dsh-launch/
   sudo cp deploy/sudoers.d-dsh-launch /etc/sudoers.d/dsh-launch
   sudo chown -R dsh-launch:dsh-launch /opt/dsh-launch /var/lib/dsh-launch
   ```
3. 交互式初始化（配置域名、管理员密码、默认 `dsh web` 服务单元）：
   ```bash
   sudo -u dsh-launch DSH_LAUNCH_HOME=/var/lib/dsh-launch \
     node /opt/dsh-launch/dist/cli.js install
   ```
   说明：安装脚本会写入 `data/config.json`、`data/admin.json`（哈希），并生成 `/etc/systemd/system/dsh-launch-<id>.service`。
4. 安装并启动管理服务本体：
   ```bash
   sudo cp deploy/dsh-launch.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now dsh-launch
   ```
5. 反向代理（示例 Nginx），launch 与 dsh 各用一个子域名：
   ```nginx
   server {
     server_name launch.example.com;
     location / { proxy_pass http://127.0.0.1:8081; proxy_set_header Host $host; }
   }
   server {
     server_name dsh.example.com;
     location / { proxy_pass http://127.0.0.1:3080; proxy_set_header Host $host;
                  proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
   }
   ```
   TLS 由代理负责。管理页仅监听 `127.0.0.1`，不直接暴露公网。

## 使用

- 浏览器打开 `https://launch.example.com`，用安装时设置的账号登录。
- **站点配置**：填写管理页域名、`dsh web` 公网域名（用于生成 token 链接）、dsh 可执行文件路径。
- **新增/编辑服务**：填写 profile、参数、环境变量、工作目录、端口、重启策略、内存上限、dsh 版本、是否开机自启。
- 服务卡片可启动、停止、重启、查看日志（实时流）、显示/复制 token、复制完整访问链接。
- **dsh 版本**：从 npm 安装指定版本到隔离目录，切换后重启对应服务生效；旧版本保留可回退。

## 重启与内存策略

- **指数退避并暂停**：systemd 负责崩溃自动拉起；管理页的后台看门狗统计连续失败次数，达到 `maxRestarts` 后停止并标记「已暂停」，等待人工处理。
- **固定间隔重启 / 不重启**：由 systemd `Restart=on-failure` + `RestartSec` 或 `Restart=no` 控制。
- **内存上限**：写入 `MemoryMax=<MiB>M`，作用于整个服务 cgroup。

## 安全要点

- 密码仅存 scrypt 哈希，明文不落盘。
- 会话 Cookie `httpOnly` + `sameSite=lax`；TLS 由反向代理终止。
- 服务账号仅有受限 sudo（只能操作 `dsh-launch-*` 单元与对应 journal）。
- 启动项限定为 dsh profile，参数禁止换行注入，环境变量键名校验。
- 单元使用 dsh 与 node 的**绝对路径**及显式 `PATH`，规避 systemd 不继承登录 PATH 的问题（nvm 安装的 dsh 尤其需要）。

## 本地快速验证

```bash
export DSH_LAUNCH_HOME=/tmp/dshl-test DSH_LAUNCH_BIND_PORT=18081
node dist/cli.js set-password     # 设置测试账号
node dist/cli.js serve            # 打开 http://127.0.0.1:18081
```
