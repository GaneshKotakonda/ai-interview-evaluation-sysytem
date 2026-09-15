import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CircleDot,
  Mic,
  Save,
  Square,
  Video,
  Wifi,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { interviewQuestions } from '../data/questions';

const STORAGE_KEY = 'ai-interview-progress';
const DURATION_KEY = 'ai-interview-duration';
const INTERVIEW_SECONDS = 10 * 60;

function createInitialResponses() {
  return interviewQuestions.map((question) => ({
    questionId: question.id,
    question: question.text,
    answer: '',
    completed: false,
  }));
}


function readSavedProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      currentIndex: Number.isInteger(saved.currentIndex)
        ? Math.min(Math.max(saved.currentIndex, 0), interviewQuestions.length - 1)
        : 0,
      responses:
        Array.isArray(saved.responses) && saved.responses.length === interviewQuestions.length
          ? saved.responses
          : createInitialResponses(),
      secondsLeft: Number.isFinite(saved.secondsLeft) ? saved.secondsLeft : INTERVIEW_SECONDS,
    };
  } catch {
    return {
      currentIndex: 0,
      responses: createInitialResponses(),
      secondsLeft: INTERVIEW_SECONDS,
    };
  }
}

function formatTime(seconds) {
  const safe = Math.max(seconds, 0);
  const minutes = String(Math.floor(safe / 60)).padStart(2, '0');
  const remainder = String(safe % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export default function Interview() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const playbackUrlRef = useRef(null);
  const savedProgressRef = useRef(readSavedProgress());
  const [currentIndex, setCurrentIndex] = useState(savedProgressRef.current.currentIndex);
  const [responses, setResponses] = useState(savedProgressRef.current.responses);
  const [secondsLeft, setSecondsLeft] = useState(savedProgressRef.current.secondsLeft);
  const [cameraReady, setCameraReady] = useState(false);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordingSaved, setRecordingSaved] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [networkReady, setNetworkReady] = useState(navigator.onLine);

  const currentQuestion = interviewQuestions[currentIndex];
  const currentResponse = responses[currentIndex];
  const progress = ((currentIndex + 1) / interviewQuestions.length) * 100;

  useEffect(() => {
    const startMedia = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Media capture is not supported by this browser.');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = stream;
        setCameraReady(stream.getVideoTracks().length > 0);
        setMicrophoneReady(stream.getAudioTracks().length > 0);
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (error) {
        setMediaError(error?.message || 'Camera and microphone access is required.');
      }
    };

    startMedia();
    const updateNetwork = () => setNetworkReady(navigator.onLine);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);

    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === 'recording') {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentIndex, responses, secondsLeft }));
  }, [currentIndex, responses, secondsLeft]);

  const answeredCount = useMemo(() => responses.filter((item) => item.answer.trim()).length, [responses]);

  const updateAnswer = (answer) => {
    setResponses((current) => current.map((item, index) => index === currentIndex ? { ...item, answer } : item));
  };

  const saveCurrentResponse = () => {
    setResponses((current) => current.map((item, index) => index === currentIndex ? { ...item, completed: Boolean(item.answer.trim()) } : item));
  };

  const goPrevious = () => {
    saveCurrentResponse();
    setRecordingSaved(false);
    setCurrentIndex((index) => Math.max(0, index - 1));
  };

  const goNext = () => {
    saveCurrentResponse();
    setRecordingSaved(false);
    if (currentIndex === interviewQuestions.length - 1) {
      const finalResponses = responses.map((item, index) => index === currentIndex ? { ...item, completed: Boolean(item.answer.trim()) } : item);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentIndex, responses: finalResponses, secondsLeft }));
      localStorage.setItem(DURATION_KEY, String(INTERVIEW_SECONDS - secondsLeft));
      streamRef.current?.getTracks().forEach((track) => track.stop());
      navigate('/interview-complete');
      return;
    }
    setCurrentIndex((index) => index + 1);
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') {
      setMediaError('MediaRecorder is not supported in this browser.');
      return;
    }

    chunksRef.current = [];
    setRecordingSaved(false);
    if (playbackUrlRef.current) {
      URL.revokeObjectURL(playbackUrlRef.current);
      playbackUrlRef.current = null;
      setPlaybackUrl('');
    }

    try {
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        playbackUrlRef.current = url;
        setPlaybackUrl(url);
        setRecordingSaved(true);
        setRecording(false);
      };
      recorder.start();
      setRecording(true);
    } catch (error) {
      setMediaError(error?.message || 'Unable to start recording.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      <section className="card mb-6 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-tealish-600">AI Interview</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Question {currentIndex + 1} of {interviewQuestions.length}</h1>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-navy-50 px-4 py-3 text-navy-900">
            <CircleDot className="h-4 w-4" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Interview Timer</p>
              <p className="font-mono text-lg font-bold">{formatTime(secondsLeft)}</p>
            </div>
          </div>
        </div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-tealish-500 transition-all" style={{ width: `${progress}%` }} /></div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <section className="space-y-6">
          <article className="card p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy-50 text-sm font-bold text-navy-800">{currentIndex + 1}</div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Current Question</p>
                <h2 className="mt-2 text-xl font-bold leading-8 text-slate-900 sm:text-2xl">{currentQuestion.text}</h2>
              </div>
            </div>

            <div className="relative mt-6 aspect-video overflow-hidden rounded-2xl bg-slate-950">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              {!cameraReady && <div className="absolute inset-0 grid place-items-center text-center text-slate-300"><div><Camera className="mx-auto h-8 w-8" /><p className="mt-3 text-sm">Camera preview unavailable</p></div></div>}
              <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-slate-950/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                <span className={`h-2.5 w-2.5 rounded-full bg-rose-500 ${recording ? 'animate-pulse' : ''}`} />
                {recording ? 'Recording...' : 'Ready'}
              </div>
              <div className="absolute bottom-4 right-4 rounded-lg bg-slate-950/70 px-3 py-1.5 font-mono text-xs text-white backdrop-blur">{formatTime(secondsLeft)}</div>
            </div>

            {mediaError && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{mediaError}</div>}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {!recording ? (
                <button onClick={startRecording} disabled={!cameraReady || !microphoneReady} className="primary-btn">
                  <Video className="h-4 w-4" /> Start Answer
                </button>
              ) : (
                <button onClick={stopRecording} className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-700">
                  <Square className="h-4 w-4 fill-current" /> Stop Answer
                </button>
              )}
              {recording && <span className="inline-flex items-center gap-2 text-sm font-semibold text-rose-600"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />Recording...</span>}
              {recordingSaved && !recording && <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700"><Check className="h-4 w-4" />Response Recorded Successfully</span>}
            </div>

            {playbackUrl && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Temporary Preview</p>
                <video controls src={playbackUrl} className="max-h-52 w-full rounded-lg bg-black" />
              </div>
            )}
          </article>

          <article className="card p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-bold text-slate-900">Transcript / Answer</h2>
                <p className="mt-1 text-sm text-slate-500">Manual input for this prototype; replaceable by speech-to-text later.</p>
              </div>
              <span className="text-xs font-medium text-slate-400">{currentResponse.answer.length} chars</span>
            </div>
            <textarea
              rows="7"
              value={currentResponse.answer}
              onChange={(e) => updateAnswer(e.target.value)}
              className="input-field mt-5 resize-y leading-6"
              placeholder="Your spoken answer will appear here when speech-to-text integration is connected..."
            />
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button onClick={goPrevious} disabled={currentIndex === 0} className="secondary-btn"><ArrowLeft className="h-4 w-4" /> Previous</button>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button onClick={saveCurrentResponse} className="secondary-btn"><Save className="h-4 w-4" /> Save Response</button>
                <button onClick={goNext} className="primary-btn">
                  {currentIndex === interviewQuestions.length - 1 ? 'Finish Interview' : 'Next Question'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </article>
        </section>

        <aside className="space-y-5">
          <div className="card p-5 xl:sticky xl:top-28">
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-700">Live Indicators</h2>
            <div className="mt-5 space-y-3">
              {[
                { icon: Camera, label: 'Camera', value: cameraReady ? 'Active' : 'Unavailable', ok: cameraReady },
                { icon: Mic, label: 'Microphone', value: microphoneReady ? 'Active' : 'Unavailable', ok: microphoneReady },
                { icon: CircleDot, label: 'Face', value: cameraReady ? 'Detected · Demo' : 'Waiting', ok: cameraReady },
                { icon: Wifi, label: 'Network', value: networkReady ? 'Stable' : 'Offline', ok: networkReady },
              ].map(({ icon: Icon, label, value, ok }) => (
                <div key={label} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                  <div className="rounded-lg bg-slate-50 p-2 text-slate-600"><Icon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">{label}</p><p className={`text-xs ${ok ? 'text-emerald-600' : 'text-amber-600'}`}>{value}</p></div>
                  <span className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-xl bg-slate-50 p-4">
              <div className="flex items-center justify-between text-xs text-slate-500"><span>Answered</span><span>{answeredCount}/{interviewQuestions.length}</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-navy-700" style={{ width: `${(answeredCount / interviewQuestions.length) * 100}%` }} /></div>
            </div>

            <p className="mt-4 text-xs leading-5 text-slate-400">Face detection is a demo status only. No facial analysis model is running in this prototype.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
