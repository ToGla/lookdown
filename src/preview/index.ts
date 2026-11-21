import type { Extension } from "@codemirror/state";
import { livePreviewPlugin } from "./plugin";

export { markdownSupport } from "./markdown";

export function livePreview(opts: { openUrl?: (url: string) => void } = {}): Extension {
  return livePreviewPlugin(opts);
}
