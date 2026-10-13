"use client";

import { useState } from "react";
import { addPasskey, signOut } from "@/lib/auth-client";
import { Button, formClass, Message, useAuthAction } from "@/components/auth-form";

export function AccountActions() {
  const passkey = useAuthAction();
  const [added, setAdded] = useState(false);
  const signOutAction = useAuthAction();
  return (
    <div className={formClass}>
      <Button
        type="button"
        busy={passkey.busy}
        onClick={() => void passkey.run(addPasskey, () => setAdded(true))}
      >
        Add a passkey
      </Button>
      <Message text={passkey.error} />
      <Message
        tone="info"
        text={added ? "Passkey added. Next time, sign in with it — no password needed." : ""}
      />
      <Button
        type="button"
        busy={signOutAction.busy}
        onClick={() => void signOutAction.run(signOut, (go) => go("/login"))}
      >
        Sign out
      </Button>
    </div>
  );
}
