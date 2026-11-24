# resources/bin

The Windows helper executables are **not committed** to the public repository. Build them from source:

```powershell
# fuber-girdi.exe (screen capture, mouse, keyboard, window list) — uses the C# compiler that ships with Windows (.NET Framework 4)
node native/derle.mjs
# fuber-olay.exe (event-driven system events: full screen, power, network, media keys) — needs Visual Studio Build Tools + Windows SDK (MSVC, C++/WinRT)
node native/derle.mjs olay
```

Both land in this folder and are packaged by electron-builder as `kaynak/bin`. The app runs without them; computer control and
system-event features stay off until they exist.

---

Bu klasördeki Windows yardımcıları genel depoya **konmaz**; yukarıdaki iki komutla kaynaktan derlenir. Uygulama onlarsız da açılır; bilgisayar
kontrolü ve sistem olayları onlar derlenene dek kapalı kalır.
