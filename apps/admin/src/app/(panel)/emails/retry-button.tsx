"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionError } from "@/components/action-error";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { label, MESSAGE_STATUS_LABELS } from "@/labels";
import { retryMessageAction } from "./actions";

export function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await retryMessageAction({ id });
            if (!result.ok) return setNote(actionMessage(result));
            setNote(label(MESSAGE_STATUS_LABELS, result.data.status));
            router.refresh();
          })
        }
      >
        Retry
      </Button>
      <ActionError text={note} />
    </>
  );
}
