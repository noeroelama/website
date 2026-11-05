import { AccessMessage } from "@/components/access-message";
import { Card, CardBody } from "@/components/ui/card";
import { requireAdminViewer } from "@/server/context";
import { search } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Global search (G4): the side panel's search box (shortcut "/") submits here. */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/search");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const asked = (await searchParams)["q"];
  const q = (typeof asked === "string" ? asked : "").slice(0, 100);
  const results = await search()(viewer.principal, q);
  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Search</h1>
          <p className="admin-page-header__desc">
            Pages, letters (number or subject), programmes, meetings and people you may see.
          </p>
        </div>
      </div>
      <Card>
        <CardBody>
          <form action="/search" role="search">
            <input
              className="admin-input"
              type="search"
              name="q"
              defaultValue={q}
              aria-label="Search"
              minLength={2}
              maxLength={100}
            />
          </form>
          {q.trim().length < 2 ? (
            <p>Type at least 2 characters.</p>
          ) : results.length === 0 ? (
            <p>Nothing found.</p>
          ) : (
            <ul>
              {results.map((r, i) => (
                <li key={`${r.group}-${i}`}>
                  <span className="admin-table__sub">{r.group}</span> —{" "}
                  <a href={r.href}>{r.label}</a>
                  {r.sub ? <span className="admin-table__sub"> {r.sub}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
