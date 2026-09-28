import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@ai-harness/shared";

export interface AccessTokenClaims {
  sub: string;
  email: string;
  sid: string | null;
}

const AUDIENCE = "ai-harness-api";

function secret(): Uint8Array {
  return new TextEncoder().encode(getEnv().JWT_ACCESS_SECRET);
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  const env = getEnv();
  return new SignJWT({ email: claims.email, sid: claims.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer(env.JWT_ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const env = getEnv();
  const { payload } = await jwtVerify(token, secret(), {
    issuer: env.JWT_ISSUER,
    audience: AUDIENCE,
  });
  if (!payload.sub) throw new Error("Token missing subject");
  return {
    sub: payload.sub,
    email: String(payload["email"] ?? ""),
    sid: (payload["sid"] as string | null) ?? null,
  };
}

export const REFRESH_COOKIE = "ah_rt";
