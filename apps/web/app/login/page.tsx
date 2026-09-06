import { redirect } from "next/navigation";
import { readSession } from "../../lib/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await readSession()) redirect("/");
  return <LoginForm />;
}
