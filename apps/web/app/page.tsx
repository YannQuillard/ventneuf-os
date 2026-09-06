import { redirect } from "next/navigation";
import { readSession } from "../lib/auth/session";
import { HermesConversation } from "./conversation";
import { Workspace } from "./workspace";

export default async function Home() {
  const session = await readSession();

  if (!session) redirect("/login");

  return (
    <Workspace email={session.email}>
      <HermesConversation />
    </Workspace>
  );
}
