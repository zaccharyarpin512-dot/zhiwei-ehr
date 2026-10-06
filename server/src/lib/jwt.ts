// JWT 签发与校验（FR-M11-001：access 7 天 + refresh 30 天）
import * as jwt from 'jsonwebtoken';
const SECRET = process.env.JWT_SECRET || 'zw-dev-secret-change-me';
export interface TokenPayload { uid: number; tid: number; roles: string[]; empId?: number; }
export function signAccess(p: TokenPayload): string {
  return jwt.sign(p, SECRET, { expiresIn: '7d' });
}
export function signRefresh(p: TokenPayload): string {
  return jwt.sign({ ...p, typ: 'refresh' }, SECRET, { expiresIn: '30d' });
}
export function verify(token: string): TokenPayload {
  return jwt.verify(token, SECRET) as TokenPayload;
}
