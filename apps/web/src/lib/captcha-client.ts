type Grecaptcha = {
  ready(callback: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
};

/** Loads reCAPTCHA v3 once and returns a token for `action` ("" when no site key is set). */
export async function captchaToken(action: string): Promise<string> {
  const siteKey = process.env["NEXT_PUBLIC_RECAPTCHA_SITE_KEY"];
  if (!siteKey) return "";
  const w = window as Window & { grecaptcha?: Grecaptcha };
  if (!w.grecaptcha) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("captcha_load_failed"));
      document.head.append(script);
    });
  }
  const grecaptcha = w.grecaptcha as Grecaptcha;
  await new Promise<void>((resolve) => grecaptcha.ready(resolve));
  return grecaptcha.execute(siteKey, { action });
}
