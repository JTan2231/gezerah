import { Brand, EmptyState } from "../components/StudioUI";
import type { Navigate } from "../worldRoutes";

export function NotFoundPage({ navigate }: { navigate: Navigate }) {
  return (
    <main className="not-found-page">
      <Brand />
      <EmptyState
        title="Page not found"
        description="Return home to choose Play or Build."
        action={
          <button
            className="button button-ink"
            type="button"
            onClick={() => navigate("/")}
          >
            Return home
          </button>
        }
      />
    </main>
  );
}
