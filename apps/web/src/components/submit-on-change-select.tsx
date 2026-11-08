"use client";

import type { ReactNode } from "react";

/**
 * A combobox that submits its GET form as soon as an option is picked, so the list
 * updates without the Search button (user: "ketika combobox dipilih data langsung
 * muncul"). The search field still waits for the button; without JS the default
 * form submit remains available.
 */
export function SubmitOnChangeSelect({
  name,
  defaultValue,
  className,
  children,
}: {
  name: string;
  defaultValue?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className={className}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      {children}
    </select>
  );
}
