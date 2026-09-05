import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PrototypeProvider } from "./_components/prototype-provider";
import { PrototypeShell } from "./_components/prototype-shell";

export const metadata: Metadata = {
  title: "Mission workspace prototype · ventneuf.os",
  description: "Frontend-only prototype of the ventneuf.os mission workspace with fixture data.",
};

export default function PrototypeLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <PrototypeProvider>
      <PrototypeShell>{children}</PrototypeShell>
    </PrototypeProvider>
  );
}
