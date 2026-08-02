import { Brand, EmptyState } from "../components/StudioUI";
import type { Navigate } from "../worldRoutes";

export function NotFoundPage({ navigate }: { navigate: Navigate }) {
  return (
    <main className="not-found-page">
      <Brand />
      <EmptyState
        symbol="?"
        title="That page is not in this world"
        description="Choose whether you want to return to Play or Build."
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
