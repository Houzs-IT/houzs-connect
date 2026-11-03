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

## OCR 读款单的 API Key(Anthropic)— 轮换 + 移到公司账号

**背景**:读客户付款 slip 的功能(`src/lib/receipt-vision.ts`)靠一把 Anthropic 密钥 `ANTHROPIC_API_KEY`,存在**公司 Cloudflare 账号**的 Worker secret 上(Worker `houzs-connect`,account `hello@houzscentury.com`)。
当前这把 key 叫 `houzs-connect-receipts-final`,却建在 Anthropic 的 **"Nico's Individual Org"(个人组织)** 下,**2026-11-04 (UTC) 过期**。目标:换一把新的,并让它归在**公司 Anthropic 组织**下统一管计费。

> 要移的是 **Anthropic 那边的组织/计费**,不是 Cloudflare —— Cloudflare 早就是公司账号了(`wrangler.toml` 里 pin 了 account_id)。Anthropic 的 key **不能跨组织"搬"**,只能在目标组织里**新建一把**,再把旧的吊销。

> OCR 目前是**暂停**的:`wrangler.toml` 的 `[vars]` 里没有 `RECEIPT_AI=on`,所以线上没在调它,**这把 key 过期当下不影响任何在跑的东西**。真要开 OCR,除了换 key 还得加 `RECEIPT_AI=on`。

### 你要做的
1. **确认/建公司组织**:用 `hello@houzscentury.com` 登 https://console.anthropic.com
   - 已有公司组织(挂着公司付款方式)→ 右上角切到它。
   - 没有 → 新建一个组织、设好公司信用卡/发票(这步只有你能做,涉及付款)。
2. **在公司组织里建新 key**:**Settings → API keys → Create key**,起名如 `houzs-connect-receipts`,**复制**(只显示一次)。别贴进聊天。
3. **把新 key 装到 Worker**(这一行**你自己跑**,key 不经过 Claude):
   `npx wrangler secret put ANTHROPIC_API_KEY`
   提示 `Enter a secret value` 时粘贴新 key、回车即可(secret 立即生效,不必重新部署)。

### 验证 + 收尾
4. **验证**:打开 app **Settings → Integrations → Receipt AI 的 "Test connection"**,逐步探针会显示新 key 是否被接受(只花几个 token)。
5. **吊销旧 key**:确认新 key 能用后,回 Anthropic 的 **Nico's Individual Org** 把 `houzs-connect-receipts-final` **Revoke/Delete** —— 计费就彻底归到公司组织了。
6. (可选)**真正开启 OCR**:在 `wrangler.toml` 的 `[vars]` 加 `RECEIPT_AI = "on"` → `pnpm run deploy`(Claude 做)。不想现在开就先放着,换 key 不受影响。

---

## 一句话
先做 ① → ②,告诉 Claude;想上线再做 ③。所有 `pnpm`/`wrangler` 命令都是 Claude 跑,你不用碰终端(除了那句 `wrangler login`,或让 Claude 帮你跑你点 Allow)。
