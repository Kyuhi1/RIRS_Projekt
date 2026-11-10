import { jwtVerify, SignJWT } from 'jose';

// JWT v httpOnly piškotku (ADR 0006). Kratka veljavnost; blokiranje preverimo ob vsakem zahtevku.
export const COOKIE_NAME = 'token';
const TTL_SECONDS = 60 * 60;

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signToken(secret: string, userId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key(secret));
}

// Vrne id uporabnika ali null, če je žeton neveljaven ali potekel.
export async function verifyToken(secret: string, token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'] });
    const id = Number(payload.sub);
    return Number.isSafeInteger(id) ? id : null;
  } catch {
    return null;
  }
}

const ATTRIBUTES = 'Path=/; HttpOnly; SameSite=Lax';

export const sessionCookie = (token: string) => `${COOKIE_NAME}=${token}; ${ATTRIBUTES}; Max-Age=${TTL_SECONDS}`;
export const clearedCookie = () => `${COOKIE_NAME}=; ${ATTRIBUTES}; Max-Age=0`;

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}
