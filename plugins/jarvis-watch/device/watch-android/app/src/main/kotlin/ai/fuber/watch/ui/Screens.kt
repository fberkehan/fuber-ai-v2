package ai.fuber.watch.ui

import ai.fuber.watch.UiState
import ai.fuber.watch.net.Link
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

object Jarvis {
    val bg = Color(0xFF02070B)
    val cyan = Color(0xFF19E6FF)
    val cyanDim = Color(0xFF0E7F90)
    val ember = Color(0xFFFF8A3D)
    val text = Color(0xFFD8F6FF)
    val muted = Color(0xFF6A8A94)
}

@Composable
fun FuberTheme(content: @Composable () -> Unit) = MaterialTheme { Box(Modifier.fillMaxSize().background(Jarvis.bg)) { content() } }

/** İnce camgöbeği halkalar; `pulse` 0..1 nabız halkasını büyütür. */
@Composable
private fun Rings(pulse: Float, live: Boolean) {
    Canvas(Modifier.fillMaxSize()) {
        val c = Offset(size.width / 2, size.height / 2)
        val r = size.minDimension / 2
        drawCircle(Jarvis.cyan.copy(alpha = 0.35f), r - 3.dp.toPx(), c, style = Stroke(1.dp.toPx()))
        drawCircle(Jarvis.cyanDim.copy(alpha = 0.45f), r - 9.dp.toPx(), c, style = Stroke(0.6.dp.toPx()))
        drawCircle(Jarvis.cyanDim.copy(alpha = 0.25f), r * 0.62f, c, style = Stroke(0.6.dp.toPx()))
        if (live) drawCircle(Jarvis.cyan.copy(alpha = 0.55f * (1f - pulse)), r * (0.55f + 0.2f * pulse), c, style = Stroke(1.2.dp.toPx()))
    }
}

fun linkTitle(s: UiState): String = when (s.link) {
    Link.SEARCHING -> "PC aranıyor"
    Link.FOUND -> "PC bulundu"
    Link.PAIRING -> "Eşleşiyor…"
    Link.IDLE -> "Eşleşmiş · hazır"
    Link.CONNECTED -> "Eşleşmiş · bağlı"
}

@Composable
fun StatusLine(s: UiState) {
    val color = if (s.link == Link.CONNECTED) Jarvis.cyan else if (s.link == Link.FOUND) Jarvis.text else Jarvis.muted
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(linkTitle(s), color = color, fontSize = 11.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
        s.pcName?.let { Text(it, color = Jarvis.muted, fontSize = 9.sp, maxLines = 1) }
    }
}

@Composable
fun PermissionScreen(onRequest: () -> Unit, denied: Boolean) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Rings(0f, false)
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = 28.dp)) {
            Text("FUBER", color = Jarvis.cyan, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(
                if (denied) "Nabız izni verilmedi. Ayarlardan izin verin." else "Nabız ve adım için izin gerekli.",
                color = Jarvis.text, fontSize = 11.sp, textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(8.dp))
            PillButton("İzin ver", onRequest)
        }
    }
}

@Composable
fun PillButton(label: String, onClick: () -> Unit, accent: Color = Jarvis.cyan) {
    Box(
        Modifier.border(1.dp, accent, RoundedCornerShape(50)).clickable(onClick = onClick).padding(horizontal = 18.dp, vertical = 7.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = accent, fontSize = 12.sp, fontWeight = FontWeight.Medium) }
}

