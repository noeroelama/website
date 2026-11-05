import "server-only";

/**
 * Optional free-text campus matcher (X4): Gemini picks which of the approved names the typed
 * campus means, ONLY after the deterministic search found nothing. Answers an index or null.
 */
export function geminiCampusMatcher(apiKey: string, fetchImpl: typeof fetch) {
  return async (typed: string, names: readonly string[]): Promise<number | null> => {
    const prompt =
      "Which numbered university does the user mean? Answer with the number only, or 0 when " +
      `none fits.\nUser typed: ${JSON.stringify(typed.slice(0, 200))}\n` +
      names
        .slice(0, 300)
        .map((n, i) => `${i + 1}. ${n}`)
        .join("\n");
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    if (!response.ok) throw new Error(`gemini_${response.status}`);
    const body = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const n = Number(/\d+/.exec(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "")?.[0] ?? 0);
    return n >= 1 && n <= Math.min(names.length, 300) ? n - 1 : null;
  };
}
