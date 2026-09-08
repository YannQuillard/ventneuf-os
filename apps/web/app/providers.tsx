"use client";

import { Theme } from "@astryxdesign/core/theme";
import { LayerProvider } from "@astryxdesign/core/Layer";
import { LinkProvider } from "@astryxdesign/core/Link";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import Link from "next/link";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <Theme theme={neutralTheme}>
      <LayerProvider toast={{ position: "bottomEnd", maxVisible: 4 }}>
        <LinkProvider component={Link}>{children}</LinkProvider>
      </LayerProvider>
    </Theme>
  );
}
