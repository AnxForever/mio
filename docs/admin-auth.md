# 管理后台账号体系

Mio 现在支持控制台账号登录，不再要求多人共享同一个 `MIO_AUTH_TOKEN`。

## 角色边界

- Owner：首次初始化创建。可以创建其他控制台账号。
- Admin：预留给运营/配置人员。当前可以登录控制台，后续可细分权限。
- Viewer：预留只读观察角色。
- Legacy token：`MIO_AUTH_TOKEN` 仍然作为本地 owner 兼容入口，也作为首次初始化的 setup token。

## 首次初始化

如果 `data/auth/users.json` 不存在或为空，登录页会显示“创建 Owner 账号”。

当 `.env` 配置了 `MIO_AUTH_TOKEN` 时，创建 Owner 必须输入这个 token 作为 setup token。创建完成后，后续使用用户名和密码登录。

账号和会话保存在：

```text
data/auth/users.json
data/auth/sessions.json
```

密码不会明文保存，使用 scrypt 加盐哈希。会话 token 只保存 SHA-256 哈希。

## API

```text
GET  /auth/status
POST /auth/bootstrap
POST /auth/login
GET  /auth/me
POST /auth/logout
GET  /admin/users
POST /admin/users
```

`POST /admin/users` 需要 Owner 或 legacy token 权限。

## 和微信试用用户的关系

微信试用用户不需要登录管理后台。Native WeChat/iLink 通道按 `wechat-native-<account>-<contact>` 生成独立会话和用户目录。管理后台账号只用于运营和配置，不等于微信聊天用户。
