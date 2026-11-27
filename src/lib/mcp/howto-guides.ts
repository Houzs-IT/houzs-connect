// Round 5: every how-to guide, in one list (agents, supervisors, admins, flows).
import type { HowtoGuide } from "./howto-types";
import { AGENT_GUIDES } from "./howto-guides-agent";
import { LEAD_GUIDES } from "./howto-guides-lead";
import { ADMIN_GUIDES } from "./howto-guides-admin";
import { FLOWS } from "./howto-flows";

export const HOWTO_GUIDES: HowtoGuide[] = [...AGENT_GUIDES, ...LEAD_GUIDES, ...ADMIN_GUIDES, ...FLOWS];
