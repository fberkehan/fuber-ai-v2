// El ile etkileşim (kontrolcüsüz). Her el için:
//  • YAKIN: başparmak + işaret parmağı ucu arasındaki çimdik noktası bir PinchTarget'a ~8 cm yakınsa o hedeflenir.
//  • UZAK: değilse elin işaretçi ışını (OVRHand.PointerPose) ile ışın atılır; ışın görünür çizgi olarak çizilir.
//  • Çimdik başlangıcı → hedefe Press (JarvisCore renk/nabız, HoloPanel parlama); hedef taşınabilirse tutulur.
//  • Çimdik sürerken: yakında çimdik noktasını, uzakta ışın üstündeki aynı mesafeyi izleyerek taşınır.
//  • Çimdik bitince bırakılır. Pano dünyada yeni konumunda kalır.

using UnityEngine;

namespace Fuber.App
{
    public sealed class FuberHandInteractor : MonoBehaviour
    {
        public OVRHand leftHand;
        public OVRHand rightHand;
        public OVRSkeleton leftSkeleton;
        public OVRSkeleton rightSkeleton;

        [Tooltip("Işın çizgisinin malzemesi (URP Unlit, saydam).")]
        public Material rayMaterial;

        [Tooltip("Yakın çimdik yarıçapı (m).")]
        public float nearRadius = 0.08f;

        [Tooltip("Işın uzunluğu (m).")]
        public float rayLength = 5f;

        [Tooltip("Taşırken izleme yumuşaklığı (büyük = sıkı).")]
        public float followSharpness = 22f;

        private sealed class HandState
        {
            public OVRHand hand;
            public OVRSkeleton skeleton;
            public LineRenderer line;
            public Transform cursor;
            public bool wasPinching;
            public PinchTarget hover;
            public bool suppressed;
            public PinchTarget held;
            public bool heldByRay;
            public float heldDistance;
            public Vector3 heldOffset;
            public Vector3 pinchPoint;
            public Vector3 goal;
            public bool hasGoal;
            public Vector3 lastHeldPos;
            public Vector3 heldVel;
            public PinchTarget holding;
            public float tipDist = -1f, strength;
            public bool rawPinch, pinchState;
            public string lastHit = "-";
            public Collider hitCol;
            public Vector3 hitPoint;   // basılı tutma (hold) bekleyen hedef
        }

        /// <summary>Sol el etkileşimini kapat (avuç menüsü açıkken ışın/çimdik menüye karışmasın).</summary>
        public bool leftSuppressed;
        public bool rightSuppressed;

        [Tooltip("Bu hızın (m/sn) üstünde bırakılan fırlatılabilir pano kapanır.")]
        public float throwSpeed = 1.5f;

        private bool _twoHand;
        private float _twoStartDist;
        private Vector3 _twoStartScale;
        private PinchTarget _twoTarget;

        private HandState[] _hands;

        /// <summary>Tanı: el `i` (0 sol, 1 sağ) için durum satırı.</summary>
        public string DiagLine(int i)
        {
            if (_hands == null) return "yok(başlamadı)";
            var hs = _hands[i];
            var h = hs.hand; var sk = hs.skeleton;
            if (h == null) return "OVRHand=NULL";
            string skel = sk == null ? "iskelet=NULL" : $"iskelet(init={sk.IsInitialized},tip={sk.GetSkeletonType()},kemik={(sk.Bones != null ? sk.Bones.Count : -1)})";
            return $"tracked={h.IsTracked} valid={h.IsDataValid} ptr={h.IsPointerPoseValid} conf={h.HandConfidence} pinch={hs.strength:0.00} isPinching={hs.rawPinch} durum={hs.pinchState} uç={hs.tipDist:0.000} ışın={hs.lastHit} {skel} pinchPt={hs.pinchPoint} hover={(hs.hover != null ? hs.hover.name : "-")} held={(hs.held != null ? hs.held.name : "-")} supp={hs.suppressed}";
        }
        private readonly Collider[] _overlap = new Collider[16];

        private void Start()
        {
            _hands = new[]
            {
                Create(leftHand, leftSkeleton, "Sol"),
                Create(rightHand, rightSkeleton, "Sağ"),
            };
        }

