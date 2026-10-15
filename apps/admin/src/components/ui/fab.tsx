import { Icon } from "./icon";

/** Floating "Add" button, bottom-right (Figma flowchart): opens the page's add form. */
export function Fab({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="admin-fab">
      <Icon name="plus" size={18} />
      {label}
    </a>
  );
}
