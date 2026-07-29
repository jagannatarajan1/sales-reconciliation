import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "./auth.service.js";
import { LoginRequest, PaginatedResponse, RegisterRequest, UserDto } from "../types/dto.js";
import { User } from "@prisma/client";

function mapToUserDto(user: User): UserDto {
  return {
    userId: user.userId,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: user.permissions ?? [],
    createdAt: user.createdAt,
    isActive: user.isActive,
  };
}

// NOTE: this is only reachable via POST /api/auth/register, which now requires
// an authenticated caller holding the "userManagement" permission (see
// auth.routes.ts / lib/permissions.ts). There is no public self-service
// registration path anymore — role/permissions here are set by a trusted admin,
// not by an anonymous caller.
export async function register(request: RegisterRequest): Promise<UserDto | null> {
  const existingUser = await prisma.user.findUnique({ where: { email: request.email } });
  if (existingUser) return null;

  const user = await prisma.user.create({
    data: {
      email: request.email,
      passwordHash: await hashPassword(request.password),
      name: request.name,
      role: request.role ?? "user",
      permissions: request.permissions ?? [],
      isActive: true,
    },
  });

  return mapToUserDto(user);
}

export async function login(
  request: LoginRequest
): Promise<{ user: UserDto | null; error: string | null }> {
  const user = await prisma.user.findFirst({ where: { email: request.email, isActive: true } });

  if (!user) return { user: null, error: "Invalid email or password" };

  const passwordMatches = await verifyPassword(request.password, user.passwordHash);
  if (!passwordMatches) return { user: null, error: "Invalid email or password" };

  return { user: mapToUserDto(user), error: null };
}

export async function getUserById(userId: number): Promise<UserDto | null> {
  const user = await prisma.user.findFirst({ where: { userId, isActive: true } });
  return user ? mapToUserDto(user) : null;
}

export async function getCurrentUser(userId: number): Promise<UserDto | null> {
  const user = await prisma.user.findUnique({ where: { userId } });
  return user ? mapToUserDto(user) : null;
}

export async function getAllUsers(
  pageNumber = 1,
  pageSize = 10
): Promise<PaginatedResponse<UserDto>> {
  const where = { isActive: true };
  const totalCount = await prisma.user.count({ where });
  const users = await prisma.user.findMany({
    where,
    skip: (pageNumber - 1) * pageSize,
    take: pageSize,
  });

  return {
    items: users.map(mapToUserDto),
    totalCount,
    pageNumber,
    pageSize,
  };
}
