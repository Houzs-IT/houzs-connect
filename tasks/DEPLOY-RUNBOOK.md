# Houzs Connect — 上线直达 runbook

目标:把 Connect 跑起来看皮肤 → 部署到 **chat.houzscentury.com**。
你只有 3 件事(下面 ①②③),其余全是 Claude 自动做。

---

## 你要做的(就 3 件)

### ① 拿 Supabase 连接串
- 打开 https://supabase.com/dashboard/projects → 选**公司项目**
- 左下 **Project Settings → Database → Connection string → Session pooler (端口 5432)** → 复制
- 忘了数据库密码就在同页 **Reset database password** 重设

### ② 填进 `.dev.vars`(改一行,存盘)
- 文件:`Houzs-Connect/houzs-connect/.dev.vars`
- 把 `DATABASE_URL="..."` 换成刚复制的串(`<项目ref>`、`<你的数据库密码>` 换成真的)
- 存盘 → 跟 Claude 说一声
- ⚠️ 别贴进聊天,直接存文件

> ①② 做完,Claude 就能**本地跑起来 + 截图新皮肤**给你。以下 ③ 是正式上线才需要。

### ③ 部署授权(两小步,只在正式部署时做一次)
- **授权 Cloudflare**:项目文件夹里跑 `npx wrangler login` → 浏览器点 **Allow**(或叫 Claude 帮你跑,你只点 Allow)
- **开 Windows 开发者模式**:设置 → 隐私和安全性 → 开发者选项 → 打开"开发人员模式"
  （不想开就告诉 Claude,改走 GitHub Actions 云端部署）

---

## Claude 自动做的(你做完对应步骤就触发)

**做完 ①② →**
1. `pnpm db:migrate` — 在 `connect` schema 建 23 张表
2. `pnpm db:seed` — 灌 demo 数据
3. 本地 `next dev` 跑起来 → 截图 + 给你本地预览链接 → 对着真实渲染精修细节

**做完 ③ →**
4. `wrangler hyperdrive create houzs-connect-pg` → 把 id 填进 `wrangler.toml`
5. `pnpm run deploy` → OpenNext 打包 + 部署 Worker `houzs-connect`
6. 绑自定义域 **chat.houzscentury.com**
7. 抓 https://chat.houzscentury.com 实测(能开/能读库/能发消息)→ 截图确认

---

## 现在就能看的(不用等)
- 设计全界面 mockup:`Houzs-Connect/houzs-design-reference/claudedesign-output/HOUZS CONNECT.dc.html`
- 组件/配色系统页:`Houzs-Connect/houzs-design-reference/claudedesign-output/Ink and Petrol - Design System.dc.html`

---

## 一句话
先做 ① → ②,告诉 Claude;想上线再做 ③。所有 `pnpm`/`wrangler` 命令都是 Claude 跑,你不用碰终端(除了那句 `wrangler login`,或让 Claude 帮你跑你点 Allow)。
