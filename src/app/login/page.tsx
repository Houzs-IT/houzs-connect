import { ShellProvider } from "@/components/shell/ShellProvider";
import { getLang } from "@/lib/i18n/server";
import { LoginView } from "./LoginView";

/** Sign-in: the language comes from the same cookie as the rest of the app. */
export default async function LoginPage() {
  return (
    <ShellProvider lang={await getLang()} menuCollapsed={false}>
      <LoginView />
    </ShellProvider>
  );
}
