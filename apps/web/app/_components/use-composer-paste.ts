"use client";

import type { ChatComposerInputHandle, UseChatPasteAsTokenReturn } from "@astryxdesign/core/Chat";
import { useRef, type KeyboardEvent, type RefObject } from "react";

const PASTE_TOKEN_THRESHOLD = 200;
const REPEAT_PASTE_WINDOW_MS = 1_500;

interface CollapsedPaste {
  id: string;
  text: string;
  value: string;
  at: number;
  caret: Range;
}

export function useComposerPaste(inputRef: RefObject<ChatComposerInputHandle | null>) {
  const previous = useRef<CollapsedPaste | null>(null);
  const keyboardPaste = useRef(false);

  const reset = () => {
    previous.current = null;
    keyboardPaste.current = false;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "v") {
      keyboardPaste.current = true;
    } else if (event.key !== "Meta" && event.key !== "Control") {
      reset();
    }
  };

  const pasteAsToken: UseChatPasteAsTokenReturn = {
    onPaste: (_event, text) => {
      const input = inputRef.current;
      const fromKeyboard = keyboardPaste.current;
      keyboardPaste.current = false;
      const last = previous.current;
      previous.current = null;
      if (!input || text.length <= PASTE_TOKEN_THRESHOLD) return false;

      const selection = window.getSelection();
      const caret = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (fromKeyboard && last && text === last.text && Date.now() - last.at <= REPEAT_PASTE_WINDOW_MS
        && input.getValue() === last.value && caret?.collapsed
        && caret.startContainer === last.caret.startContainer && caret.startOffset === last.caret.startOffset) {
        input.expandToken(last.id);
        input.focus();
        return true;
      }

      const lines = text.split("\n").length;
      const id = input.insertToken({
        value: text,
        label: lines > 1 ? `${lines} lines, ${text.length} chars` : `${text.length} chars`,
        variant: "neutral",
      });
      if (fromKeyboard && id && selection?.rangeCount) {
        previous.current = {
          id, text, value: input.getValue(), at: Date.now(), caret: selection.getRangeAt(0).cloneRange(),
        };
      }
      return true;
    },
  };

  return { pasteAsToken, onKeyDown, onInputCapture: reset, onPointerDownCapture: reset, onBlurCapture: reset };
}
