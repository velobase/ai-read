# 账号与身份

参考本机 Veloagent 的 `apps/web/src/server/auth/` 和 `infrastructure/prisma/schema.prisma`，使用 Auth.js v5、Google OAuth 和 Prisma / PostgreSQL。UI 沿用 AI Read 的阅读、书架、笔记、我结构。未引入 Veloagent 的支付、遥测、邮件登录或管理员权限系统。

## 用户体验

- `/login`：Google 登录、明确的失败提示和继续游客阅读入口。OAuth 完成后只允许返回本站相对路径。
- `/me`、`/me/profile`：区分游客与已验证账户；游客资料保存在本机，登录用户的昵称、简介与头像颜色保存到 PostgreSQL。
- `/me/account`：只读邮箱、稳定账户 UUID、创建时间、Google 登录绑定、当前及其他会话；可以撤销其他会话或退出当前账号。
- `/me/data`：明确的本机数据说明和“导入本机游客书库”。先显示书籍和笔记数量，确认后复制，保留游客原件及目标书库的已有版本。
- 阅读仍可免登录使用；配置账户服务后，AI API 要求有效登录。预置译文与本机已有内容仍可读取。登录不会自动发起模型请求。

## PostgreSQL

`prisma/schema.prisma` 包含 `User`、`Account`、`Session`：用户 UUID 独立于邮箱；登录身份由 `(provider, providerAccountId)` 唯一确定，不按邮箱自动合并账户。Google 必须返回已验证邮箱。没有密码登录、密码哈希、隐含管理员或凭空生成的账号。

本地开发使用 `compose.yaml` 的独立 PostgreSQL 17 容器，端口 `127.0.0.1:54341`，数据存在 Docker 命名卷。没有复用其他项目的数据库或创建付费 Cloud SQL。线上可替换 `DATABASE_URL`，需单独准备托管数据库、TLS 和备份。

```sh
cp .env.example .env
# 分别生成 AUTH_SECRET 和 POSTGRES_PASSWORD，填入 .env；保持数据库 URL 密码一致。
openssl rand -hex 32
openssl rand -hex 32
npm ci
npm run db:up
npm run db:migrate
npm run dev
```

`npm ci` 自动生成 Prisma Client。迁移使用 `migrate deploy`，不自动重置数据库。停止容器可用 `docker compose stop postgres`；不要使用 `down -v`，它会删除数据库卷。只要不配置 Google 登录，本机游客模式不依赖数据库。

## Google OAuth

配置 `AUTH_ENABLED=true`、`AUTH_SECRET`、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET`、`DATABASE_URL` 和 `APP_ORIGIN`。启用认证但配置缺失时拒绝访问，不会回退成可匿名调用的 AI 网关。带公网 `APP_ORIGIN` 的实例也要求认证完整。

Google Cloud 项目：`velobase-ai-read-auth`，客户端名称：`AI Read Local Web`。当前为 External / Testing；已加入项目所有者的 Google 账号作为开发用户，没有发布为公共应用。客户端只申请 `openid email profile`，不申请邮件、文件、日历或后台离线访问。

本地 Web 客户端已配置以下回调地址：

- `http://127.0.0.1:4173/api/auth/callback/google`
- `http://localhost:4173/api/auth/callback/google`

`127.0.0.1` 和 `localhost` 的浏览器存储仍彼此独立，请保持原有访问地址。不要为两个本地别名配置固定 `AUTH_URL`；Auth.js 从经代理校验的 Host 和协议计算回调地址。上线后使用 HTTPS 的 `APP_ORIGIN`、对应 Google 回调地址和独立生产凭据；正式域名、品牌主页、隐私政策和 OAuth 发布需要随上线完成。

凭据仅写入 Git 忽略的 `.env`，文件权限为 0600；不记录在此文档或前端。开发配置不会携带到别人克隆的仓库。

## 会话与请求边界

- 服务端数据库会话，30 天寿命。Cookie 为 HttpOnly / SameSite=Lax，HTTPS 使用 Secure 和 `__Secure-` 名称。
- PG 只保存会话令牌的 SHA-256 摘要；会话列表不返回令牌或摘要。OAuth access / refresh / ID tokens 不写数据库。
- Google 流程校验 PKCE、state 和 nonce；邮箱不允许由资料 API 改写。
- 撤销会话按服务器确认的用户 ID 过滤，立即阻断其后续 API 调用；浏览器在获得焦点、身份广播和 60 秒刷新时更新身份。
- `src/proxy.ts` 校验 Host，重建可信的 forwarded-host/proto。修改资料、撤销会话等写请求必须具有同源 Origin；只有 Google 的 GET 回调允许跨站导航，仍由 Auth.js 校验 OAuth 防护值。
- `/api/account` 的 PATCH 仅允许昵称、简介、预定义头像颜色；读取和写入都从会话取得用户 ID。客户端不能指定目标用户。
- Auth.js 错误日志仅输出错误类名；不记录 OAuth 凭据或回调内容。

## 本地数据归属

原 `ai-read` IndexedDB 和原 localStorage key 保留，定义为游客空间。数据库以增量方式升级到 v2，不删除原对象仓库。登录用户使用 `ai-read:user:<UUID>` 数据库；阅读设置、书架 metadata、活动书籍、返回位置也按 UUID 区分。账户资料读取服务端身份，不把它当作 localStorage 的登录凭据。

身份确定前不挂载阅读组件；页面生命周期内固定存储空间，身份变化强制完整重载，清除内存 API Key 并中断请求，避免旧异步保存被写到新账号。跨标签信号只发送时间戳，不发送邮箱、书籍或令牌。

这属于应用层的账户空间划分，不是对同一操作系统使用者的加密保护。服务器撤销会话不能远程删除浏览器文件；登录后的书籍与阅读数据通过 `/api/sync` 同步到当前部署，游客数据不自动上传。删除浏览器站点数据会丢失游客数据及未同步的修改，请先逐个账号导出备份。

同步接口只信任服务端会话的用户 ID，所有实体按用户隔离，并校验 `x-reader-user` 与会话一致，避免切换账号时旧请求进入新账号。每条记录使用版本校验和 mutation ID；服务端短事务串行化同一账号写入，保留删除标记。客户端将本地修改与待同步记录放在同一 IndexedDB 事务内；书架和偏好沿用 localStorage，并在重启时对账。完整实体和冲突规则见 [架构说明](architecture.md)。

## 验证范围

遵从项目偏好，不编写或运行单元、集成和端到端自动化测试，不调用付费模型。交付执行 Prisma 生成、迁移、TypeScript 检查、生产构建与静态审阅。真实 Google 登录回调、跨设备会话撤销、同步、断网重连、冲突处理及用户书库迁移由用户验收。

参考：[Auth.js Google](https://authjs.dev/getting-started/providers/google)、[Prisma adapter](https://authjs.dev/getting-started/adapters/prisma)、[Prisma PostgreSQL](https://www.prisma.io/docs/orm/overview/databases/postgresql)。
