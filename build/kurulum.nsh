; Fuber AI — kaldırıcı eki (0.11 G2, spec §2). electron-builder.yml: nsis.include: build/kurulum.nsh. Statik test: tests/kurulum-nsh.test.ts.
;
; Güncelleme ≠ yeniden kurulum: üstüne kurulumda (dağıtılan başlatıcı iç paketi /S ile çalıştırır) eski kaldırıcı "--updated" ile sessiz
; çalışır — ${isUpdated} doğruyken bu makro HİÇBİR ŞEY sormaz, silmez, yazmaz. Kullanıcının başlattığı kaldırmada:
;   · "--verileri-sil" (uygulamanın "Fuber'i bu bilgisayardan kaldır"ı; /S ile): sormadan yalnız $APPDATA\Fuber AI silinir.
;   · Aksi hâlde soru (spec cümlesi), varsayılan Hayır. Evet → yalnız $APPDATA\Fuber AI silinir. Hayır → veri klasörü duruyorsa içine
;     .yeniden-kurulum işareti yazılır (yeniden kurulunca "Tekrar hoş geldin"). Belgeler\Fuber AI'ye hiçbir yolda dokunulmaz.
; Tek tık kaldırıcı, "Kaldırılsın mı?" onayından sonra kendini sessiz kipe alır (electron-builder un.onInit): kullanıcının başlattığı
; kaldırmada komut satırında /S yoktur — soru /SD olmadan sorulur (NSIS /SD verilmemiş soruyu sessiz kipte de gösterir). Komut satırında
; /S varsa (betikle sessiz kaldırma) soru gösterilmez, /SD IDNO ile Hayır sayılır: veri kalır, işaret yazılır.
; Dosya UTF-8 (electron-builder makensis'e -INPUTCHARSET UTF8 verir; unicode kurulum varsayılan).

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; electron her zaman kullanıcıya özel veri klasörü kullanır (perMachine: false; yine de bütün kullanıcılar kipine karşı korunur).
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endIf}
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "--verileri-sil" $R1
    ${ifNot} ${Errors}
      RMDir /r "$APPDATA\Fuber AI"
    ${else}
      ClearErrors
      ${GetOptions} $R0 "/S" $R1
      ${if} ${Errors}
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Fuber’in bu bilgisayardaki verileri de silinsin mi?$\r$\n$\r$\n(hafıza, sohbetler, ayarlar, bağlantılar, indirilen yapay zekâ)$\r$\n$\r$\nBelgeler klasöründeki dosyaların kalır." IDYES fuber_veri_sil IDNO fuber_veri_kalsin
      ${else}
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Fuber’in bu bilgisayardaki verileri de silinsin mi?$\r$\n$\r$\n(hafıza, sohbetler, ayarlar, bağlantılar, indirilen yapay zekâ)$\r$\n$\r$\nBelgeler klasöründeki dosyaların kalır." /SD IDNO IDYES fuber_veri_sil IDNO fuber_veri_kalsin
      ${endIf}
      fuber_veri_sil:
        RMDir /r "$APPDATA\Fuber AI"
        Goto fuber_veri_bitti
      fuber_veri_kalsin:
        ${if} ${FileExists} "$APPDATA\Fuber AI\*.*"
          ClearErrors
          FileOpen $R2 "$APPDATA\Fuber AI\.yeniden-kurulum" w
          ${ifNot} ${Errors}
            FileWrite $R2 "kaldirildi"
            FileClose $R2
          ${endIf}
        ${endIf}
      fuber_veri_bitti:
    ${endIf}
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endIf}
  ${endIf}
!macroend
