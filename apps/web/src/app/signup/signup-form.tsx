"use client";

import Link from "next/link";
import { useState } from "react";
import { signUpWithEmail } from "@/lib/auth-client";
import { signUpSchema } from "@/lib/auth-errors";
import {
  Button,
  Field,
  formClass,
  formValues,
  GoogleButton,
  Message,
  useAuthAction,
} from "@/components/auth-form";

export function SignUpForm() {
  const { busy, error, run } = useAuthAction();
  const [invalid, setInvalid] = useState("");
  return (
    <div className={formClass}>
      <GoogleButton />
      <form
        className={formClass}
        onSubmit={(event) => {
          const parsed = signUpSchema.safeParse(formValues(event, "email", "password", "confirm"));
          setInvalid(parsed.success ? "" : (parsed.error.issues[0]?.message ?? ""));
          if (parsed.success)
            void run(() => signUpWithEmail(parsed.data.email, parsed.data.password));
        }}
      >
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password (at least 8 characters)"
          name="password"
          type="password"
          autoComplete="new-password"
        />
        <Field
          label="Confirm password"
          name="confirm"
          type="password"
          autoComplete="new-password"
        />
        <Message text={invalid || error} />
        <Button busy={busy}>Create account</Button>
      </form>
      <p>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </div>
  );
}
