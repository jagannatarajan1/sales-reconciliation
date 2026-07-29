declare namespace Express {
  export interface Request {
    userId?: number;
    userRole?: string;
    userName?: string;
    userPermissions?: string[];
  }
}
