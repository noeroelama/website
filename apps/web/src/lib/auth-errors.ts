import { z } from "zod";

const MESSAGES = new Map<string, string>(
  Object.entries({
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/user-not-found": "Email or password is incorrect.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/invalid-email": "Email or password is incorrect.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes or reset your password.",
    "auth/email-already-in-use":
      "Could not create the account. If you already have one, sign in or reset your password.",
    "auth/weak-password": "Use a password with at least 8 characters.",
    "auth/network-request-failed": "Check your internet connection and try again.",
    "auth/popup-blocked": "Allow pop-ups for this site to continue with Google.",
    "auth/popup-closed-by-user": "",
    "auth/cancelled-popup-request": "",
    NotAllowedError: "",
    "passkey/failed": "Passkey sign-in didn't work. Try again or use another sign-in method.",
    "passkey/reauthenticate": "For your security, sign in again before adding a passkey.",
  }),
);

export function authErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { code, name } = error as { code?: unknown; name?: unknown };
    for (const key of [code, name]) {
      const message = typeof key === "string" ? MESSAGES.get(key) : undefined;
      if (message !== undefined) return message;
    }
  }
  return "Something went wrong. Please try again.";
}

export const signUpSchema = z
  .object({
    email: z.email("Enter a valid email address."),
    password: z.string().min(8, "Use a password with at least 8 characters.").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match.",
  });
