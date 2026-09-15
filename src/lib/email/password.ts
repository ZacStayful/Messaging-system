import { randomInt } from "node:crypto";

// No 0/O, 1/l/I: customers read this out of an email.
const LETTERS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
const DIGITS = "23456789";

/** Readable 14-character password in three groups, e.g. "Kq7t-Mwx9-Pz4r", always with digits. */
export function generatePassword(): string {
  const group = () => {
    const chars = [
      LETTERS[randomInt(LETTERS.length)],
      LETTERS[randomInt(LETTERS.length)],
      DIGITS[randomInt(DIGITS.length)],
      LETTERS[randomInt(LETTERS.length)],
    ];
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
  };
  return `${group()}-${group()}-${group()}`;
}
