import { redirect } from "next/navigation";
import { readSession } from "../lib/auth/session";
import { Workspace } from "./workspace";
import { WorkspaceHome } from "./workspace-home";

export default async function Home() {
  const session = await readSession();

  if (!session) redirect("/login");

  return (
    <Workspace email={session.email}>
      <WorkspaceHome />
    </Workspace>
  );
}
