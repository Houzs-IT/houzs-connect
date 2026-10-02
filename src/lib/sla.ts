/**
 * A reply is due within this many minutes of the customer's message. Drives the
 * SLA badge colour (amber → red), the "SLA overdue" tab, and the first-reply
 * "on time / late" mark. Lives outside the client components so server code can
 * read the number too.
 */
export const SLA_MINUTES = 30;
