export interface ThinkTagFilterState {
  insideThinkBlock: boolean;
  pendingText: string;
}

function findTrailingCaseInsensitivePrefixStart(text: string, token: string): number {
  const normalizedText = text.toLowerCase();
  const normalizedToken = token.toLowerCase();
  const maxPrefixLength = Math.min(normalizedText.length, normalizedToken.length - 1);

  for (let prefixLength = maxPrefixLength; prefixLength > 0; prefixLength -= 1) {
    if (normalizedText.endsWith(normalizedToken.slice(0, prefixLength))) {
      return normalizedText.length - prefixLength;
    }
  }

  return -1;
}

/**
 * Strip `<think>...</think>` blocks from streamed text.
 */
export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "");
}

export function filterThinkTagsFromChunk(text: string, state: ThinkTagFilterState): string {
  const openTag = "<think>";
  const closeTag = "</think>";
  let remaining = state.pendingText + text;
  let visibleText = "";

  state.pendingText = "";

  while (remaining.length > 0) {
    if (state.insideThinkBlock) {
      const closeIndex = remaining.toLowerCase().indexOf(closeTag);
      if (closeIndex === -1) {
        const partialCloseIndex = findTrailingCaseInsensitivePrefixStart(remaining, closeTag);
        state.pendingText = partialCloseIndex === -1 ? "" : remaining.slice(partialCloseIndex);
        return visibleText;
      }

      remaining = remaining.slice(closeIndex + closeTag.length);
      state.insideThinkBlock = false;
      continue;
    }

    const openIndex = remaining.toLowerCase().indexOf(openTag);
    if (openIndex === -1) {
      const partialOpenIndex = findTrailingCaseInsensitivePrefixStart(remaining, openTag);
      if (partialOpenIndex === -1) {
        visibleText += remaining;
      } else {
        visibleText += remaining.slice(0, partialOpenIndex);
        state.pendingText = remaining.slice(partialOpenIndex);
      }
      return visibleText;
    }

    visibleText += remaining.slice(0, openIndex);
    remaining = remaining.slice(openIndex + openTag.length);
    state.insideThinkBlock = true;
  }

  return visibleText;
}

export function flushThinkTagFilter(state: ThinkTagFilterState): string {
  const flushedText = state.insideThinkBlock ? "" : state.pendingText;
  state.pendingText = "";
  state.insideThinkBlock = false;
  return flushedText;
}
