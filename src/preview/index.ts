import type { Extension } from "@codemirror/state";
import { ImageCache, type ImageIO } from "./image-loader";
import { imageExtensions } from "./images";
import { livePreviewPlugin } from "./plugin";

export { markdownSupport } from "./markdown";
export type { ImageIO } from "./image-loader";

export function livePreview(
  opts: { openUrl?: (url: string) => void; docPath?: string | null; imageIO?: ImageIO } = {},
): Extension {
  const images = opts.imageIO ? new ImageCache(opts.imageIO) : null;
  return [livePreviewPlugin(opts), imageExtensions({ docPath: opts.docPath ?? null, images })];
}
