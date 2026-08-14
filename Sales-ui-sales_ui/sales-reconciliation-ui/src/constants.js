// Frontend mirror of Sales-api/src/lib/variance.ts. Keep both in sync — this
// tolerance used to be a bare `5` copy-pasted into four separate files
// (two backend, two frontend); this is the frontend half of consolidating
// it to one place per side.
export const VARIANCE_TOLERANCE = 5;

export const isWithinTolerance = (difference) => Math.abs(difference) <= VARIANCE_TOLERANCE;
