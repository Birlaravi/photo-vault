import { Component, ElementRef, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VaultService } from './services/vault.service';
import { PhotoListItem } from './services/storage.service';

type Screen = 'loading' | 'setup' | 'setup-recovery-shown' | 'lock' | 'recovery-entry' | 'recovery-reset' | 'gallery';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  screen = signal<Screen>('loading');

  // setup form
  setupPassword = '';
  setupPasswordConfirm = '';
  setupError = '';
  recoveryCode = '';
  recoveryCodeSaved = false;

  // lock form
  lockPassword = '';
  lockError = '';
  unlocking = false;

  // recovery flow
  recoveryInput = '';
  recoveryError = '';
  newPasswordAfterRecovery = '';
  newPasswordAfterRecoveryConfirm = '';

  // gallery
  thumbUrls = new Map<string, string>();
  viewerPhotoId: string | null = null;
  viewerUrl: string | null = null;
  importing = false;
  importError = '';

  constructor(public vault: VaultService) {
    this.pollState();
  }

  private pollState() {
    // react to vault state signal
    const check = () => {
      const s = this.vault.state();
      if (s === 'loading') this.screen.set('loading');
      else if (s === 'needs-setup' && this.screen() === 'loading') this.screen.set('setup');
      else if (s === 'locked' && (this.screen() === 'loading' || this.screen() === 'gallery')) this.screen.set('lock');
      else if (s === 'unlocked' && this.screen() !== 'setup-recovery-shown') {
        this.screen.set('gallery');
        this.loadThumbnails();
      }
      requestAnimationFrame(check);
    };
    check();
  }

  // ---------- Setup ----------
  async submitSetup() {
    this.setupError = '';
    if (this.setupPassword.length < 6) {
      this.setupError = 'Password must be at least 6 characters.';
      return;
    }
    if (this.setupPassword !== this.setupPasswordConfirm) {
      this.setupError = 'Passwords do not match.';
      return;
    }
    this.recoveryCode = await this.vault.setup(this.setupPassword);
    this.setupPassword = '';
    this.setupPasswordConfirm = '';
    this.screen.set('setup-recovery-shown');
  }

  confirmRecoverySaved() {
    this.recoveryCodeSaved = false;
    this.recoveryCode = '';
    this.screen.set('gallery');
    this.loadThumbnails();
  }

  // ---------- Lock screen ----------
  async submitUnlock() {
    this.lockError = '';
    this.unlocking = true;
    try {
      const ok = await this.vault.unlockWithPassword(this.lockPassword);
      if (!ok) {
        this.lockError = 'Incorrect password.';
      }
      this.lockPassword = '';
    } finally {
      this.unlocking = false;
    }
  }

  goToRecovery() {
    this.lockError = '';
    this.recoveryInput = '';
    this.recoveryError = '';
    this.screen.set('recovery-entry');
  }

  cancelRecovery() {
    this.screen.set('lock');
  }

  async submitRecoveryCode() {
    this.recoveryError = '';
    const ok = await this.vault.unlockWithRecoveryCode(this.recoveryInput);
    if (!ok) {
      this.recoveryError = 'That recovery code is not valid.';
      return;
    }
    this.screen.set('recovery-reset');
  }

  async submitNewPasswordAfterRecovery() {
    this.recoveryError = '';
    if (this.newPasswordAfterRecovery.length < 6) {
      this.recoveryError = 'Password must be at least 6 characters.';
      return;
    }
    if (this.newPasswordAfterRecovery !== this.newPasswordAfterRecoveryConfirm) {
      this.recoveryError = 'Passwords do not match.';
      return;
    }
    await this.vault.resetPasswordAfterRecoveryUnlock(this.newPasswordAfterRecovery);
    this.newPasswordAfterRecovery = '';
    this.newPasswordAfterRecoveryConfirm = '';
    this.screen.set('gallery');
    this.loadThumbnails();
  }

  // ---------- Gallery ----------
  lockVault() {
    this.revokeThumbUrls();
    this.vault.lock();
    this.screen.set('lock');
  }

  triggerImport() {
    this.fileInput?.nativeElement.click();
  }

  async onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;
    this.importing = true;
    this.importError = '';
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        await this.vault.importFile(file);
      }
      await this.loadThumbnails();
    } catch (e) {
      this.importError = 'Some files could not be imported.';
    } finally {
      this.importing = false;
      input.value = '';
    }
  }

  private async loadThumbnails() {
    const list = this.vault.photos();
    for (const p of list) {
      if (!this.thumbUrls.has(p.id)) {
        try {
          const url = await this.vault.getDecryptedUrl(p.id, true);
          this.thumbUrls.set(p.id, url);
        } catch {
          // skip broken photo
        }
      }
    }
  }

  private revokeThumbUrls() {
    for (const url of this.thumbUrls.values()) URL.revokeObjectURL(url);
    this.thumbUrls.clear();
    if (this.viewerUrl) {
      URL.revokeObjectURL(this.viewerUrl);
      this.viewerUrl = null;
    }
  }

  async openViewer(photo: PhotoListItem) {
    this.viewerPhotoId = photo.id;
    this.viewerUrl = await this.vault.getDecryptedUrl(photo.id, false);
  }

  closeViewer() {
    if (this.viewerUrl) URL.revokeObjectURL(this.viewerUrl);
    this.viewerUrl = null;
    this.viewerPhotoId = null;
  }

  async deleteCurrentPhoto() {
    if (!this.viewerPhotoId) return;
    const id = this.viewerPhotoId;
    this.closeViewer();
    const thumbUrl = this.thumbUrls.get(id);
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    this.thumbUrls.delete(id);
    await this.vault.deletePhoto(id);
  }

  async exportCurrentPhoto() {
    if (!this.viewerPhotoId) return;
    const { blob, fileName } = await this.vault.exportPhoto(this.viewerPhotoId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }
}
