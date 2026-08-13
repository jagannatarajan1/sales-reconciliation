import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "crypto";

const SALT_ROUNDS = 10;

export interface JwtUser {
  userId: number;
  email: string;
  role: string;
  name: string;
  permissions: string[];
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// otpVerified is only meaningful for role "admin" — a user-role token always
// carries it as true since nothing ever gates on it for that role, but the
// claim exists on every token so its absence can never be mistaken for "not
// yet verified" on an old token vs. "verification not required" on a user one.
export function generateJwtToken(user: JwtUser, otpVerified = true): string {
  const secret = process.env.JWT_SECRET ?? "";
  const issuer = process.env.JWT_ISSUER ?? "";
  const audience = process.env.JWT_AUDIENCE ?? "";
  const expirationMinutes = parseInt(process.env.JWT_EXPIRATION_MINUTES ?? "1440", 10);

  return jwt.sign(
    {
      userId: user.userId.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
      permissions: user.permissions ?? [],
      otpVerified,
    },
    secret,
    {
      issuer,
      audience,
      expiresIn: `${expirationMinutes}m`,
    }
  );
}

// ── Admin login OTP ─────────────────────────────────────────────────────
// 6-digit numeric code, generated with Node's CSPRNG (crypto.randomInt),
// never logged or stored raw — only its SHA-256 hash is persisted, and only
// that hash is ever compared against.
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// Constant-time comparison so response timing can't leak how many hex
// characters of the hash matched.
export function otpHashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function generateOtpSessionToken(): string {
  return randomUUID();
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(local.length - visible.length, 3))}@${domain}`;
}
