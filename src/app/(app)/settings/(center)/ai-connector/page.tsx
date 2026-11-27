import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PageChrome } from "@/components/PageChrome";
import { getDb } from "@/db/client";
import { getCurrentMember } from "@/lib/current-member";
import { adminOverview, myConnector } from "@/lib/mcp/admin";
import { originFor } from "@/lib/mcp/core";
import { SettingsHead } from "../ui";
import { AiConnectorClient } from "./AiConnectorClient";

export const dynamic = "force-dynamic";

/**
 * Settings → AI Connector (owner 2026-11-25). Everyone sees their own status,
 * their connected apps and how to connect; the connector admin (Super Admin /
 * Owner) also approves people, sees every lookup, disconnects anyone and runs
 * the leak check. Personal page: no company-settings module needed.
 */
export default async function AiConnectorPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const db = getDb();
  const h = await headers();
  const host = h.get("host");
  const origin = originFor(host, `${h.get("x-forwarded-proto") ?? "https"}://${host ?? "localhost"}`);
  const mine = await myConnector(db, me);
  const overview = mine.isAdmin ? await adminOverview(db) : null;
  return (
    <PageChrome section="settings" crumbs={["AI Connector"]}>
      <div className="flex max-w-[1000px] flex-col gap-4 p-4 md:p-6">
        <SettingsHead
          title="AI Connector"
          sub="Ask Claude or ChatGPT about Houzs Connect with your own login. It sees only what you can see. Read-only unless the admin turns on AI actions, and then nothing is sent or changed until you say yes."
        />
        <AiConnectorClient connectorUrl={`${origin}/api/mcp`} me={{ name: me.name, email: me.email }} mine={mine} overview={overview} />
      </div>
    </PageChrome>
  );
}
