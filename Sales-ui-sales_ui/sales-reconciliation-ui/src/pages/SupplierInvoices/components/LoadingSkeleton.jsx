export function LoadingSkeleton({ variant = 'cards', count = 4 }) {
  if (variant === 'kpi') {
    return (
      <div className="sp-kpi-grid" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="sp-kpi-card sp-skeleton" />
        ))}
      </div>
    );
  }

  return (
    <div className="sp-card-list" aria-busy="true" aria-label="Loading report">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sp-card sp-skeleton sp-skeleton-card" />
      ))}
    </div>
  );
}
