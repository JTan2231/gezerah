import { Brand, EmptyState } from "../components/StudioUI";

export function NotFoundView({ onReturnHome }: { onReturnHome: () => void }) {
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
            onClick={onReturnHome}
          >
            Return home
          </button>
        }
      />
    </main>
  );
}
