/**
 * Connect's two languages. English is the default; Chinese is a per-person
 * choice stored in the `hc_lang` cookie so the server renders the right one on
 * the first paint (no English flash before a client effect swaps it).
 *
 * Shared by server and client code — nothing here may import `next/headers`.
 */
export type Lang = "en" | "zh";

export const LANG_COOKIE = "hc_lang";
/** Secondary-menu collapse, remembered per browser the same way. */
export const MENU_COOKIE = "hc_menu";

export function parseLang(v: string | undefined | null): Lang {
  return v === "zh" ? "zh" : "en";
}

const en = {
  nav: {
    dashboard: "Dashboard",
    inbox: "Service",
    internal: "Internal",
    contacts: "Contacts",
    automations: "Automations",
    campaigns: "Campaigns",
    templates: "Templates & Forms",
    payments: "Payments",
    logs: "System Logs",
    settings: "Settings",
  },
  tab: {
    inbox: "Service",
    internal: "Internal",
    home: "Home",
    flows: "Flows",
    more: "More",
  },
  shell: {
    collapse: "Collapse menu",
    expand: "Show menu",
    live: "LIVE · sending via WhatsApp",
    demo: "DEMO MODE · WhatsApp stubbed",
    company: "Company",
    current: "current",
    signOut: "Sign out",
    language: "Language",
    close: "Close",
    account: "Account",
  },
  role: {
    OWNER: "Owner",
    ADMIN: "Admin",
    MANAGER: "Manager",
    AGENT: "Agent",
    SALES: "Sales",
    DRIVER: "Driver",
    VIEWER: "Viewer",
  } as Record<string, string>,
  page: {
    allConversations: "All conversations",
    overview: "Overview",
    allContacts: "All contacts",
    allFlows: "All flows",
    allCampaigns: "All campaigns",
    templates: "Message templates",
    forms: "WhatsApp forms",
    receipts: "Receipts",
    messages: "Message history",
    webhooks: "Webhook deliveries",
    general: "General",
    team: "Team & access",
    channels: "Channels",
    autoReplies: "Auto replies",
    comingSoon: "Coming soon",
  },
  menu: {
    views: "Views",
    content: "Content",
    business: "Business",
    more: "More",
  },
  internal: {
    phase: "Coming soon",
    p1: "Department channels and direct messages between staff",
    p2: "Share a customer conversation card that opens straight in Service",
    p3: "Threads, @mentions, and system actions posted alongside replies",
  },
};

export type Dict = typeof en;

const zh: Dict = {
  nav: {
    dashboard: "仪表盘",
    inbox: "客户服务",
    internal: "内部沟通",
    contacts: "联系人",
    automations: "自动化",
    campaigns: "群发",
    templates: "模板与表单",
    payments: "付款",
    logs: "系统日志",
    settings: "设置",
  },
  tab: {
    inbox: "客户服务",
    internal: "内部沟通",
    home: "首页",
    flows: "流程",
    more: "更多",
  },
  shell: {
    collapse: "收起菜单",
    expand: "展开菜单",
    live: "已上线 · 通过 WhatsApp 发送",
    demo: "演示模式 · 未真实发送",
    company: "公司",
    current: "当前",
    signOut: "退出登录",
    language: "语言",
    close: "关闭",
    account: "账号",
  },
  role: {
    OWNER: "所有者",
    ADMIN: "管理员",
    MANAGER: "主管",
    AGENT: "客服",
    SALES: "销售",
    DRIVER: "司机",
    VIEWER: "只读",
  },
  page: {
    allConversations: "全部会话",
    overview: "概览",
    allContacts: "全部联系人",
    allFlows: "全部流程",
    allCampaigns: "全部群发",
    templates: "消息模板",
    forms: "WhatsApp 表单",
    receipts: "收据",
    messages: "消息记录",
    webhooks: "Webhook 记录",
    general: "常规",
    team: "团队与权限",
    channels: "渠道",
    autoReplies: "自动回复",
    comingSoon: "即将上线",
  },
  menu: {
    views: "视图",
    content: "内容",
    business: "业务设置",
    more: "更多",
  },
  internal: {
    phase: "即将上线",
    p1: "部门频道和同事之间的私聊",
    p2: "在消息里贴客户会话卡片，点击直接打开客户服务",
    p3: "讨论串、@同事，回复里可附系统动作记录",
  },
};

export const DICTS: Record<Lang, Dict> = { en, zh };
