import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

export const prototypeTheme = defineTheme({
  name: "ventneuf-prototype",
  extends: neutralTheme,
  radius: { base: 4, multiplier: 0.5 },
});
