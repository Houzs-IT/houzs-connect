// Starting drafts for a company that has never saved its auto replies.
//
// Drafts, not decisions: both replies start switched OFF, and the wording and
// hours are the owner's to confirm before anything is sent to a customer.
// English first, Chinese second, because that is how both companies' customers
// write in.

import type { AutoReplySettings, WeekHours } from "./decide";

export const DEFAULT_HOURS: WeekHours = {
  mon: { open: "09:00", close: "18:00" },
  tue: { open: "09:00", close: "18:00" },
  wed: { open: "09:00", close: "18:00" },
  thu: { open: "09:00", close: "18:00" },
  fri: { open: "09:00", close: "18:00" },
  sat: { open: "09:00", close: "13:00" },
  sun: null,
};

export function defaultAutoReplies(companyName: string): AutoReplySettings {
  return {
    welcomeEnabled: false,
    welcomeText:
      `Hi, thank you for contacting ${companyName}! Our team has received your message and will reply shortly.\n\n` +
      `您好，感谢您联系 ${companyName}！我们已收到您的信息，团队会尽快回复您。`,
    welcomeAfterHours: 24,
    awayEnabled: false,
    awayText:
      `Hi, thank you for your message! ${companyName} is closed right now. Our office hours are Monday to Friday 9am to 6pm and Saturday 9am to 1pm. We will reply as soon as we are back.\n\n` +
      `您好，感谢您的信息！${companyName} 目前不在办公时间（星期一至五早上9点至傍晚6点，星期六早上9点至下午1点）。我们上班后会尽快回复您。`,
    hours: DEFAULT_HOURS,
    timezone: "Asia/Kuala_Lumpur",
    awayRepeatHours: 12,
  };
}

/** WhatsApp's limit for one text message body. */
export const MAX_REPLY_CHARS = 4096;
