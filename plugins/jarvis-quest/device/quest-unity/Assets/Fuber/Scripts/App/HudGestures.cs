// El hareketi algılayıcıları (kontrolcüsüz, yalnız el iskeleti):
//  • SOL avuç sana dönük (avuç normali başa bakıyor) → avuç menüsü (LeftPalmFacingHead).
//  • SAĞ avuç yukarı + çimdik → "Çağır" (Summon): panel düzeni yeniden önüne gelir.
// Avuç normali iskelet noktalarından geometrik hesaplanır (bilek, işaret ve serçe parmak tabanı): sol elde
// cross(işaret-bilek, serçe-bilek), sağ elde bunun tersi, avuç dışarı bakacak şekilde (avuç aşağı → normal aşağı).

using System;
using UnityEngine;

namespace Fuber.App
{
    public sealed class HudGestures : MonoBehaviour
    {
        public OVRHand leftHand, rightHand;
        public OVRSkeleton leftSkeleton, rightSkeleton;

        public bool LeftPalmFacingHead { get; private set; }
        public bool RightPalmUp { get; private set; }
        public Vector3 LeftPalmPos { get; private set; }
        public Vector3 LeftPalmNormal { get; private set; }

        public event Action Summon;

        private sealed class Rig { public Transform wrist, index, little; public bool ready; }
        private readonly Rig _l = new Rig(), _r = new Rig();
        private float _facingT, _awayT, _lastSummon = -10f;
        private bool _prevPinchR;
        private Vector3 _nL = Vector3.up;

        private static void Resolve(OVRSkeleton sk, Rig r)
        {
            if (r.ready || sk == null || !sk.IsInitialized || sk.Bones == null) return;
            var type = sk.GetSkeletonType();
            bool xr = type == OVRSkeleton.SkeletonType.XRHandLeft || type == OVRSkeleton.SkeletonType.XRHandRight;
            var wristId = xr ? OVRSkeleton.BoneId.XRHand_Wrist : OVRSkeleton.BoneId.Hand_WristRoot;
            var indexId = xr ? OVRSkeleton.BoneId.XRHand_IndexProximal : OVRSkeleton.BoneId.Hand_Index1;
            var littleId = xr ? OVRSkeleton.BoneId.XRHand_LittleProximal : OVRSkeleton.BoneId.Hand_Pinky1;
            var bones = sk.Bones;
            for (int i = 0; i < bones.Count; i++)
            {
                var b = bones[i];
                if (b == null || b.Transform == null) continue;
                if (b.Id == wristId) r.wrist = b.Transform;
                else if (b.Id == indexId) r.index = b.Transform;
                else if (b.Id == littleId) r.little = b.Transform;
            }
            r.ready = r.wrist != null && r.index != null && r.little != null;
        }

        private static bool Palm(Rig r, bool left, out Vector3 pos, out Vector3 normal)
        {
            pos = default; normal = default;
            if (!r.ready) return false;
            Vector3 w = r.wrist.position;
            Vector3 a = r.index.position - w, b = r.little.position - w;
            Vector3 n = Vector3.Cross(a, b);
            if (n.sqrMagnitude < 1e-9f) return false;
            normal = n.normalized * (left ? 1f : -1f);
            pos = (w + (r.index.position + r.little.position) * 0.5f) * 0.5f;
            return true;
        }

        private void Update()
        {
            Resolve(leftSkeleton, _l);
            Resolve(rightSkeleton, _r);
            var cam = Camera.main;

            // ── sol avuç → baş ──
            bool lt = leftHand != null && leftHand.IsTracked;
            bool facing = false;
            if (lt && cam != null && Palm(_l, true, out var lp, out var ln))
            {
                _nL = Vector3.Slerp(_nL, ln, 0.35f);
                LeftPalmPos = lp; LeftPalmNormal = _nL;
                Vector3 toHead = (cam.transform.position - lp).normalized;
                float d = Vector3.Dot(_nL, toHead);
                // eşik: açıkken 0.7, açıkken kalma 0.45 (histerezis)
                facing = d > (LeftPalmFacingHead ? 0.45f : 0.72f) && Vector3.Distance(cam.transform.position, lp) < 0.75f;
            }
            if (facing) { _facingT += Time.deltaTime; _awayT = 0f; } else { _awayT += Time.deltaTime; _facingT = 0f; }
            if (!LeftPalmFacingHead && _facingT > 0.3f) LeftPalmFacingHead = true;
            else if (LeftPalmFacingHead && _awayT > 0.25f) LeftPalmFacingHead = false;

            // ── sağ avuç yukarı + çimdik → çağır ──
            bool rt = rightHand != null && rightHand.IsTracked;
            RightPalmUp = false;
            bool pinch = false;
            if (rt && Palm(_r, false, out _, out var rn))
            {
                RightPalmUp = rn.y > 0.6f;
                pinch = rightHand.GetFingerIsPinching(OVRHand.HandFinger.Index);
            }
            if (RightPalmUp && pinch && !_prevPinchR && Time.unscaledTime - _lastSummon > 1.5f)
            {
                _lastSummon = Time.unscaledTime;
                Summon?.Invoke();
            }
            _prevPinchR = pinch;
        }

        /// <summary>Test/önizleme için: elle tetikleme.</summary>
        public void TriggerSummon() => Summon?.Invoke();
    }
}
