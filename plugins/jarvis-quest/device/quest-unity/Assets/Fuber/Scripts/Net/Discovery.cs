// Gözlük tarafı keşif dinleyicisi (docs/PROTOCOL.md §5): bilgisayarın UDP 47853 yayınlarını dinler ve bulunan
// bilgisayarları listeler. Yedek akış (QR okunamazsa kullanıcı listeden seçip PIN girer). Arka plan iş parçacığı;
// liste kilitli.

using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Threading;

namespace Fuber.Net
{
    public sealed class DiscoveredPc
    {
        public string Name;
        public string Fp;
        public int Port;
        public bool Pairing;
        public string Host;      // yayının geldiği IP
        public DateTime SeenAt;
    }

    public sealed class DiscoveryListener
    {
        private UdpClient _udp;
        private Thread _thread;
        private volatile bool _running;
        private readonly object _lock = new object();
        private readonly Dictionary<string, DiscoveredPc> _found = new Dictionary<string, DiscoveredPc>();

        public void Start()
        {
            if (_running) return;
            _running = true;
            _udp = new UdpClient();
            _udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            _udp.Client.Bind(new IPEndPoint(IPAddress.Any, XrConst.DiscoveryPort));
            _udp.EnableBroadcast = true;
            _thread = new Thread(Loop) { IsBackground = true, Name = "FuberXrDiscovery" };
            _thread.Start();
        }

        private void Loop()
        {
            var remote = new IPEndPoint(IPAddress.Any, 0);
            while (_running)
            {
                try
                {
                    byte[] data = _udp.Receive(ref remote);
                    var obj = MiniJson.ParseObject(System.Text.Encoding.UTF8.GetString(data));
                    if (obj == null || !obj.TryGetValue("fuberxr", out var fx)) continue;
                    var pc = new DiscoveredPc
                    {
                        Name = Str(obj, "name"),
                        Fp = Str(obj, "f"),
                        Port = obj.TryGetValue("p", out var pv) && pv is long pl ? (int)pl : XrConst.Port,
                        Pairing = obj.TryGetValue("pairing", out var pr) && pr is bool pb && pb,
                        Host = remote.Address.ToString(),
                        SeenAt = DateTime.UtcNow
                    };
                    lock (_lock) { _found[pc.Fp + "@" + pc.Host] = pc; }
                }
                catch (SocketException) { if (!_running) break; }
                catch { /* bozuk yayın yoksay */ }
            }
        }

        private static string Str(Dictionary<string, object> m, string k) => m.TryGetValue(k, out var v) && v is string s ? s : "";

        /// <summary>Son 10 sn içinde görülen bilgisayarlar.</summary>
        public List<DiscoveredPc> Current()
        {
            var outList = new List<DiscoveredPc>();
            var now = DateTime.UtcNow;
            lock (_lock)
            {
                foreach (var pc in _found.Values)
                    if ((now - pc.SeenAt).TotalSeconds < 10) outList.Add(pc);
            }
            return outList;
        }

        public void Stop()
        {
            _running = false;
            try { _udp?.Close(); } catch { }
            _udp = null;
        }
    }
}
