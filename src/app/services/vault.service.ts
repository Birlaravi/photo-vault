import { Injectable, signal } from '@angular/core';
import { CryptoService, WrappedKeyData } from './crypto.service';
import { StorageService, PhotoListItem } from './storage.service';

export type VaultState = 'loading' | 'needs-setup' | 'locked' | 'unlocked';

const THUMB_MAX_DIM = 320;

@Injectable({ providedIn: 'root' })
export class VaultService {
  readonly state = signal<VaultState>('loading');
  readonly photos = signal<PhotoListItem[]>([]);
  readonly errorMessage = signal<string>('');

  private passwordWrap: WrappedKeyData | null = null;
  private recoveryWrap: WrappedKeyData | null = null;

  constructor(
    private crypto: CryptoService,
    private storage: StorageService,
  ) {
    this.init();
  }

  private async init() {
    const meta = await this.storage.getVaultMeta();
    if (!meta) {
      this.state.set('needs-setup');
      return;
    }
    this.passwordWrap = meta.passwordWrap;
    this.recoveryWrap = meta.recoveryWrap;
    this.state.set('locked');
  }

  /** Returns the recovery code to show the user once. They must save it themselves - it is never stored in plain text. */
  async setup(password: string): Promise<string> {
    const result = await this.crypto.setupVault(password);
    this.passwordWrap = result.passwordWrap;
    this.recoveryWrap = result.recoveryWrap;
    await this.storage.saveVaultMeta({
      id: 'vault',
      passwordWrap: result.passwordWrap,
      recoveryWrap: result.recoveryWrap,
      createdAt: Date.now(),
    });
    this.state.set('unlocked');
    await this.refreshPhotoList();
    return result.recoveryCode;
  }

  async unlockWithPassword(password: string): Promise<boolean> {
    if (!this.passwordWrap) return false;
    const ok = await this.crypto.unlockWithPassword(password, this.passwordWrap);
    if (ok) {
      this.state.set('unlocked');
      await this.refreshPhotoList();
    }
    return ok;
  }

  async unlockWithRecoveryCode(code: string): Promise<boolean> {
    if (!this.recoveryWrap) return false;
    const ok = await this.crypto.unlockWithRecoveryCode(code, this.recoveryWrap);
    if (ok) {
      this.state.set('unlocked');
      await this.refreshPhotoList();
    }
    return ok;
  }

  /** Sets a new password after unlocking via recovery code. Keeps the same recovery code valid. */
  async resetPasswordAfterRecoveryUnlock(newPassword: string): Promise<void> {
    if (!this.crypto.isUnlocked) throw new Error('Vault must be unlocked first');
    const newWrap = await this.crypto.rewrapWithNewPassword(newPassword);
    this.passwordWrap = newWrap;
    await this.storage.saveVaultMeta({
      id: 'vault',
      passwordWrap: newWrap,
      recoveryWrap: this.recoveryWrap!,
      createdAt: Date.now(),
    });
  }

  lock(): void {
    this.crypto.lock();
    this.state.set('locked');
    this.photos.set([]);
  }

  async refreshPhotoList(): Promise<void> {
    this.photos.set(await this.storage.listPhotos());
  }

  async importFile(file: File): Promise<void> {
    const buffer = await file.arrayBuffer();
    const { iv, ciphertext } = await this.crypto.encryptPhoto(buffer);

    const thumbBlob = await this.makeThumbnail(file);
    const thumbBuffer = await thumbBlob.arrayBuffer();
    const thumbEnc = await this.crypto.encryptPhoto(thumbBuffer);

    const id = crypto.randomUUID();
    await this.storage.addPhoto({
      id,
      iv,
      mimeType: file.type || 'image/jpeg',
      fileName: file.name,
      addedAt: Date.now(),
      ciphertext,
      thumbCiphertext: thumbEnc.ciphertext,
      thumbIv: thumbEnc.iv,
    });
    await this.refreshPhotoList();
  }

  private makeThumbnail(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > height) {
          if (width > THUMB_MAX_DIM) {
            height = Math.round((height * THUMB_MAX_DIM) / width);
            width = THUMB_MAX_DIM;
          }
        } else {
          if (height > THUMB_MAX_DIM) {
            width = Math.round((width * THUMB_MAX_DIM) / height);
            height = THUMB_MAX_DIM;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('thumb failed'))), 'image/jpeg', 0.8);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not load image'));
      };
      img.src = url;
    });
  }

  async getDecryptedUrl(id: string, thumb = false): Promise<string> {
    const record = await this.storage.getPhoto(id);
    if (!record) throw new Error('Photo not found');
    const ciphertext = thumb ? record.thumbCiphertext : record.ciphertext;
    const iv = thumb ? record.thumbIv : record.iv;
    const plain = await this.crypto.decryptPhoto(ciphertext, iv);
    const blob = new Blob([plain], { type: thumb ? 'image/jpeg' : record.mimeType });
    return URL.createObjectURL(blob);
  }

  async deletePhoto(id: string): Promise<void> {
    await this.storage.deletePhoto(id);
    await this.refreshPhotoList();
  }

  async exportPhoto(id: string): Promise<{ blob: Blob; fileName: string }> {
    const record = await this.storage.getPhoto(id);
    if (!record) throw new Error('Photo not found');
    const plain = await this.crypto.decryptPhoto(record.ciphertext, record.iv);
    return { blob: new Blob([plain], { type: record.mimeType }), fileName: record.fileName };
  }
}
