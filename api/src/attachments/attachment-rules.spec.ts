import { hasImageSignature } from './attachment-rules.js';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const text = new TextEncoder().encode('<html>hi');

describe('hasImageSignature', () => {
  it('accepts real PNG and JPEG headers', () => {
    expect(hasImageSignature(png, 'image/png')).toBe(true);
    expect(hasImageSignature(jpeg, 'image/jpeg')).toBe(true);
  });

  it('rejects a file whose bytes do not match the declared type', () => {
    expect(hasImageSignature(text, 'image/png')).toBe(false);
    expect(hasImageSignature(png, 'image/jpeg')).toBe(false);
    expect(hasImageSignature(new Uint8Array(), 'image/png')).toBe(false);
  });
});
