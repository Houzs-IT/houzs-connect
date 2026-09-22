"use client";

import { useEffect } from "react";
import { markConversationRead } from "@/app/(app)/inbox/actions";

/**
 * Renders nothing; clears the conversation's unread badge once it is opened.
 * A server component cannot mutate during render, so opening a thread marks it
 * read from here. Keyed on the id so switching threads re-fires; the action is a
 * no-op when there is nothing to clear.
 */
export function MarkRead({ conversationId }: { conversationId: string }) {
  useEffect(() => {
    void markConversationRead(conversationId);
  }, [conversationId]);
  return null;
}
