// Vite'nin sorgulu içe aktarımları (vite/client türleri projede yok): `?worker&url` dosyayı ayrı paket olarak yayımlar ve adresini verir.
declare module '*?worker&url' {
  const adres: string;
  export default adres;
}
