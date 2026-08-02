export function humanize(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function formatRelativeDate(raw?: string): string {
  if (raw === undefined) return "Not played yet";
  const date = new Date(raw);
  const elapsed = Date.now() - date.getTime();
  const future = elapsed < 0;
  const minutes = future
    ? Math.ceil(Math.abs(elapsed) / 60_000)
    : Math.floor(Math.abs(elapsed) / 60_000);
  if (minutes < 1) return "Just now";

  let value: string;
  if (minutes < 60) value = `${minutes}m`;
  else {
    const hours = Math.floor(minutes / 60);
    if (hours < 24) value = `${hours}h`;
    else {
      const days = Math.floor(hours / 24);
      if (days >= 7)
        return new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
        }).format(date);
      value = `${days}d`;
    }
  }
  return future ? `in ${value}` : `${value} ago`;
}
