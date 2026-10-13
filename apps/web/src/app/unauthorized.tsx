import { ErrorPage } from "@website/ui";

export default function Unauthorized() {
  return <ErrorPage status={401} />;
}
