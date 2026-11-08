/** Bearer-style secrets: 256 bits from the platform CSPRNG (Web Crypto), base64url. */
const base64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

export const randomToken = (prefix: string): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return prefix + base64url(bytes);
};