        private HandState Create(OVRHand hand, OVRSkeleton skeleton, string label)
        {
            var go = new GameObject($"Işın ({label})");
            go.transform.SetParent(transform, false);
            var line = go.AddComponent<LineRenderer>();
            line.positionCount = 2;
            line.useWorldSpace = true;
            line.startWidth = 0.004f;
            line.endWidth = 0.0015f;
            line.numCapVertices = 2;
            line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            line.receiveShadows = false;
            if (rayMaterial != null) line.sharedMaterial = rayMaterial;
            line.enabled = false;

            var cursor = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            cursor.name = $"İmleç ({label})";
            Destroy(cursor.GetComponent<Collider>());
            cursor.transform.SetParent(transform, false);
            cursor.transform.localScale = Vector3.one * 0.012f;
            var cr = cursor.GetComponent<Renderer>();
            if (rayMaterial != null) cr.sharedMaterial = rayMaterial;
            cr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            cursor.SetActive(false);

            return new HandState { hand = hand, skeleton = skeleton, line = line, cursor = cursor.transform };
        }

        private void Update()
        {
            if (_hands == null) return;
            Physics.SyncTransforms();   // paneller Update'te taşınıyor; fizik dünyası aynı karede eşitlensin
            _hands[0].suppressed = leftSuppressed;
            _hands[1].suppressed = rightSuppressed;
            foreach (var hs in _hands) Tick(hs);
            ApplyHeldMotion();
        }

        /// <summary>Tutulan hedeflerin konumu: tek elle o elin hedefi; iki elle iki hedefin ortalaması. İki elle ayrıca ölçek.</summary>
        private void ApplyHeldMotion()
        {
            var a = _hands[0]; var b = _hands[1];
            float k = 1f - Mathf.Exp(-followSharpness * Time.deltaTime);
            bool both = a.held != null && a.held == b.held;
            for (int i = 0; i < 2; i++)
            {
                var hs = _hands[i];
                if (hs.held == null || !hs.hasGoal) continue;
                if (both && i == 1) continue; // ortalama ilk elde uygulanır
                Vector3 goal = hs.goal;
                if (both && b.hasGoal) goal = (a.goal + b.goal) * 0.5f;
                var t = hs.held.transform;
                t.position = Vector3.Lerp(t.position, goal, k);
            }
            // Hız (fırlatma tespiti): hedefin gerçek konum değişimi, EMA.
            float dt = Mathf.Max(Time.deltaTime, 1e-4f);
            for (int i = 0; i < 2; i++)
            {
                var hs = _hands[i];
                if (hs.held == null) continue;
                Vector3 p = hs.held.transform.position;
                Vector3 v = (p - hs.lastHeldPos) / dt;
                hs.heldVel = Vector3.Lerp(hs.heldVel, v, 0.45f);
                hs.lastHeldPos = p;
            }

            if (both && a.held.scalable && a.hasGoal && b.hasGoal)
            {
                float d = Vector3.Distance(a.pinchPoint, b.pinchPoint);
                if (!_twoHand || _twoTarget != a.held)
                {
                    _twoHand = true; _twoTarget = a.held; _twoStartDist = Mathf.Max(d, 0.03f); _twoStartScale = a.held.transform.localScale;
                }
                float f = Mathf.Clamp(d / _twoStartDist, 0.4f, 3f);
                var ts = _twoStartScale * f;
                float baseS = _twoStartScale.x;
                float clamped = Mathf.Clamp(ts.x, 0.45f, 2.2f);
                a.held.transform.localScale = _twoStartScale * (clamped / Mathf.Max(baseS, 1e-4f));
            }
            else _twoHand = false;
        }

