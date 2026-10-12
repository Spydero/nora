import { z } from 'zod';

const tenantSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{2,63}$/, 'Enter a valid organisation code');

const email = z.email('Enter a valid email address').trim().toLowerCase().max(254);

export const loginSchema = z.object({
  tenantSlug,
  email,
  password: z.string().min(1, 'Enter your password').max(128),
});

export const registerSchema = z.object({
  tenantSlug,
  email,
  displayName: z.string().trim().min(1, 'Enter your name').max(120),
  password: z
    .string()
    .min(12, 'Use at least 12 characters')
    .max(128, 'Use 128 characters or fewer'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
