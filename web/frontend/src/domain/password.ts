export const minimumPasswordCharacters = 8;

export function passwordMeetsMinimumLength(password: string): boolean {
  return Array.from(password).length >= minimumPasswordCharacters;
}
