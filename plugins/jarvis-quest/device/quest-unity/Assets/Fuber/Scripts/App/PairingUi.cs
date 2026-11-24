// Holografik panodaki eşleşme arayüzü: durum metni (aranıyor / bulundu / eşleşiyor / bağlanıyor / bağlandı),
// girilen PIN göstergesi ve çimdikle basılan 0-9 tuş takımı. Akış BridgeDriver'dadır; burası yalnız gösterir ve
// tuşları iletir. 6. hane girilince PIN kendiliğinden gönderilir ("OK" da gönderir, "SİL" son haneyi siler).

using System.Text;
using UnityEngine;

namespace Fuber.App
{
    public sealed class PairingUi : MonoBehaviour
    {
        public BridgeDriver driver;
        public TextMesh title;
        public TextMesh status;
        public TextMesh pinText;
        public GameObject keypad;

        private string _pin = "";
        private string _lastStatus;
        private string _lastPin;

        private void Start()
        {
            if (keypad != null)
            {
                foreach (var k in keypad.GetComponentsInChildren<KeypadKey>(true))
                {
                    var key = k.key;
                    var target = k.GetComponent<PinchTarget>();
                    if (target != null) target.onPress += () => OnKey(key);
                }
            }
            Refresh(true);
        }

        public void OnKey(string key)
        {
            if (driver == null || driver.Phase != PairPhase.Found) return;
            switch (key)
            {
                case "del":
                    if (_pin.Length > 0) _pin = _pin.Substring(0, _pin.Length - 1);
                    break;
                case "ok":
                    Submit();
                    break;
                default:
                    if (key.Length == 1 && char.IsDigit(key[0]) && _pin.Length < BridgeDriver.PinLength)
                    {
                        _pin += key;
                        if (_pin.Length == BridgeDriver.PinLength) Submit();
                    }
                    break;
            }
            Refresh(true);
        }

        private void Submit()
        {
            if (_pin.Length != BridgeDriver.PinLength) return;
            var pin = _pin;
            _pin = "";
            driver.BeginPairWithPin(pin);
        }

        private void Update() => Refresh(false);

        private void Refresh(bool force)
        {
            if (driver == null) return;
            var phase = driver.Phase;
            var pc = driver.FoundPc;
            bool canEnterPin = phase == PairPhase.Found && pc != null && pc.Pairing;
            if (phase != PairPhase.Found && _pin.Length > 0) _pin = "";

            if (keypad != null && keypad.activeSelf != canEnterPin) keypad.SetActive(canEnterPin);

            string line;
            switch (phase)
            {
                case PairPhase.Searching:
                    line = "Fuber PC aranıyor…\nBilgisayarda: Fuber › Gözlük › Eşleştir";
                    break;
                case PairPhase.Found:
                    line = $"Fuber PC bulundu: {Short(pc?.Name)}  [{Fp4(pc?.Fp)}]\n" +
                           (canEnterPin ? "Ekrandaki 6 haneli PIN'i gir" : "Bilgisayarda eşleşmeyi aç");
                    break;
                case PairPhase.Pairing:
                    line = $"Eşleşiyor… {Short(pc?.Name)}";
                    break;
                case PairPhase.Resuming:
                    line = $"{Short(driver.PcName)} bilgisayarına bağlanıyor…";
                    break;
                case PairPhase.Connected:
                    line = $"Bağlandı · {Short(driver.PcName)}";
                    break;
                default:
                    line = "";
                    break;
            }
            string msg = driver.Message;
            if (!string.IsNullOrEmpty(msg) && phase != PairPhase.Pairing && !line.Contains(msg)) line += "\n" + msg;

            if (status != null && (force || line != _lastStatus))
            {
                status.text = line;
                _lastStatus = line;
            }

            string pinLine = canEnterPin ? PinMask() : "";
            if (pinText != null && (force || pinLine != _lastPin))
            {
                pinText.text = pinLine;
                _lastPin = pinLine;
            }

            if (title != null)
            {
                var c = phase == PairPhase.Connected ? new Color(0.55f, 1f, 0.6f) : new Color(0.75f, 0.97f, 1f);
                if (title.color != c) title.color = c;
            }
        }

        private string PinMask()
        {
            var sb = new StringBuilder();
            for (int i = 0; i < BridgeDriver.PinLength; i++)
            {
                if (i > 0) sb.Append(' ');
                sb.Append(i < _pin.Length ? _pin[i] : '_');
            }
            return sb.ToString();
        }

        private static string Short(string s)
        {
            if (string.IsNullOrEmpty(s)) return "?";
            return s.Length > 22 ? s.Substring(0, 21) + "…" : s;
        }

        private static string Fp4(string fp) => string.IsNullOrEmpty(fp) ? "????" : fp.Substring(0, Mathf.Min(4, fp.Length)); // PC ekranındaki ilk 4 karakterle birebir (harf dönüşümü yok)
    }
}
