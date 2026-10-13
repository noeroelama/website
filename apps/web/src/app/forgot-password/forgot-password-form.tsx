"use client";

import Link from "next/link";
import { useState } from "react";
import { sendPasswordReset } from "@/lib/auth-client";
import {
  Button,
  Field,
  formClass,
  formValues,
  Message,
  useAuthAction,
} from "@/components/auth-form";

export function ForgotPasswordForm() {
  const { busy, error, run } = useAuthAction();
  const [sent, setSent] = useState(false);
  return (
    <form
      className={formClass}
      onSubmit={(event) => {
        const { email } = formValues(event, "email");
        void run(
          () => sendPasswordReset(email ?? ""),
          () => setSent(true),
        );
      }}
    >
      <p>Enter your email and we will send you a link to choose a new password.</p>
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Message text={error} />
      {/* Same message whether or not the email has an account. */}
      <Message
        tone="info"
        text={sent ? "If an account exists for that email, a reset link is on its way." : ""}
      />
      <Button busy={busy}>Send reset link</Button>
      <p>
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
