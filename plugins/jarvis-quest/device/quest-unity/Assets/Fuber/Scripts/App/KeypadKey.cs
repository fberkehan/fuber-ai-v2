// Holografik tuş takımının bir tuşu: "0".."9", "del" (sil) ya da "ok" (gönder). Çimdik PinchTarget'tan gelir,
// PairingUi bu bileşeni bulup tuşun basılma olayına bağlanır.

using UnityEngine;

namespace Fuber.App
{
    public sealed class KeypadKey : MonoBehaviour
    {
        [Tooltip("\"0\"..\"9\", \"del\" ya da \"ok\".")]
        public string key = "0";
    }
}
