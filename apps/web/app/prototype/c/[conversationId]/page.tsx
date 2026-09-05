import { notFound } from "next/navigation";
import { Suspense } from "react";
import { prototypeData } from "../../../../lib/prototype/fixtures";
import { ConversationScreen } from "../../_components/conversation-screen";

export const dynamicParams = false;

export function generateStaticParams() {
  return prototypeData.conversations.map((conversation) => ({ conversationId: conversation.id }));
}

export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  if (!prototypeData.conversations.some((conversation) => conversation.id === conversationId)) notFound();

  return (
    <Suspense fallback={null}>
      <ConversationScreen conversationId={conversationId} />
    </Suspense>
  );
}
