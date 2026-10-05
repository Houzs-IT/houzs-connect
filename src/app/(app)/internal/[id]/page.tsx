import { ChannelView } from "../ChannelView";

export const dynamic = "force-dynamic";

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; info?: string }>;
}) {
  const { id } = await params;
  const { t, info } = await searchParams;
  return <ChannelView channelId={id} threadId={t ?? null} info={info === "1"} />;
}
