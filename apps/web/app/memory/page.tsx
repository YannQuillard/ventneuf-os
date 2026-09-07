import { redirect } from "next/navigation";
import { readSession } from "../../lib/auth/session";
import { Workspace } from "../workspace";
import { MemoryScreen } from "./screen";

export default async function MemoryPage() {
  const session = await readSession();
  if (!session) redirect("/login");
  return <Workspace email={session.email}><MemoryScreen /></Workspace>;
}
