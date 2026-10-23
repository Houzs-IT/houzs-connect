// Pure types shared by the Drip builder (client) and its actions (server).

export type DripUnit = "minutes" | "hours" | "days";

/** One step as the builder edits it and the action stores it. */
export interface DripStepInput {
  /** Wait before this step, measured from the previous step. */
  afterUnit: DripUnit;
  afterAmount: number;
  /** An approved template (campaigns' contract); body/lang resolved from it. */
  templateName: string;
  templateLang: string;
  templateBody: string;
  removeAfterReplied: boolean;
}

/** An approved template the builder offers per step (from listSendableTemplates). */
export interface DripTemplate {
  name: string;
  language: string;
  body: string;
  placeholders: number;
}