        private void Tick(HandState hs)
        {
            var hand = hs.hand;
            bool tracked = hand != null && hand.IsTracked && !hs.suppressed;
            hs.hasGoal = false;
            if (!tracked)
            {
                if (hs.holding != null) { hs.holding.CancelHold(); hs.holding = null; }
                if (hs.held != null) { hs.held.Release(); hs.held = null; }
                SetHover(hs, null);
                hs.wasPinching = false;
                hs.line.enabled = false;
                hs.cursor.gameObject.SetActive(false);
                return;
            }

            Vector3 pinchPoint = PinchPoint(hs);
            // Sağlam çimdik: OVR çimdik biti VEYA güç > 0.7 VEYA uç mesafesi < 2 cm (bırakma: güç < 0.5 ve mesafe > 3.5 cm).
            hs.rawPinch = hand.GetFingerIsPinching(OVRHand.HandFinger.Index);
            hs.strength = hand.GetFingerPinchStrength(OVRHand.HandFinger.Index);
            bool pinching;
            if (!hs.pinchState) pinching = hs.rawPinch || hs.strength > 0.7f || (hs.tipDist > 0f && hs.tipDist < 0.02f);
            else pinching = hs.rawPinch || hs.strength >= 0.5f || (hs.tipDist > 0f && hs.tipDist < 0.035f);
            hs.pinchState = pinching;
            hs.pinchPoint = pinchPoint;
            bool rayValid = hand.IsPointerPoseValid;
            Ray ray = rayValid ? new Ray(hand.PointerPose.position, hand.PointerPose.forward) : default;
            if (!rayValid && Camera.main != null && pinchPoint.sqrMagnitude > 1e-6f)
            {
                // İşaretçi pozu yoksa: omuz tahmininden (baş + yan/aşağı) çimdik noktasından geçen ışın.
                var cam = Camera.main.transform;
                Vector3 shoulder = cam.position + Vector3.down * 0.18f + cam.right * (hs == _hands[0] ? -0.17f : 0.17f);
                Vector3 d = pinchPoint - shoulder;
                if (d.sqrMagnitude > 1e-4f) { ray = new Ray(pinchPoint, d.normalized); rayValid = true; }
            }

            // ── Hedef seçimi (tutulmuyorsa) ──
            PinchTarget near = null, far = null;
            Vector3 farPoint = Vector3.zero;
            float farDistance = 0f;
            if (hs.held == null)
            {
                near = NearestTarget(pinchPoint);
                if (near == null && rayValid && Physics.Raycast(ray, out var hit, rayLength, ~0, QueryTriggerInteraction.Collide))
                {
                    far = hit.collider.GetComponentInParent<PinchTarget>();
                    hs.lastHit = hit.collider.name + "@" + hit.distance.ToString("0.00");
                    hs.hitCol = hit.collider; hs.hitPoint = hit.point;
                    farPoint = hit.point;
                    farDistance = hit.distance;
                }
                if (far == null) hs.lastHit = rayValid ? "isabet yok" : "ışın geçersiz";
                if (near != null) { hs.hitCol = _nearCol; hs.hitPoint = pinchPoint; } else if (far == null) hs.hitCol = null;
                SetHover(hs, near != null ? near : far);
            }

            // ── Çimdik başlangıcı ──
            if (pinching && !hs.wasPinching)
                Debug.Log($"[FuberHand] ÇİMDİK başladı {(hs == _hands[0] ? "sol" : "sağ")} güç={hs.strength:0.00} ovr={hs.rawPinch} uç={hs.tipDist:0.000} hover={(hs.hover != null ? hs.hover.name : "YOK")} ışın={hs.lastHit}");
            if (!pinching && hs.wasPinching)
                Debug.Log($"[FuberHand] çimdik bitti {(hs == _hands[0] ? "sol" : "sağ")}");
            if (pinching && !hs.wasPinching && hs.hover != null)
            {
                var target = hs.hover;
                if (target.holdSeconds > 0f) { target.BeginHold(); hs.holding = target; }
                else target.Press();
                if (target.movable)
                {
                    hs.held = target;
                    hs.heldByRay = near == null;
                    if (hs.heldByRay)
                    {
                        hs.heldDistance = farDistance;
                        hs.heldOffset = target.transform.position - farPoint;
                    }
                    else
                    {
                        hs.heldOffset = target.transform.position - pinchPoint;
                    }
                    target.Grab();
                    hs.lastHeldPos = target.transform.position;
                    hs.heldVel = Vector3.zero;
                }
            }

            // ── Basılı tutma (Acil durdur): hedefin üstünde kalındıkça ilerler, kayarsa/bırakılırsa iptal ──
            if (hs.holding != null)
            {
                if (pinching && hs.hover == hs.holding) hs.holding.TickHold(Time.deltaTime);
                else { hs.holding.CancelHold(); hs.holding = null; }
            }

            // ── Taşıma ──
            if (pinching && hs.held != null)
            {
                hs.goal = hs.heldByRay && rayValid
                    ? ray.GetPoint(hs.heldDistance) + hs.heldOffset
                    : pinchPoint + hs.heldOffset;
                hs.hasGoal = true;
            }

            // ── Bırakma (hızlıysa fırlatma) ──
            if (!pinching && hs.held != null)
            {
                var released = hs.held;
                var vel = hs.heldVel;
                hs.held.Release();
                hs.held = null;
                if (released.throwable && vel.magnitude > throwSpeed) released.Thrown(vel);
            }
            hs.wasPinching = pinching;

            // ── Işın görseli ──
            bool nearMode = (hs.held != null && !hs.heldByRay) || (hs.held == null && near != null);
            if (rayValid && !nearMode)
            {
                Vector3 end = hs.held != null ? ray.GetPoint(hs.heldDistance)
                            : far != null ? farPoint
                            : ray.GetPoint(Mathf.Min(rayLength, 1.2f));
                hs.line.enabled = true;
                hs.line.SetPosition(0, ray.origin);
                hs.line.SetPosition(1, end);
                float w = pinching ? 0.007f : 0.004f;
                hs.line.startWidth = w;
                bool onTarget = hs.held != null || far != null;
                hs.cursor.gameObject.SetActive(onTarget);
                hs.cursor.position = end;
                hs.cursor.localScale = Vector3.one * (pinching ? 0.018f : 0.012f);
            }
            else
            {
                hs.line.enabled = false;
                hs.cursor.gameObject.SetActive(nearMode);
                hs.cursor.position = pinchPoint;
                hs.cursor.localScale = Vector3.one * (pinching ? 0.016f : 0.01f);
            }
        }

