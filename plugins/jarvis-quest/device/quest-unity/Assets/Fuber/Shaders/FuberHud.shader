// Tek gölgelendirici: bütün HUD çizgi/yüzey geometrisi tek malzemeyle çizilir (vertex rengi taşır).
//  uv.x,uv.y : panel-yerel 0..1 (y=1 üst) → açılış (boot) süpürmesi için
//  uv.z      : 0 = normal karışım, 1 = toplamalı (parıltı)
//  uv.w      : tarama/titreşim miktarı (0..1)
//  _Params   : x = boot (0..1), y = parlama (hover), z = sönüklük çarpanı (stale), w = kullanılmıyor
Shader "Fuber/Hud"
{
    Properties { _Params ("Boot, Glow, Dim", Vector) = (1, 0, 1, 0) }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Name "Hud"
            Tags { "LightMode"="UniversalForward" }
            Blend One OneMinusSrcAlpha
            ZWrite Off
            ZTest LEqual
            Cull Off

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _Params;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float4 color : COLOR;
                float4 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float4 color : COLOR;
                float4 uv : TEXCOORD0;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings vert(Attributes i)
            {
                Varyings o;
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformObjectToHClip(i.positionOS.xyz);
                o.color = i.color;
                o.uv = i.uv;
                return o;
            }

            half4 frag(Varyings i) : SV_Target
            {
                float boot = _Params.x;
                float glow = _Params.y;
                float dim = _Params.z;
                float edge = boot * 1.35 - (1.0 - i.uv.y);
                float vis = saturate(edge * 7.0);
                float scan = saturate(1.0 - abs(edge - 0.02) * 14.0) * step(boot, 0.995) * step(0.001, boot);
                float shimmer = 1.0 - i.uv.w * (0.5 + 0.5 * sin(_Time.y * 2.2 + i.uv.y * 55.0)) * 0.22;
                float3 rgb = i.color.rgb * (1.0 + glow * 0.9) + scan * float3(0.5, 0.9, 1.0) * i.color.a;
                float a = i.color.a * vis * dim * shimmer;
                a = saturate(a * (1.0 + glow * 0.6));
                float additive = i.uv.z;
                return half4(rgb * a, a * (1.0 - additive));
            }
            ENDHLSL
        }
    }
}
