"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useToastMessage(autoHideMs = 2600) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const show = useCallback(
    (text: string) => {
      setMessage(text);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMessage(null), autoHideMs);
    },
    [autoHideMs],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return { message, show };
}

export function ToastBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="admin-toast" role="status">
      {message}
    </div>
  );
}
