import { Injectable } from '@angular/core';

/**
 * CryptoService
 *
 * All encryption here uses the browser's native Web Crypto API (SubtleCrypto).
 * Nothing is sent over the network - every operation happens locally on the device.
 *
 * How the vault key system works:
 * 1. A single random 256-bit "vault key" is generated once, when the vault is first set up.
 *    This is the key that actually encrypts/decrypts every photo.
 * 2. The vault key is never stored directly. Instead it is "wrapped" (encrypted) twice:
 *      - once with a key derived from the user's password (PBKDF2)
 *      - once with a key derived from a randomly generated recovery code
 *    Both wrapped copies are stored. Either the password OR the recovery code can
 *    unwrap the vault key and unlock the vault - so losing the password does not
 *    mean losing the data, as long as the recovery code was saved.
 * 3. Each photo is encrypted individually with AES-256-GCM using the vault key and
 *    a fresh random IV (never reused).
 */

export interface WrappedKeyData {
  salt: string; // base64
  iv: string; // base64
  wrappedKey: string; // base64 ciphertext of the vault key
}

export interface VaultSetupResult {
  passwordWrap: WrappedKeyData;
  recoveryWrap: WrappedKeyData;
  recoveryCode: string; // shown to user ONCE, never stored in plain form
}

const PBKDF2_ITERATIONS = 250_000;

@Injectable({ providedIn: 'root' })
export class CryptoService {
  private vaultKey: CryptoKey | null = null;

  get isUnlocked(): boolean {
    return this.vaultKey !== null;
  }

  lock(): void {
    this.vaultKey = null;
  }

  /** Generates a human-friendly random recovery code, e.g. "XQ7K-9FPL-2RTD-WZ4M" */
  generateRecoveryCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
    const groups: string[] = [];
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (let g = 0; g < 4; g++) {
      let group = '';
      for (let i = 0; i < 4; i++) {
        group += chars[bytes[g * 4 + i] % chars.length];
      }
      groups.push(group);
    }
    return groups.join('-');
  }

  /** First-time setup: creates a new vault key and wraps it with both the password and a fresh recovery code. */
  async setupVault(password: string): Promise<VaultSetupResult> {
    const vaultKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const rawVaultKey = await crypto.subtle.exportKey('raw', vaultKey);

    const recoveryCode = this.generateRecoveryCode();

    const passwordWrap = await this.wrapRawKey(rawVaultKey, password);
    const recoveryWrap = await this.wrapRawKey(rawVaultKey, recoveryCode.replace(/-/g, ''));

    this.vaultKey = vaultKey;

    return { passwordWrap, recoveryWrap, recoveryCode };
  }

  /** Unlock using the password. Returns true on success. */
  async unlockWithPassword(password: string, passwordWrap: WrappedKeyData): Promise<boolean> {
    return this.unlockWith(password, passwordWrap);
  }

  /** Unlock using the recovery code (format XXXX-XXXX-XXXX-XXXX, dashes optional). */
  async unlockWithRecoveryCode(code: string, recoveryWrap: WrappedKeyData): Promise<boolean> {
    return this.unlockWith(code.replace(/-/g, '').toUpperCase(), recoveryWrap);
  }

  /** Change the password: re-wraps the already-unlocked vault key under a new password. */
  async rewrapWithNewPassword(newPassword: string): Promise<WrappedKeyData> {
    if (!this.vaultKey) throw new Error('Vault is locked');
    const raw = await crypto.subtle.exportKey('raw', this.vaultKey);
    return this.wrapRawKey(raw, newPassword);
  }

  private async unlockWith(secret: string, wrap: WrappedKeyData): Promise<boolean> {
    try {
      const salt = this.b64ToBytes(wrap.salt);
      const iv = this.b64ToBytes(wrap.iv);
      const wrappedKey = this.b64ToBytes(wrap.wrappedKey);

      const derivedKey = await this.deriveKeyFromSecret(secret, salt);
      const rawVaultKey = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        derivedKey,
        wrappedKey,
      );

      this.vaultKey = await crypto.subtle.importKey('raw', rawVaultKey, { name: 'AES-GCM' }, true, [
        'encrypt',
        'decrypt',
      ]);
      return true;
    } catch {
      // Wrong password/recovery code - AES-GCM auth tag fails to verify
      return false;
    }
  }

  private async wrapRawKey(rawKey: ArrayBuffer, secret: string): Promise<WrappedKeyData> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const derivedKey = await this.deriveKeyFromSecret(secret, salt);
    const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, derivedKey, rawKey);
    return {
      salt: this.bytesToB64(salt),
      iv: this.bytesToB64(iv),
      wrappedKey: this.bytesToB64(new Uint8Array(wrapped)),
    };
  }

  private async deriveKeyFromSecret(secret: string, salt: Uint8Array): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  /** Encrypts a photo (as ArrayBuffer) with the unlocked vault key. Returns ciphertext + IV, both needed to decrypt. */
  async encryptPhoto(data: ArrayBuffer): Promise<{ iv: string; ciphertext: ArrayBuffer }> {
    if (!this.vaultKey) throw new Error('Vault is locked');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, this.vaultKey, data);
    return { iv: this.bytesToB64(iv), ciphertext };
  }

  async decryptPhoto(ciphertext: ArrayBuffer, iv: string): Promise<ArrayBuffer> {
    if (!this.vaultKey) throw new Error('Vault is locked');
    const ivBytes = this.b64ToBytes(iv);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes as BufferSource }, this.vaultKey, ciphertext);
  }

  private bytesToB64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  private b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(b64);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
}
