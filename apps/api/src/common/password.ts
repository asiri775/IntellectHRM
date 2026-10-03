import * as argon2 from 'argon2';
import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters')
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/[0-9]/, 'Must contain a number');

export async function hashPassword(plain: string) {
  return argon2.hash(plain, { type: argon2.argon2id });
}
