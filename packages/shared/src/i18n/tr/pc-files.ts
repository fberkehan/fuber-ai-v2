// Bilgisayar modülünün dosya yönetimi araçları (ara, kopyala, taşı, klasör oluştur, sil, aç, Gezgin'de göster):
// araç sonuçları, onay cümleleri ve red nedenleri.
export default {
  'pc.files.kind.file': 'dosya',
  'pc.files.kind.folder': 'klasör',

  // Ortak redler
  'pc.files.badPath': 'Yol kabul edilmedi: {reason}',
  'pc.files.blocked': 'Bu yola dokunmam: {reason}.',
  'pc.files.blockedReal': 'Bu yola dokunmam (gerçek yeri: {path}): {reason}.',
  'pc.files.missing': 'Bu yolda bir dosya ya da klasör yok: {path}. Adını bilmiyorsan file_find ile ara.',
  'pc.files.notFolder': 'Bu yol bir klasör değil: {path}.',
  'pc.files.link': 'Bu bir bağ (kısayol klasörü ya da sembolik bağ): {path}. Bağlar kopyalanmaz, taşınmaz, silinmez; hedefin kendi yolunu ver.',
  'pc.files.protected': 'Bu klasör korunuyor ({path}): izinli klasörün kendisi, kullanıcı klasörü ya da bir sürücünün kökü taşınamaz, silinemez. İçindeki bir dosya ya da alt klasör için yeniden dene.',
  'pc.files.approvalDenied': 'Kullanıcı izin vermedi; hiçbir şey yapmadım. İzinli klasörler Ayarlar › Gizlilik › Dosya erişimi bölümünden eklenir.',
  'pc.files.approvalExpired': 'Onay süresi doldu; hiçbir şey yapmadım.',
  'pc.files.failed': 'Yapılamadı: {error}',
  'pc.files.badName': 'Yeni ad geçersiz: “{name}”. Ad klasör ayırıcısı ya da < > : " | ? * içeremez, nokta ya da boşlukla bitemez.',
  'pc.files.exists': 'Hedefte aynı adda bir {kind} zaten var: {path}. Üzerine yazmam; new_name ile başka bir ad ver ya da başka bir klasör seç.',
  'pc.files.destMissing': 'Hedef klasör yok: {path}. Önce folder_create ile oluştur.',
  'pc.files.samePlace': 'Kaynak ve hedef aynı yer: {path}. Başka bir klasör (to) ya da yeni bir ad (new_name) ver.',
  'pc.files.intoItself': 'Bir klasör kendi içine kopyalanamaz ya da taşınamaz.',
  'pc.files.needTarget': 'Hedef eksik: to (hedef klasör) ya da new_name (yeni ad) ver.',
  'pc.files.execRename': 'Dosyanın uzantısı çalıştırılabilir bir türe ({ext}) çevrilemez.',

  // Onay cümleleri (izinli klasörlerin dışına dokunan işlem)
  'pc.files.approve.find': 'İzinli klasörlerin dışındaki “{path}” klasöründe dosya aramak istiyorum.',
  'pc.files.approve.copy': '“{from}” öğesini “{to}” konumuna kopyalamak istiyorum (izinli klasörlerin dışına dokunuyor).',
  'pc.files.approve.move': '“{from}” öğesini “{to}” konumuna taşımak istiyorum (izinli klasörlerin dışına dokunuyor).',
  'pc.files.approve.rename': '“{from}” öğesinin adını “{name}” yapmak istiyorum (izinli klasörlerin dışında).',
  'pc.files.approve.mkdir': 'İzinli klasörlerin dışında “{path}” klasörünü oluşturmak istiyorum.',
  'pc.files.approve.open': 'İzinli klasörlerin dışındaki “{path}” öğesini açmak istiyorum.',
  'pc.files.approve.deleteFile': '“{path}” dosyasını Geri Dönüşüm Kutusu’na göndermek istiyorum.',
  'pc.files.approve.deleteFolder': '“{path}” klasörünü içindeki {count} öğeyle birlikte Geri Dönüşüm Kutusu’na göndermek istiyorum.',
  'pc.files.approve.deleteFolderMany': '“{path}” klasörünü içindeki {count} öğeden fazlasıyla birlikte Geri Dönüşüm Kutusu’na göndermek istiyorum.',
  'pc.files.approve.deleteUnknown': '“{path}” öğesini Geri Dönüşüm Kutusu’na göndermek istiyorum.',

  // file_find
  'pc.files.find.noRoots': 'Aranacak izinli klasör yok. Ayarlar › Gizlilik › Dosya erişimi bölümünden klasör eklenir ya da folder ile bir klasör verilir.',
  'pc.files.find.noTerms': 'Aranacak ad boş. Dosya adında geçen bir sözcük ver (name) ya da bir uzantı (extension).',
  'pc.files.find.none': '“{name}” adına uyan dosya ya da klasör bulunamadı ({where}; {scanned} öğe tarandı).',
  'pc.files.find.header': '“{name}” için {count} sonuç ({where}; yeniden eskiye):',
  'pc.files.find.more': '(Daha fazlası olabilir: {reason}. Daha belirgin bir ad ya da folder ile daralt.)',
  'pc.files.find.more.limit': 'sonuç sınırına ulaşıldı',
  'pc.files.find.more.budget': 'tarama süresi ya da öğe sınırı doldu',
  'pc.files.find.more.stopped': 'arama durduruldu',
  'pc.files.find.allRoots': 'izinli klasörlerde',
  'pc.files.find.folderTag': '[klasör]',

  // file_copy / file_move / folder_create
  'pc.files.copy.tooBig': 'Klasör kopyalanamayacak kadar büyük ({detail}; sınır {maxItems} öğe ya da {maxSize}). Daha küçük bir alt klasör seç ya da kullanıcıya Gezgin’de yapmasını öner (file_reveal).',
  'pc.files.copy.doneFile': 'Kopyalandı: {to} ({size}). Kaynak yerinde duruyor: {from}.',
  'pc.files.copy.doneFolder': 'Klasör kopyalandı: {to} ({count} öğe, {size}). Kaynak yerinde duruyor: {from}.',
  'pc.files.copy.skipped': ' {count} öğe atlandı (bağ ya da güvenlik nedeniyle kopyalanmayan dosya).',
  'pc.files.copy.stopped': 'Kopyalama durduruldu; yarım kalan kopya geri alındı: {to}.',
  'pc.files.copy.stoppedPartial': 'Kopyalama durduruldu; yarım kalan kopya yerinde kaldı (silinemedi): {to}.',
  'pc.files.move.done': 'Taşındı: {from} → {to}.',
  'pc.files.move.renamed': 'Yeniden adlandırıldı: {from} → {to}.',
  'pc.files.move.crossDrive': 'Klasör başka bir sürücüye taşınamıyor. Önce file_copy ile kopyala, kopyanın tamamlandığını gör, sonra file_delete ile eskisini sil.',
  'pc.files.mkdir.done': 'Klasör oluşturuldu: {path}.',
  'pc.files.mkdir.existed': 'Bu klasör zaten vardı: {path}.',
  'pc.files.mkdir.isFile': 'Bu adda bir dosya var; klasör oluşturulamadı: {path}.',

  // file_delete
  'pc.files.delete.done': 'Geri Dönüşüm Kutusu’na gönderildi: {path}. Kalıcı olarak silinmedi; kullanıcı Geri Dönüşüm Kutusu’ndan geri alabilir.',
  'pc.files.delete.doneFolder': 'Klasör içindeki {count} öğeyle birlikte Geri Dönüşüm Kutusu’na gönderildi: {path}. Kalıcı olarak silinmedi; kullanıcı Geri Dönüşüm Kutusu’ndan geri alabilir.',
  'pc.files.delete.failed': 'Geri Dönüşüm Kutusu’na gönderilemedi ({error}); dosya yerinde duruyor. Silindi deme.',
  'pc.files.delete.stillThere': 'Silme isteği gönderildi ama öğe hâlâ yerinde: {path}. Silindi deme.',

  // file_open / file_reveal
  'pc.files.open.executable': 'Bu tür dosyayı açmam: “{ext}” çalıştırılabilir ya da betik dosyası. Uygulama açmak için app_open, komut için pc_run_command kullan; klasörünü göstermek için file_reveal.',
  'pc.files.open.done': 'Açma isteği gönderildi: {path} (varsayılan uygulamada). Pencerenin açıldığını görmedim; gerekirse pc_windows ile doğrula.',
  'pc.files.open.doneFolder': 'Klasör Gezgin’de açıldı: {path}.',
  'pc.files.open.failed': 'Açılamadı ({error}): {path}.',
  'pc.files.reveal.done': 'Gezgin’de gösterildi: {path}.',

  // file_write / file_edit
  'pc.files.approve.write': 'İzinli klasörlerin dışında “{path}” dosyasını oluşturmak istiyorum ({size}).',
  'pc.files.approve.overwrite': '“{path}” dosyasının ÜZERİNE yazmak istiyorum: şimdiki içerik ({oldSize}) silinir, yerine yenisi ({newSize}) yazılır.',
  'pc.files.approve.overwriteOutside':
    'İzinli klasörlerin dışındaki “{path}” dosyasının ÜZERİNE yazmak istiyorum: şimdiki içerik ({oldSize}) silinir, yerine yenisi ({newSize}) yazılır.',
  'pc.files.approve.edit': 'İzinli klasörlerin dışındaki “{path}” dosyasını düzenlemek istiyorum.',
  'pc.files.write.executable': 'Bu tür dosyayı yazmam ve düzenlemem: “{ext}” çalıştırılabilir ya da betik dosyası. Metni .txt ya da .md olarak yazabilirim; kod işi için Claude Code oturumu kullanılır.',
  'pc.files.write.psFolder': 'PowerShell’in modül ve profil klasörüne yazmam: {path}.',
  'pc.files.write.binary': 'İçerikte geçersiz karakter (NUL) var; yalnız metin yazılır.',
  'pc.files.write.tooBig': 'İçerik çok büyük ({size}; sınır {max}). Daha kısa yaz ya da parçalara böl.',
  'pc.files.write.isFolder': 'Bu yol bir klasör, dosya değil: {path}.',
  'pc.files.write.link': 'Bu yol bir bağ (kısayol ya da sembolik bağ): {path}. Bağ üzerinden yazmam; dosyanın kendi yolunu ver.',
  'pc.files.write.hardLink': 'Bu dosyanın başka yerlerde de adı var (sabit bağ): {path}. Yazmam; başka bir dosya adı seç.',
  'pc.files.write.exists':
    'Bu dosya zaten var: {path}. Üzerine yazmadım. Küçük bir değişiklik için file_edit kullan; içeriğin tamamını değiştirmek için overwrite=true ver (kullanıcıdan onay istenir) ya da başka bir ad seç.',
  'pc.files.write.changed': 'Dosya onay beklenirken değişti ya da yerinden kalktı: {path}. Yazmadım.',
  'pc.files.write.created': 'Oluşturuldu: {path} ({lines} satır, {size}).',
  'pc.files.write.overwritten': 'Üzerine yazıldı: {path} ({lines} satır, {size}; önceki içerik {oldSize} idi).',
  'pc.files.edit.tooBig': 'Dosya düzenlenemeyecek kadar büyük ({size}; sınır {max}).',
  'pc.files.edit.binary': 'Bu bir metin dosyası değil (ikili içerik); düzenlemedim: {path}.',
  'pc.files.edit.notUtf8': 'Dosya UTF-8 değil; bozulmaması için düzenlemedim: {path}.',
  'pc.files.edit.same': 'old_text ile new_text aynı; değişecek bir şey yok.',
  'pc.files.edit.notFound':
    'old_text dosyada bulunamadı: {path}. Boşluklar ve satırlar dahil birebir olmalı; dosyayı yeniden oku (document_read). Dosya değişmedi.',
  'pc.files.edit.many': 'old_text dosyada {count} yerde geçiyor. Çevresindeki satırları ekleyerek daha uzun, benzersiz bir parça ver ya da hepsini değiştirmek için replace_all=true kullan. Dosya değişmedi.',
  'pc.files.edit.done': 'Düzenlendi: {path}. 1 yer değişti ({line}. satırda): {oldLines} satır → {newLines} satır; dosya şimdi {size}.',
  'pc.files.edit.doneMany': 'Düzenlendi: {path}. {count} yer değişti (ilki {line}. satırda); her birinde {oldLines} satır → {newLines} satır; dosya şimdi {size}.',
  'pc.files.edit.excerpt': '\n- {old}\n+ {new}',
  'pc.files.edit.deleted': '(silindi)',
} as const;