        private void SetHover(HandState hs, PinchTarget target)
        {
            if (hs.hover == target) return;
            if (hs.hover != null) hs.hover.HoverExit();
            hs.hover = target;
            if (hs.hover != null) { hs.hover.HoverEnter(); Debug.Log(HoverDiag(hs)); }
        }

        private Collider _nearCol;

        /// <summary>Tanı: hover hedefinin collider merkezi ile görsel (renderer) merkezi arasındaki fark.</summary>
        private static string HoverDiag(HandState hs)
        {
            var t = hs.hover;
            var col = hs.hitCol;
            var mr = t.GetComponentInParent<MeshRenderer>();
            string path = t.transform.parent != null ? t.transform.parent.name + "/" + t.name : t.name;
            string c = col != null ? $"col={col.name} merkez={col.bounds.center:0.00} boyut={col.bounds.size:0.00}" : "col=?";
            string v = mr != null ? $"görsel={mr.name} merkez={mr.bounds.center:0.00}" : "görsel=yok";
            float d = col != null && mr != null ? Vector3.Distance(col.bounds.center, mr.bounds.center) : -1f;
            return $"[FuberHand] hover → {path} {c} {v} fark={d:0.000} isabet={hs.hitPoint:0.00} ışın={hs.lastHit}";
        }

        private PinchTarget NearestTarget(Vector3 point)
        {
            int n = Physics.OverlapSphereNonAlloc(point, nearRadius, _overlap, ~0, QueryTriggerInteraction.Collide);
            PinchTarget best = null;
            float bestSq = float.MaxValue;
            for (int i = 0; i < n; i++)
            {
                var c = _overlap[i];
                var pt = c.GetComponentInParent<PinchTarget>();
                if (pt == null) continue;
                float d = (c.ClosestPoint(point) - point).sqrMagnitude;
                if (!pt.movable) d *= 0.25f; // iç içe: düğme, altındaki panele göre öncelikli
                if (d < bestSq) { bestSq = d; best = pt; _nearCol = c; }
            }
            return best;
        }

        /// <summary>Başparmak ve işaret parmağı uçlarının ortası; iskelet hazır değilse işaretçi pozu ya da el kökü.</summary>
        private static Vector3 PinchPoint(HandState hs)
        {
            var skel = hs.skeleton;
            if (skel != null && skel.IsInitialized && skel.Bones != null)
            {
                // OpenXR ve eski (OVR) el iskeletlerinde kimlik sayıları örtüşür; iskelet tipine göre doğru kimliği seç.
                var type = skel.GetSkeletonType();
                bool xr = type == OVRSkeleton.SkeletonType.XRHandLeft || type == OVRSkeleton.SkeletonType.XRHandRight;
                var indexId = xr ? OVRSkeleton.BoneId.XRHand_IndexTip : OVRSkeleton.BoneId.Hand_IndexTip;
                var thumbId = xr ? OVRSkeleton.BoneId.XRHand_ThumbTip : OVRSkeleton.BoneId.Hand_ThumbTip;
                Transform index = null, thumb = null;
                var bones = skel.Bones;
                for (int i = 0; i < bones.Count; i++)
                {
                    var b = bones[i];
                    if (b == null || b.Transform == null) continue;
                    if (b.Id == indexId) index = b.Transform;
                    else if (b.Id == thumbId) thumb = b.Transform;
                }
                if (index != null && thumb != null) { hs.tipDist = Vector3.Distance(index.position, thumb.position); return (index.position + thumb.position) * 0.5f; }
                if (index != null) return index.position;
            }
            if (hs.hand != null && hs.hand.IsPointerPoseValid) return hs.hand.PointerPose.position;
            return hs.hand != null ? hs.hand.transform.position : Vector3.zero;
        }
    }
}
