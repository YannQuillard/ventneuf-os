import { redirect } from "next/navigation";
import { conversationHref } from "../../lib/prototype/navigation";

export default function PrototypeIndex() {
  redirect(conversationHref("hermes"));
}
