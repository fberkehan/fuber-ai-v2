package ai.fuber.watch

import ai.fuber.watch.net.Link
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Arayüzün gözlediği tek durum nesnesi (pasif servis ve gönderici yazar, Compose okur). */
data class UiState(
    val link: Link = Link.IDLE,
    val paired: Boolean = false,
    val pcName: String? = null,
    val linkMessage: String? = null,
    val hr: Int? = null,
    val hrAcc: String? = null,
    /** Nabzın ÖLÇÜLDÜĞÜ an (ms epoch); 0 = hiç ölçüm yok. */
    val hrTs: Long = 0,
    val steps: Int? = null,
    val kcal: Int? = null,
    val pending: Int = 0,
    val lastSendAt: Long = 0,
    val lastSendOk: Boolean = false,
    val lastSendCount: Int = 0,
    val sensorNote: String? = null,
)

object WatchRuntime {
    private val _state = MutableStateFlow(UiState())
    val state = _state.asStateFlow()
    fun update(f: (UiState) -> UiState) {
        while (true) {
            val prev = _state.value
            if (_state.compareAndSet(prev, f(prev))) return
        }
    }
}
