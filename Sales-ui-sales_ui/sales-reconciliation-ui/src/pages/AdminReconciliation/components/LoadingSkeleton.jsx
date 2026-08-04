export function LoadingSkeleton({ variant = 'rows', count = 8 }) {
  if (variant === 'kpi') {
    return (
      <div className="rc-kpi-grid" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rc-kpi-card rc-skeleton" />
        ))}
      </div>
    );
  }

  return (
    <div className="rc-skeleton-rows" aria-busy="true" aria-label="Loading reconciliation records">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rc-skeleton-row rc-skeleton" />
      ))}
    </div>
  );
}
