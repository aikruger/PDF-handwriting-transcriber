declare module 'pako' {
  export function inflate(data: Uint8Array, options?: { raw?: boolean }): Uint8Array;
  export function deflate(data: Uint8Array, options?: { raw?: boolean }): Uint8Array;
}
