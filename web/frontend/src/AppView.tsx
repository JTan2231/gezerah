import {
  Brand,
  ErrorMessage,
  LoadingState,
  type ErrorNotice,
} from "./components/StudioUI";

export function AppLoadingView() {
  return (
    <main className="app-boot">
      <Brand />
      <LoadingState label="Opening your account" />
    </main>
  );
}

export function AppFailureView({
  error,
  onRetry,
}: {
  error: ErrorNotice;
  onRetry: () => void;
}) {
  return (
    <main className="app-boot">
      <Brand />
      <ErrorMessage error={error} onRetry={onRetry} />
    </main>
  );
}
