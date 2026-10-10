// -------------------------------------------------------------
// Audio-only recording of one answer (for speech-to-text)
// -------------------------------------------------------------
// Small uploads: Opus audio instead of the full video. Returns null when
// the browser cannot record audio.
//
// const recording = startAnswerRecording(stream);
// const blob = await recording.stop();

const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

export function startAnswerRecording(stream) {
  const audioTracks = stream?.getAudioTracks?.() || [];
  if (!audioTracks.length || typeof MediaRecorder === 'undefined') return null;
  const mimeType = AUDIO_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type));
  let recorder;
  try {
    recorder = new MediaRecorder(new MediaStream(audioTracks), mimeType ? { mimeType } : undefined);
  } catch {
    return null;
  }
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data?.size > 0) chunks.push(event.data);
  };
  recorder.start();

  return {
    stop() {
      return new Promise((resolve) => {
        if (recorder.state === 'inactive') {
          resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }) : null);
          return;
        }
        recorder.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }) : null);
        recorder.stop();
      });
    },
    cancel() {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
}
