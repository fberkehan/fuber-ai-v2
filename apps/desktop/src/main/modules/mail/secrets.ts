// E-posta parolasının şifrelenmesi. Parola YALNIZ işletim sisteminin şifreli deposuyla (Electron `safeStorage`; Windows'ta
// DPAPI, kullanıcı hesabına bağlı) şifrelenip modülün kendi tablosunda durur; şifreleme yoksa hesap kaydedilmez (düz metin
// yazılmaz). Neden Yönetim kasasında değil: KURGU §13 ve §11.2 — kasa, yöneticinin dağıttığı SAĞLAYICI anahtarlarıdır ve
// kontrol düzleminden (ileride bulut) onaylı cihazlara iner; kullanıcının kişisel e-posta parolası bu cihazdan çıkmamalı.

export interface SecretCipher {
  available(): boolean;
  /** Şifreli metnin base64 hâli. Şifreleme yoksa fırlatır. */
  encrypt(plain: string): string;
  decrypt(encoded: string): string;
}

/** Electron `safeStorage` (yalnız `app` hazır olduktan sonra). */
export async function electronCipher(): Promise<SecretCipher> {
  const { safeStorage } = await import('electron');
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt(plain) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage kullanılamıyor');
      return safeStorage.encryptString(plain).toString('base64');
    },
    decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64')),
  };
}
