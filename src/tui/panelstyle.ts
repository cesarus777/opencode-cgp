import { RGBA, TextAttributes } from "@opentui/core";

// The terminal owns these slots. No application palette or background fills.
export const panelColors = {
  text: RGBA.defaultForeground(),
  accent: RGBA.fromIndex(6),
  success: RGBA.fromIndex(2),
  warning: RGBA.fromIndex(3),
  danger: RGBA.fromIndex(1),
};
export const panelAttributes = TextAttributes;
