import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

export const workspaceTheme = defineTheme({
  name: "ventneuf-workspace",
  extends: neutralTheme,
  radius: { base: 4, multiplier: 0.5 },
});
