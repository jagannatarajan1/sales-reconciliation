import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

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

export function generateJwtToken(user: JwtUser): string {
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
    },
    secret,
    {
      issuer,
      audience,
      expiresIn: `${expirationMinutes}m`,
    }
  );
}
