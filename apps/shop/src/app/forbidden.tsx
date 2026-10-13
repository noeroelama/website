import { ErrorPage } from "@website/ui";

export default function Forbidden() {
  return <ErrorPage status={403} />;
}
