/**
 * Türkçe sözlük · alan: xr. Quest 3 köprüsü: gözlükteki Fuber uygulamasının bu bilgisayarla QR + PIN ile eşleşmesi,
 * bağlı cihazlar ve "VR" sayfası. Düz anahtarlar; yer tutucu `{ad}`.
 */
export default {
  'module.xr.name': 'VR (Quest köprüsü)',
  'module.xr.description': 'Meta Quest 3 gözlükteki Fuber uygulamasını bu bilgisayara QR kod ve 6 haneli PIN ile eşler; bağlantı uçtan uca şifrelidir.',
  'xr.nav': 'VR',

  'xr.page.title': 'VR — Quest köprüsü',
  'xr.page.subtitle': 'Gözlükteki Fuber uygulamasını bu bilgisayarla eşleyin.',
  'xr.page.state': 'Köprü durumu',
  'xr.page.running': 'Dinliyor',
  'xr.page.stopped': 'Kapalı',
  'xr.page.connected': 'Gözlük bağlı',
  'xr.page.notConnected': 'Bağlı gözlük yok',
  'xr.page.port': 'Kapı',
  'xr.page.hosts': 'Bu bilgisayarın adresleri',
  'xr.page.noHosts': 'Yerel ağ adresi bulunamadı. Bilgisayar ve gözlük aynı Wi-Fi ağında olmalı.',
  'xr.page.fingerprint': 'Güvenlik kodu',
  'xr.page.fingerprintHint': 'Gözlükte görünen güvenlik kodu bununla aynı olmalı.',

  'xr.pair.title': 'Yeni gözlük eşle',
  'xr.pair.body': 'Gözlükte Fuber uygulamasını açın, “Bilgisayara bağlan” deyin ve bu QR koda bakın ya da PIN’i girin.',
  'xr.pair.start': 'Eşleşmeyi başlat',
  'xr.pair.cancel': 'İptal',
  'xr.pair.watchOpen': 'Başka bir cihaz için bir eşleşme penceresi açık. Gözlük eşlemek için önce onu kapatın.',
  'xr.pair.pin': 'PIN',
  'xr.pair.expires': '{seconds} sn içinde kapanır',
  'xr.pair.attempts': 'Kalan deneme: {count}',
  'xr.pair.qrAlt': 'Eşleşme QR kodu',

  'xr.devices.title': 'Eşleşmiş gözlükler',
  'xr.devices.empty': 'Henüz eşleşmiş gözlük yok.',
  'xr.devices.forget': 'Unut',
  'xr.devices.lastSeen': 'Son görülme: {when}',
  'xr.devices.online': 'Bağlı',

  'xr.how.title': 'Nasıl bağlanır',
  'xr.how.1': 'Bilgisayar ve gözlük aynı Wi-Fi ağında olsun.',
  'xr.how.2': 'Gözlükte Fuber uygulamasını açın.',
  'xr.how.3': '“Eşleşmeyi başlat”a basın; gözlükle QR koda bakın ya da PIN’i girin.',
  'xr.how.4': 'Windows güvenlik duvarı izin sorarsa “Özel ağlar” için izin verin.',
} as const;
