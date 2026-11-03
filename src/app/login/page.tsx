import { headers } from "next/headers";
import { ShellProvider } from "@/components/shell/ShellProvider";
import { brandForHost } from "@/lib/company-brand";
import { getLang } from "@/lib/i18n/server";
import { LoginView } from "./LoginView";

/** Sign-in: the language comes from the same cookie as the rest of the app. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  // /login?request=1 is the link handed out by Settings → Team → Invite person.
  const { request } = await searchParams;
  return (
    <ShellProvider lang={await getLang()} menuCollapsed={false}>
      <LoginView openRequest={request === "1"} brand={brandForHost((await headers()).get("host"))} />
    </ShellProvider>
  );
}
