/**
 * Soft/progressive phone-number mask for the ticket contact-phone field -
 * live-formats a standard 10-digit US number into "(XXX) XXX-XXXX" as the
 * user types, but never truncates or rejects anything. That matters here
 * specifically: the backend (see main.py's contact-phone endpoint)
 * deliberately does NOT enforce a strict US-only pattern, since real values
 * include extensions ("662-555-1234 x205") and non-US/front-desk formats.
 * A hard input mask that only ever accepts "(XXX) XXX-XXXX" would silently
 * fight that decision. So:
 *
 * - The first letter in the input (typically "x" for an extension) marks
 *   where formatting stops - everything from that point on is left
 *   completely untouched, appended after the formatted head.
 * - If more than 10 digits show up before any letter, this isn't a
 *   standard US number (an international number, a leading country code,
 *   etc.) - formatting is abandoned entirely and the raw input passes
 *   through unchanged rather than mangling something valid.
 */
export function formatPhoneInput(raw: string): string {
  const letterIdx = raw.search(/[a-zA-Z]/);
  const head = letterIdx === -1 ? raw : raw.slice(0, letterIdx);
  const tail = letterIdx === -1 ? "" : raw.slice(letterIdx);

  const digits = head.replace(/\D/g, "");
  if (digits.length === 0) return raw;
  if (digits.length > 10) return raw;

  let formattedHead: string;
  if (digits.length > 6) {
    formattedHead = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  } else if (digits.length > 3) {
    formattedHead = `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  } else {
    formattedHead = `(${digits}`;
  }

  // The space before an extension (e.g. the one in "1234 x205") lived in
  // `head` and got stripped along with the other formatting punctuation
  // when digits were extracted - restore a single space so the tail
  // doesn't end up jammed straight onto the closing digit ("1234x205").
  const separator = tail && !/^\s/.test(tail) ? " " : "";
  return formattedHead + separator + tail;
}
