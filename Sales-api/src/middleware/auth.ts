import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

const jwtSecret = process.env.JWT_SECRET ?? "";

// Reads the Authorization header if present and attaches req.userId/req.userRole.
// Never rejects the request itself — each route decides whether that's enough,
// exactly like the old JwtAuthenticationMiddleware did.
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.split(" ")[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, jwtSecret) as jwt.JwtPayload;
      req.userId = parseInt(decoded.userId as string, 10);
      req.userRole = decoded.role as string;
    } catch {
      // Invalid token, user will not be attached
    }
  }

  next();
}
