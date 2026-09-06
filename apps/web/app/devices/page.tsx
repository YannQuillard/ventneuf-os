import { redirect } from "next/navigation";
import { readSession } from "../../lib/auth/session";
import { Workspace } from "../workspace";
import { DevicesScreen } from "./screen";

export default async function DevicesPage() {
  const session = await readSession();
  if (!session) redirect("/login");
  return <Workspace email={session.email}><DevicesScreen /></Workspace>;
}
