import { redirect } from "next/navigation";
import { readSession } from "../../../lib/auth/session";
import { WorkspaceConversationScreen } from "../../conversation-screen";
import { Workspace } from "../../workspace";

export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const session = await readSession();
  if (!session) redirect("/login");
  const { conversationId } = await params;
  return <Workspace email={session.email}><WorkspaceConversationScreen conversationId={conversationId} /></Workspace>;
}