/** Eşleşmemiş: durum + 6 haneli PIN tuş takımı. */
@Composable
fun PairScreen(s: UiState, onPin: (String) -> Unit) {
    var pin by remember { mutableStateOf("") }
    val canEnter = s.link == Link.FOUND || s.link == Link.PAIRING
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Rings(0f, false)
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(top = 4.dp)) {
            StatusLine(s)
            Spacer(Modifier.height(2.dp))
            if (canEnter) {
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.height(18.dp)) {
                    for (i in 0 until 6) {
                        if (i < pin.length) Text(pin[i].toString(), color = Jarvis.cyan, fontSize = 14.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                        else Box(Modifier.size(5.dp).border(1.dp, Jarvis.cyanDim, CircleShape))
                    }
                }
                Spacer(Modifier.height(1.dp))
                val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("←", "0", ""))
                for (row in rows) {
                    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        for (k in row) {
                            if (k.isEmpty()) Spacer(Modifier.size(29.dp))
                            else Key(k) {
                                if (s.link == Link.PAIRING) return@Key
                                if (k == "←") pin = pin.dropLast(1)
                                else if (pin.length < 6) {
                                    pin += k
                                    if (pin.length == 6) { onPin(pin); pin = "" }
                                }
                            }
                            Unit
                        }
                    }
                    Spacer(Modifier.height(3.dp))
                }
            } else {
                Spacer(Modifier.height(8.dp))
                Text("Masaüstünde Fuber AI › Saat › Eşleştir", color = Jarvis.muted, fontSize = 9.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 30.dp))
            }
            s.linkMessage?.let {
                Text(it, color = Jarvis.ember, fontSize = 9.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 28.dp), maxLines = 2)
            }
        }
    }
}

@Composable
private fun Key(label: String, onClick: () -> Unit) {
    Box(
        Modifier.size(29.dp).border(0.8.dp, Jarvis.cyanDim, CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Jarvis.text, fontSize = 13.sp, fontFamily = FontFamily.Monospace) }
}

fun ago(ms: Long): String {
    val s = ms / 1000
    return when {
        s < 10 -> "az önce"
        s < 60 -> "$s sn önce"
        s < 3600 -> "${s / 60} dk önce"
        s < 86400 -> "${s / 3600} sa önce"
        else -> "${s / 86400} gün önce"
    }
}

private fun clock(ts: Long): String = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(java.util.Date(ts))

/** Eşleşmiş: son nabız + ne zaman ölçüldü + son gönderim durumu. */
@Composable
fun MainScreen(s: UiState, now: Long, onSend: () -> Unit) {
    val hr = s.hr
    val age = if (s.hrTs > 0) (now - s.hrTs).coerceAtLeast(0) else null
    val fresh = age != null && age < 15 * 60_000
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Rings(0f, false)
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            StatusLine(s)
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    hr?.toString() ?: "--",
                    color = if (fresh) Jarvis.cyan else Jarvis.muted, fontSize = 46.sp, fontWeight = FontWeight.Light,
                    fontFamily = FontFamily.Monospace,
                )
                Text(" BPM", color = Jarvis.muted, fontSize = 10.sp, modifier = Modifier.padding(bottom = 9.dp))
            }
            Text(
                if (age == null) "henüz ölçüm yok" else "ölçüldü ${clock(s.hrTs)} · ${ago(age)}",
                color = if (fresh) Jarvis.text else Jarvis.muted, fontSize = 9.sp,
            )
            val sendLine = when {
                s.lastSendAt == 0L -> if (s.pending > 0) "${s.pending} örnek bekliyor" else "henüz gönderim yok"
                s.lastSendOk -> "gönderildi ${clock(s.lastSendAt)} · ${s.lastSendCount} örnek"
                else -> "gönderilemedi ${clock(s.lastSendAt)}" + if (s.pending > 0) " · ${s.pending} bekliyor" else ""
            }
            Text(sendLine, color = if (s.lastSendAt != 0L && !s.lastSendOk) Jarvis.ember else Jarvis.muted, fontSize = 9.sp)
            Spacer(Modifier.height(3.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Mini(s.steps?.toString() ?: "--", "adım")
                Mini(s.kcal?.toString() ?: "--", "kcal")
            }
            Spacer(Modifier.height(5.dp))
            PillButton("Şimdi gönder", onSend)
            s.linkMessage?.let { Text(it, color = Jarvis.ember, fontSize = 8.sp, maxLines = 1) }
            s.sensorNote?.let { Text(it, color = Jarvis.muted, fontSize = 8.sp, maxLines = 1) }
        }
    }
}

@Composable
private fun Mini(value: String, unit: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = Jarvis.text, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
        Text(unit, color = Jarvis.muted, fontSize = 8.sp)
    }
}
