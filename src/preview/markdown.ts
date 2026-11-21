import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";

export function markdownSupport(): Extension {
  return markdown({ base: markdownLanguage, addKeymap: false });
}
