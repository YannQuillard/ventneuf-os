import { redirect } from "next/navigation";
import { readSession } from "../../../lib/auth/session";
import { ProjectScreen } from "../../project-screen";
import { Workspace } from "../../workspace";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await readSession();
  if (!session) redirect("/login");
  const { projectId } = await params;
  return <Workspace email={session.email}><ProjectScreen projectId={projectId} /></Workspace>;
}
