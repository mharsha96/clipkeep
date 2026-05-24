const bareDomainPattern =
  /^(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#][^\s]*)?$/iu;

function safeHttpUrl(text) {
  const trimmed = text.trim();
  const candidate = /^https?:\/\//iu.test(trimmed)
    ? trimmed
    : bareDomainPattern.test(trimmed)
      ? `https://${trimmed}`
      : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function looksLikeSnippet(text) {
  if (!text.includes("\n")) return false;
  return (
    /(?:^|\n)\s*(?:const|let|var|function|class|import|export|def|func|struct|SELECT|INSERT|UPDATE|CREATE|#include)\b/imu.test(
      text
    ) ||
    /(?:=>|<\/?[a-z][^>]*>|[{}]\s*;?\s*(?:\n|$)|;\s*(?:\n|$))/iu.test(text)
  );
}

export function createClipPayload(text, source) {
  const trimmed = text.trim();
  const openUrl = safeHttpUrl(text);
  if (openUrl) return { text, source, kind: "link", openUrl };
  if (/^\d{4,8}$/u.test(trimmed)) return { text, source, kind: "code" };
  if (looksLikeSnippet(trimmed)) return { text, source, kind: "snippet" };
  return { text, source, kind: "text" };
}

export function displayText(clip) {
  if (clip.kind !== "link") return clip.text;
  try {
    return new URL(clip.openUrl || safeHttpUrl(clip.text)).hostname.replace(/^www\./iu, "");
  } catch {
    return clip.text;
  }
}

export function openableUrl(clip) {
  return clip.kind === "link" ? clip.openUrl || safeHttpUrl(clip.text) : null;
}
