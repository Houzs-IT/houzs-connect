import { TemplatesFormsMenu } from "@/components/shell/menus/ModuleMenus";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TemplatesFormsMenu />
      {children}
    </>
  );
}
