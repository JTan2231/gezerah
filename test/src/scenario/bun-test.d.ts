declare module "bun:test" {
  export function test(name: string, body: () => void | Promise<void>): void;
  export function describe(name: string, body: () => void): void;
}
