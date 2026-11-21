import { markdownLanguage } from "@codemirror/lang-markdown";
import { LanguageSupport } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

// markdown() would pull in lang-html, css and javascript (and autoCloseTags).
export function markdownSupport(): Extension {
  return new LanguageSupport(markdownLanguage);
}
