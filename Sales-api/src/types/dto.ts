export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  role?: string;
  permissions?: string[];
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface UserDto {
  userId: number;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  createdAt: Date;
  isActive: boolean;
}

export interface AuthResponse {
  token: string;
  user: UserDto;
}

// Returned by POST /auth/login for an admin account instead of AuthResponse
// — no token is issued until the OTP is verified.
export interface OtpChallengeResponse {
  otpRequired: true;
  otpSessionId: string;
  maskedEmail: string;
  expiresInSeconds: number;
}

export interface CreateOrderRequest {
  orderNumber: string;
  orderDate: string;
  totalAmount: number;
  status?: string;
}

export interface UpdateOrderRequest {
  orderNumber?: string;
  orderDate?: string;
  totalAmount?: number;
  status?: string;
}

export interface OrderDto {
  orderId: number;
  userId: number;
  orderNumber: string;
  orderDate: Date;
  totalAmount: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedResponse<T> {
  items: T[];
  totalCount: number;
  pageNumber: number;
  pageSize: number;
}

export interface GmailStatusDto {
  isConnected: boolean;
  emailAddress?: string | null;
  connectedAt?: Date | null;
}

export interface ZReportEmailDto {
  date: Date;
  body: string;
}

export interface ZReportResponse {
  isCommitted: boolean;
  message?: string | null;
  targetDate: Date;
  email?: ZReportEmailDto | null;
}

export interface TodaySummaryResponse {
  isCommitted: boolean;
  message?: string | null;
}
