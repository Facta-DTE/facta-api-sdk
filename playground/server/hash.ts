export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Idempotency keys are `<visitorTag>.<uuid>`: a session can only be used by the visitor it was made for. */
export async function visitorTag(email: string): Promise<string> {
  return (await sha256Hex(email.toLowerCase())).slice(0, 16);
}
