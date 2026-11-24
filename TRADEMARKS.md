# Trademarks and brand assets

The source code in this repository is available under the license in `LICENSE`. **That license does not cover the Fuber name, logos or other
brand assets.** "Fuber", "Fuber AI", the Fuber logo and wordmark, the app and tray icons, and the characters shown in the app (the fox
*Tilki* and the chameleon *Bukalemun*) are brand assets of the Fuber AI project. All rights in them are reserved.

## What you may do

- Say that your software is based on, compatible with or a fork of Fuber AI ("based on Fuber AI"), as long as it is clear that it is not an
  official Fuber AI release and is not endorsed by the Fuber AI project.
- Use the name in plain text to refer to this project, for example in articles, reviews or package lists.
- Build and run the unmodified source for your own use. A private build may keep the name and icons as long as you do not distribute it.

## What you may not do without written permission

- Distribute a build, installer or app-store listing under the name "Fuber" or "Fuber AI", or with the Fuber logo, icons or characters —
  modified or not. Only the Fuber AI project publishes official builds.
- Use a name, logo or domain that is confusingly similar (for example "Fuber Pro", "FuberX" or a lookalike icon).
- Suggest that the Fuber AI project sponsors, endorses or supports your product or service.
- Use the brand assets in your own product, marketing or merchandise.

## Rebranding a fork

1. Set your own identity in `src/shared/dagitim.ts` (product name, `appId`, project address) and in `electron-builder.yml`
   (`appId`, `productName`, `copyright`, shortcut names).
2. Replace the icons in `build/` and `resources/ikon/`, the logo components in `src/renderer/ui/` and the character artwork
   (`src/shared/karakterler.ts`, `src/renderer/karakter-gorunum.ts`, `src/renderer/kurulum2/`).
3. Do not ship Fuber’s commercial interface font; this repository already uses Manrope (SIL OFL 1.1).

Questions and permission requests: open an issue at <https://github.com/fberkehan/orion/issues>.

---

**Türkçe:** Kod lisansı Fuber adını, logosunu, ikonlarını ve Tilki ile Bukalemun karakterlerini kapsamaz; bunlar Fuber AI projesinin marka
varlıklarıdır ve bütün hakları saklıdır. Fork’unu dağıtacaksan adı, logoyu, ikonları ve karakterleri değiştirmelisin. "Fuber AI tabanlı" demek
serbesttir; resmi sürüm izlenimi vermek yasaktır. Sorular ve izin istekleri: GitHub Issues.
