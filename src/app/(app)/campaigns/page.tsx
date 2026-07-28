import { Placeholder } from "@/components/Placeholder";

export default function CampaignsPage() {
  return (
    <Placeholder
      title="Campaigns"
      subtitle="One-off broadcast blasts"
      phase="Phase 3"
      points={[
        "6-step wizard: name → sender → audience → template → test send → review",
        "Audience targeting by tag, filter or CSV import",
        "Approved WhatsApp template + variable mapping",
        "Optional approval gate before send, delivery analytics",
      ]}
    />
  );
}
