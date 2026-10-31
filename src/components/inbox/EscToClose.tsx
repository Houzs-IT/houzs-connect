"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Esc closes the open conversation — the keyboard twin of the thread header's
 * back arrow (which only shows on a phone). Mounted on the conversation page, so
 * it is listening exactly while a thread is open; navigating to /inbox unmounts
 * it and drops the listener.
 *
 * On a desktop /inbox keeps the rail and shows the "select a conversation" empty
 * state where the thread was; on a phone it returns to the rail. Same route the
 * back arrow uses, so the two agree.
 *
 * Esc is a busy key in this screen — it already closes the Assign and overflow
 * menus, the searchable selects, the composer's panels, and the modals — so this
 * handler steps aside whenever one of those owns the press, and only then exits:
 *   • defaultPrevented — a select or the composer already handled it;
 *   • an open modal ([role="dialog"]) or menu/select ([aria-expanded="true"]);
 *   • focus sitting in a text field — don't yank an operator out mid-draft.
 */
export function EscToClose() {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A modal or an open menu/select owns Escape: let it close itself first.
      if (document.querySelector('[role="dialog"], [aria-expanded="true"]')) return;
      // Typing somewhere (the composer, a search box): Escape is not "leave".
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return;
      }
      router.push("/inbox");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return null;
}
