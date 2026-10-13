"use client";

import Link from "next/link";
import { signInWithEmail, signInWithPasskey } from "@/lib/auth-client";
import {
  Button,
  Field,
  formClass,
  formValues,
  GoogleButton,
  Message,
  useAuthAction,
} from "@/components/auth-form";

/** `next`: where to go after sign-in, already validated on the server (or null). */
export function LoginForm({ next }: { next: string | null }) {
  const email = useAuthAction(next);
  const passkey = useAuthAction(next);
  return (
    <div className={formClass}>
      <Button type="button" busy={passkey.busy} onClick={() => void passkey.run(signInWithPasskey)}>
        Sign in with a passkey
      </Button>
      <Message text={passkey.error} />
      <GoogleButton next={next} />
      <form
        className={formClass}
        onSubmit={(event) => {
          const v = formValues(event, "email", "password");
          void email.run(() => signInWithEmail(v["email"] ?? "", v["password"] ?? ""));
        }}
      >
        <Field label="Email" name="email" type="email" autoComplete="username webauthn" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
        <Message text={email.error} />
        <Button busy={email.busy}>Sign in</Button>
      </form>
      <p>
        <Link href="/forgot-password">Forgot password?</Link> ·{" "}
        <Link href="/signup">Create account</Link>
      </p>
    </div>
  );
}
