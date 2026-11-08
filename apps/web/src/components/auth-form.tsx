"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { continueWithGoogle } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

export const formClass = "ui-form";

export function Field(props: {
  label: string;
  name: string;
  type: "email" | "password";
  autoComplete: string;
}) {
  return (
    <label className="ui-field">
      {props.label}
      <input
        className="ui-input"
        name={props.name}
        type={props.type}
        autoComplete={props.autoComplete}
        required
      />
    </label>
  );
}

export function Message(props: { text: string; tone?: "error" | "info" }) {
  if (!props.text) return null;
  return (
    <p
      role={props.tone === "info" ? "status" : "alert"}
      className="ui-message"
      data-tone={props.tone ?? "error"}
    >
      {props.text}
    </p>
  );
}

export function Button(props: {
  children: ReactNode;
  busy: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <button
      type={props.type ?? "submit"}
      disabled={props.busy}
      onClick={props.onClick}
      className="ui-button"
    >
      {props.children}
    </button>
  );
}

type Navigate = (path: string) => void;

export function useAuthAction(next: string | null = null) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go: Navigate = (path) => {
    if (!path.startsWith("/")) {
      window.location.assign(path);
      return;
    }
    router.push(path);
    router.refresh();
  };
  async function run(
    action: () => Promise<void>,
    onSuccess: (go: Navigate) => void = () => go(next ?? "/account"),
  ) {
    setBusy(true);
    setError("");
    try {
      await action();
      onSuccess(go);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function GoogleButton(props: { next?: string | null }) {
  const { busy, error, run } = useAuthAction(props.next ?? null);
  return (
    <>
      <Button type="button" busy={busy} onClick={() => void run(continueWithGoogle)}>
        Continue with Google
      </Button>
      <Message text={error} />
    </>
  );
}

export function formValues(
  event: FormEvent<HTMLFormElement>,
  ...names: string[]
): Record<string, string> {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  return Object.fromEntries(
    names.map((name) => {
      const value = data.get(name);
      return [name, typeof value === "string" ? value : ""];
    }),
  );
}
