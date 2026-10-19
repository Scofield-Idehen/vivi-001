import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Secret custom fields (lock codes, key-safe codes, Wi-Fi passwords) are sealed here, in the API,
 * before they go to the database: AES-256-GCM with a key derived from FIELD_SECRET_KEY. Postgres,
 * its logs, backups and the audit log only ever hold the sealed bytes.
 *
 * Layout: 12-byte nonce, 16-byte tag, then the ciphertext.
 */
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(secret, 'utf8').digest();
  }

  seal(plain: string): Buffer {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), body]);
  }

  /** Returns null for bytes sealed with another key or damaged in storage, rather than throwing. */
  open(sealed: Buffer): string | null {
    if (sealed.length < NONCE_BYTES + TAG_BYTES) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, sealed.subarray(0, NONCE_BYTES));
      decipher.setAuthTag(sealed.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
      return Buffer.concat([
        decipher.update(sealed.subarray(NONCE_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }
}
