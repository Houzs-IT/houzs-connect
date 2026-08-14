import type { Metadata } from "next";

// Public, unauthenticated page. Meta requires a reachable privacy policy URL
// before an app can be published, and the WhatsApp Business Platform requires
// one for the business behind a registered number. It lives outside the (app)
// route group on purpose — that layout redirects anonymous visitors to /login,
// which would make this URL unreachable to Meta's reviewer.

export const metadata: Metadata = {
  title: "Privacy Policy — Houzs Century",
  description:
    "How Houzs Century Sdn. Bhd. handles personal data in its WhatsApp customer messaging.",
};

const UPDATED = "14 August 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-[15px] font-semibold text-[var(--color-ink)]">{title}</h2>
      <div className="space-y-3 text-[14px] leading-relaxed text-[var(--color-muted)]">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <h1 className="text-[26px] font-semibold text-[var(--color-ink)]">Privacy Policy</h1>
      <p className="mt-2 text-[13px] text-[var(--color-faint)]">Last updated: {UPDATED}</p>

      <Section title="Who we are">
        <p>
          This policy covers personal data handled by <strong>HOUZS CENTURY SDN. BHD.</strong>{" "}
          (Company No. 202201031135), a company incorporated in Malaysia, through Houzs Connect —
          the internal platform we use to message customers on WhatsApp about their orders.
        </p>
        <p>
          Questions or requests about your data:{" "}
          <a className="text-[var(--color-accent)] underline" href="mailto:hello@houzscentury.com">
            hello@houzscentury.com
          </a>
          .
        </p>
      </Section>

      <Section title="What we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>Your WhatsApp phone number and profile name.</li>
          <li>The messages you exchange with us on WhatsApp, including images you send us.</li>
          <li>
            Order details we already hold from your purchase — reference number, delivery date,
            address area, amount outstanding, and the sales person handling your order.
          </li>
          <li>
            Payment receipts you choose to send us, and the amount and reference number read from
            them.
          </li>
        </ul>
      </Section>

      <Section title="Why we use it">
        <p>
          Only to serve your order: arranging and confirming your delivery date, reminding you of an
          upcoming delivery, telling you when the driver is on the way, answering your questions,
          and recording payment you have made. We also send occasional service updates about
          products you bought.
        </p>
        <p>
          We do not sell your data, and we do not share it with anyone for their own marketing.
        </p>
      </Section>

      <Section title="Marketing messages and opting out">
        <p>
          Promotional messages are separate from delivery messages. You can stop them at any time by
          replying <strong>STOP</strong> to any of our WhatsApp messages, or by telling any of our
          staff. We will keep sending messages that are strictly about an order you have placed
          until that order is complete.
        </p>
      </Section>

      <Section title="Who else sees it">
        <ul className="list-disc space-y-1 pl-5">
          <li>Our own staff — sales, customer service, logistics and delivery drivers.</li>
          <li>
            Meta Platforms, which operates WhatsApp and therefore carries every message between us.
          </li>
          <li>
            Our cloud hosting and database providers, which store the data on our behalf under
            contract.
          </li>
        </ul>
      </Section>

      <Section title="How long we keep it">
        <p>
          Conversations and order records are kept while your order is active and afterwards for as
          long as we need them for warranty, service history and accounting — normally seven years,
          which is the retention period Malaysian tax law expects of us. Payment receipt images are
          kept with the payment record they belong to.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You can ask us what we hold about you, ask us to correct it, or ask us to delete anything
          we are not legally required to keep. Write to{" "}
          <a className="text-[var(--color-accent)] underline" href="mailto:hello@houzscentury.com">
            hello@houzscentury.com
          </a>{" "}
          and we will respond within 21 days.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If we change how we handle your data we will update this page and change the date at the
          top.
        </p>
      </Section>
    </main>
  );
}
