import { customAlphabet } from "nanoid";

/** Join codes: short, typable, no ambiguous characters (0/O, 1/I/L). */
export const generateJoinCode = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 5);

/** Long secrets (admin tokens, participant tokens). */
export const generateToken = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  32,
);
