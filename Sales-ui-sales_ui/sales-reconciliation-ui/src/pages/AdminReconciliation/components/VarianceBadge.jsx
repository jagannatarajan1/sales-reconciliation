import { fmtGBP, varianceBucket } from '../utils';

// Green = £0.00, Amber = within tolerance, Red = exceeds tolerance.
export function VarianceBadge({ variance }) {
  const bucket = varianceBucket(variance);
  return <span className={`rc-variance rc-variance--${bucket}`}>{fmtGBP(variance)}</span>;
}
