import { Request, Response } from "express";

// Canonical module keys. Keep this list in sync with the frontend permission
// checkboxes (Stage 2) — do not invent new keys without updating both.
export const PERMISSION_MODULES = [
  "sales",
  "suppliers",
  "scratchCards",
  "reports",
  "userManagement",
  "settings",
  "lottery",
  "paypoint",
  "commitHistory",
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

// Shared replacement for the old scattered `req.userRole !== "admin"` checks.
// Call it the same way the old local `requireAdmin(req, res)` helpers were
// called, at the top of each handler:
//
//   if (!requirePermission(req, res, "scratchCards")) return;
//
// Rules:
//   - Not authenticated              -> 401
//   - role === "admin"               -> passes only if moduleKey is in req.userPermissions
//   - role === "user" (or anything else) -> never passes
export function requirePermission(req: Request, res: Response, moduleKey: string): boolean {
  if (req.userId == null) {
    res.status(401).json({ message: "User not authenticated" });
    return false;
  }

  if (req.userRole === "admin" && (req.userPermissions ?? []).includes(moduleKey)) {
    return true;
  }

  res.status(403).json({ message: "You do not have permission to access this." });
  return false;
}

// Boolean-only check with no response side effects, for handlers that need
// an OR condition (e.g. "self OR has userManagement permission") rather than
// gating the entire handler on this permission alone.
export function hasPermission(req: Request, moduleKey: string): boolean {
  if (req.userId == null) return false;
  return req.userRole === "admin" && (req.userPermissions ?? []).includes(moduleKey);
}
