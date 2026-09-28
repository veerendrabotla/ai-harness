import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200)
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a digit");

export const signupRequestSchema = z.object({
  email: z.string().email().max(320),
  password: passwordSchema,
  displayName: z.string().min(1).max(100),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(10).optional(), // also accepted via httpOnly cookie
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: z.string().email().max(320),
});

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(10).max(200),
  newPassword: passwordSchema,
});

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  platformRole?: "USER" | "PLATFORM_ADMIN";
  createdAt: string;
}

export interface AuthSuccessPayload {
  user: UserDto;
  accessToken: string;
  refreshToken?: string;
}

export interface RefreshSuccessPayload {
  accessToken: string;
  refreshToken?: string;
}
