import { notFound, redirect } from "next/navigation";
import { readSession } from "../../../lib/auth/session";
import { findFixtureConversation } from "../../../lib/fixtures";
import { FixtureConversationView } from "../../fixture-conversation";
import { Workspace } from "../../workspace";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await readSession();

  if (!session) {
    redirect("/");
  }

  const { id } = await params;
  const conversation = findFixtureConversation(id);

  if (!conversation) {
    notFound();
  }

  return (
    <Workspace email={session.email} activeConversationId={conversation.id}>
      <FixtureConversationView conversation={conversation} />
    </Workspace>
  );
}
