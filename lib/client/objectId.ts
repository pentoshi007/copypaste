let counter = Math.floor(Math.random() * 0xffffff);

function hex(value: number, length: number): string {
  return value.toString(16).padStart(length, "0").slice(-length);
}

export function generateObjectId(): string {
  const seconds = Math.floor(Date.now() / 1000);
  const random = new Uint8Array(5);
  crypto.getRandomValues(random);
  counter = (counter + 1) % 0xffffff;
  return hex(seconds, 8) + Array.from(random, (byte) => hex(byte, 2)).join("") + hex(counter, 6);
}
