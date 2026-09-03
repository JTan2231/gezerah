import { homeURL, type Navigate } from "../worldRoutes";
import { NotFoundView } from "./NotFoundView";

export function NotFoundPage({ navigate }: { navigate: Navigate }) {
  return <NotFoundView onReturnHome={() => navigate(homeURL())} />;
}
