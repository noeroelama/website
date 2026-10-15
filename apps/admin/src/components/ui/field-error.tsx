/** Message under a form field; pair it with `aria-invalid` on the input (red border). */
export function FieldError({ id, message }: { id: string; message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="admin-field__error">
      {message}
    </p>
  );
}
