import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CircleDot,
  Loader2,
  Mic,
  Save,
  Square,
  Video,
  Wifi,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  interviewQuestions as fallbackQuestions,
  generateJdFallbackQuestions,
} from '../data/questions';
import BehaviorMonitor from '../components/BehaviorMonitor';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

// Storage keys for persisting interview state and metrics in localStorage
const STORAGE_KEY = 'ai-interview-progress';
const DURATION_KEY = 'ai-interview-duration';
const INTERVIEW_ID_KEY = 'current-interview-id';
const INTERVIEW_SECONDS = 10 * 60; // 10 minutes total timer

// Helper to format remaining seconds into MM:SS display
function formatTime(seconds) {
  const safe = Math.max(seconds, 0);
  const minutes = String(Math.floor(safe / 60)).padStart(2, '0');
  const remainder = String(safe % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export default function Interview() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // -------------------------------------------------------------
  // BLOCK 1: Component References (Hardware & Streaming)
  // -------------------------------------------------------------
  // Video element reference for camera preview
  const videoRef = useRef(null);
  // WebRTC MediaStream reference (video + audio tracks)
  const streamRef = useRef(null);
  // Browser MediaRecorder instance for recording answers
  const mediaRecorderRef = useRef(null);
  // Array of data chunks captured during an active recording
  const chunksRef = useRef([]);
  // Pointer to the object URL created for temporary video preview
  const playbackUrlRef = useRef(null);
  // Holds the actual recorded video Blob for submission to backend
  const recordedBlobRef = useRef(null);
  // Holds latest eye contact & computer vision metrics from Harsha's monitor
  const visionMetricsRef = useRef(null);

  // -------------------------------------------------------------
  // BLOCK 2: Component State Management
  // -------------------------------------------------------------
  // Dynamic question list fetched from Gemini via FastAPI backend
  const [questions, setQuestions] = useState([]);
  // Current database interview session UUID
  const [interviewId, setInterviewId] = useState(null);
  // Active question index (0 to questions.length - 1)
  const [currentIndex, setCurrentIndex] = useState(0);
  // Array of candidate answers corresponding to each question
  const [responses, setResponses] = useState([]);
  // Countdown timer in seconds
  const [secondsLeft, setSecondsLeft] = useState(INTERVIEW_SECONDS);
  // Device readiness flags
  const [cameraReady, setCameraReady] = useState(false);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [networkReady, setNetworkReady] = useState(navigator.onLine);
  // Recording states
  const [recording, setRecording] = useState(false);
  const [recordingSaved, setRecordingSaved] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState('');
  // Loading and upload indicators
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [isLiveBackend, setIsLiveBackend] = useState(true);

  // -------------------------------------------------------------
  // BLOCK 3: Initialize Interview & Fetch AI Questions
  // -------------------------------------------------------------
  // Calls POST /api/interviews/start to create session and generate
  // 5 role-specific questions and ideal rubric embeddings using Gemini,
  // specifically tailored to the target role and custom job description.
  const targetRole = useMemo(
    () => localStorage.getItem('target-role-title') || 'Software Engineer',
    []
  );
  const targetJd = useMemo(
    () => localStorage.getItem('target-job-description') || '',
    []
  );

  useEffect(() => {
    let isMounted = true;

    async function initInterviewSession() {
      setLoadingQuestions(true);
      const activeRole = localStorage.getItem('target-role-title') || 'Software Engineer';
      const activeJd = localStorage.getItem('target-job-description') || '';

      try {
        // Attempt to create session via FastAPI backend with custom role & JD
        const sessionData = await api.startInterview(
          activeRole,
          user?.uid || null,
          activeJd || null
        );
        
        if (!isMounted) return;

        if (sessionData && sessionData.questions && sessionData.questions.length > 0) {
          const remoteQuestions = sessionData.questions;
          setQuestions(remoteQuestions);
          setInterviewId(sessionData.interview_id);
          setIsLiveBackend(true);
          localStorage.setItem(INTERVIEW_ID_KEY, sessionData.interview_id);

          setResponses(
            remoteQuestions.map((q, idx) => ({
              questionId: q.index || idx + 1,
              question: q.question,
              answer: '',
              completed: false,
            }))
          );
        } else {
          throw new Error('Invalid question format received from backend');
        }
      } catch (err) {
        console.warn('[INTERVIEW INIT] Backend not reachable, generating JD-tailored fallback questions:', err);
        if (!isMounted) return;

        setIsLiveBackend(false);

        // If the backend is temporarily offline, dynamically generate questions
        // tailored directly to the Job Description rather than static questions
        const dynamicFallback = activeJd
          ? generateJdFallbackQuestions(activeRole, activeJd)
          : fallbackQuestions.map((q) => ({
              index: q.id,
              question: q.text,
            }));

        setQuestions(dynamicFallback);
        setResponses(
          dynamicFallback.map((q) => ({
            questionId: q.index,
            question: q.question,
            answer: '',
            completed: false,
          }))
        );
      } finally {
        if (isMounted) setLoadingQuestions(false);
      }
    }

    initInterviewSession();

    return () => {
      isMounted = false;
    };
  }, [user]);

  // Current active question item (handles both dynamic and fallback format)
  const currentQuestion = useMemo(() => {
    if (!questions || questions.length === 0) return null;
    return questions[currentIndex] || null;
  }, [questions, currentIndex]);

  const currentQuestionText = currentQuestion ? (currentQuestion.question || currentQuestion.text) : '';
  const currentResponse = responses[currentIndex] || { answer: '' };
  const totalQuestions = questions.length || 5;
  const progress = totalQuestions > 0 ? ((currentIndex + 1) / totalQuestions) * 100 : 0;

  // -------------------------------------------------------------
  // BLOCK 4: Hardware & WebRTC Camera/Microphone Setup
  // -------------------------------------------------------------
  // Requests browser media permissions and links stream to video preview element.
  useEffect(() => {
    let isMounted = true;

    const startMedia = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Media capture is not supported by this browser.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setCameraReady(stream.getVideoTracks().length > 0);
        setMicrophoneReady(stream.getAudioTracks().length > 0);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      } catch (error) {
        if (isMounted) {
          setMediaError(error?.message || 'Camera and microphone access is required.');
        }
      }
    };

    startMedia();
    const updateNetwork = () => setNetworkReady(navigator.onLine);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);

    return () => {
      isMounted = false;
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

  // Ensure camera stream is attached immediately once the video DOM element mounts
  // (after question loading finishes)
  useEffect(() => {
    if (!loadingQuestions && videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      videoRef.current.play().catch(() => {});
    }
  }, [loadingQuestions, cameraReady]);

  // -------------------------------------------------------------
  // BLOCK 5: Timer & Progress Local Storage Synchronization
  // -------------------------------------------------------------
  // Runs 1-second countdown and saves interview text progress locally.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (responses.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentIndex, responses, secondsLeft }));
    }
  }, [currentIndex, responses, secondsLeft]);

  const answeredCount = useMemo(
    () => responses.filter((item) => item.answer && item.answer.trim()).length,
    [responses]
  );

  // -------------------------------------------------------------
  // BLOCK 6: User Input Handling & Saving
  // -------------------------------------------------------------
  const updateAnswer = (answer) => {
    setResponses((current) =>
      current.map((item, index) => (index === currentIndex ? { ...item, answer } : item))
    );
  };

  const saveCurrentResponse = () => {
    setResponses((current) =>
      current.map((item, index) =>
        index === currentIndex ? { ...item, completed: Boolean(item.answer.trim()) } : item
      )
    );
  };

  // -------------------------------------------------------------
  // BLOCK 7: Answer Recording Controls (MediaRecorder API)
  // -------------------------------------------------------------
  // Starts recording audio/video into memory buffers.
  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') {
      setMediaError('MediaRecorder is not supported in this browser.');
      return;
    }

    chunksRef.current = [];
    recordedBlobRef.current = null;
    setRecordingSaved(false);

    if (playbackUrlRef.current) {
      URL.revokeObjectURL(playbackUrlRef.current);
      playbackUrlRef.current = null;
      setPlaybackUrl('');
    }

    try {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        recordedBlobRef.current = blob; // Save blob for backend upload
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
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  // -------------------------------------------------------------
  // BLOCK 8: Navigation & Asynchronous Answer Submission
  // -------------------------------------------------------------
  // Submits the candidate's answer + video to the backend before
  // navigating to the next question or finishing the interview.
  const goPrevious = () => {
    saveCurrentResponse();
    setRecordingSaved(false);
    setCurrentIndex((index) => Math.max(0, index - 1));
  };

  const goNext = async () => {
    saveCurrentResponse();
    if (recording) {
      stopRecording();
    }

    const qIdx = currentQuestion?.index || currentIndex + 1;
    const qText = currentQuestionText;
    const ansText = currentResponse.answer || '';
    const videoBlob = recordedBlobRef.current;

    // Send answer and video to backend if an active interviewId exists
    if (interviewId) {
      try {
        setSubmittingAnswer(true);
        await api.submitAnswer(interviewId, {
          questionIndex: qIdx,
          questionText: qText,
          candidateAnswer: ansText,
          videoBlob: videoBlob,
        });
      } catch (uploadErr) {
        console.warn('[SUBMIT ANSWER WARNING] Could not sync with backend:', uploadErr);
      } finally {
        setSubmittingAnswer(false);
      }
    }

    // Reset recording buffer for the next question
    recordedBlobRef.current = null;
    setRecordingSaved(false);
    if (playbackUrlRef.current) {
      URL.revokeObjectURL(playbackUrlRef.current);
      playbackUrlRef.current = null;
      setPlaybackUrl('');
    }

    // Check if this was the final question
    if (currentIndex >= totalQuestions - 1) {
      const finalResponses = responses.map((item, index) =>
        index === currentIndex ? { ...item, completed: Boolean(item.answer.trim()) } : item
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentIndex, responses: finalResponses, secondsLeft }));
      localStorage.setItem(DURATION_KEY, String(INTERVIEW_SECONDS - secondsLeft));
      localStorage.setItem(
        'ai-interview-vision-metrics',
        JSON.stringify(visionMetricsRef.current || { eyeContact: 75 })
      );

      // Stop camera tracks before switching routes
      streamRef.current?.getTracks().forEach((track) => track.stop());
      navigate('/interview-complete');
      return;
    }

    // Move to next question
    setCurrentIndex((index) => index + 1);
  };

  // -------------------------------------------------------------
  // BLOCK 9: Render Loading Skeleton State
  // -------------------------------------------------------------
  if (loadingQuestions) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center text-center">
        <Loader2 className="h-12 w-12 animate-spin text-tealish-600" />
        <h2 className="mt-6 text-2xl font-bold text-slate-900">Preparing Your AI Interview</h2>
        <p className="mt-2 text-slate-500">
          Google Gemini is analyzing the {targetRole} job requirements and generating tailored technical interview questions...
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------
  // BLOCK 10: Render Main Interview Interface
  // -------------------------------------------------------------
  return (
    <div className="mx-auto max-w-[1500px]">
      {/* Top Banner & Progress Bar */}
      <section className="card mb-6 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-tealish-600">
                AI Interview · {targetRole}
              </p>
              {targetJd && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                  <Sparkles className="h-3 w-3" /> Tailored to Job Description
                </span>
              )}
            </div>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              Question {currentIndex + 1} of {totalQuestions}
            </h1>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-navy-50 px-4 py-3 text-navy-900">
            <CircleDot className="h-4 w-4" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Interview Timer</p>
              <p className="font-mono text-lg font-bold">{formatTime(secondsLeft)}</p>
            </div>
          </div>
        </div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-tealish-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Offline notice if backend could not be reached */}
        {!isLiveBackend && (
          <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
            <p>
              <strong>Offline Mode:</strong> Backend server at{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">http://localhost:8000</code> is
              unreachable. Questions were generated locally using your Job Description keywords. Run{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">python backend/main.py</code> to
              enable live Gemini RAG evaluation.
            </p>
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        {/* Left Column: Question, Video Recorder & Transcript */}
        <section className="space-y-6">
          <article className="card p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy-50 text-sm font-bold text-navy-800">
                {currentIndex + 1}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Current Question</p>
                <h2 className="mt-2 text-xl font-bold leading-8 text-slate-900 sm:text-2xl">
                  {currentQuestionText}
                </h2>
              </div>
            </div>

            {/* Video Preview Box */}
            <div className="relative mt-6 aspect-video overflow-hidden rounded-2xl bg-slate-950">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              {!cameraReady && (
                <div className="absolute inset-0 grid place-items-center text-center text-slate-300">
                  <div>
                    <Camera className="mx-auto h-8 w-8" />
                    <p className="mt-3 text-sm">Camera preview unavailable</p>
                  </div>
                </div>
              )}
              <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-slate-950/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                <span className={`h-2.5 w-2.5 rounded-full bg-rose-500 ${recording ? 'animate-pulse' : ''}`} />
                {recording ? 'Recording Answer...' : 'Camera Active'}
              </div>
              <div className="absolute bottom-4 right-4 rounded-lg bg-slate-950/70 px-3 py-1.5 font-mono text-xs text-white backdrop-blur">
                {formatTime(secondsLeft)}
              </div>
            </div>

            {mediaError && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {mediaError}
              </div>
            )}

            {/* Answer Recording Buttons */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {!recording ? (
                <button
                  onClick={startRecording}
                  disabled={!cameraReady || !microphoneReady}
                  className="primary-btn"
                >
                  <Video className="h-4 w-4" /> Start Answer Recording
                </button>
              ) : (
                <button
                  onClick={stopRecording}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-700"
                >
                  <Square className="h-4 w-4 fill-current" /> Stop Answer
                </button>
              )}
              {recording && (
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-rose-600">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
                  Recording Video & Audio...
                </span>
              )}
              {recordingSaved && !recording && (
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
                  <Check className="h-4 w-4" />
                  Answer Video Recorded & Ready
                </span>
              )}
            </div>

            {/* Temporary Playback Preview */}
            {playbackUrl && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recorded Answer Preview</p>
                <video controls src={playbackUrl} className="max-h-52 w-full rounded-lg bg-black" />
              </div>
            )}
          </article>

          {/* Transcript / Text Answer Box */}
          <article className="card p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-bold text-slate-900">Transcript / Answer Response</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Type or review your response. Your answer will be evaluated against ideal rubric points via RAG.
                </p>
              </div>
              <span className="text-xs font-medium text-slate-400">{currentResponse.answer.length} chars</span>
            </div>
            <textarea
              rows="6"
              value={currentResponse.answer}
              onChange={(e) => updateAnswer(e.target.value)}
              className="input-field mt-5 resize-y leading-6"
              placeholder="Explain your approach, technical concepts, architecture, and relevant trade-offs here..."
            />
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                onClick={goPrevious}
                disabled={currentIndex === 0 || submittingAnswer}
                className="secondary-btn"
              >
                <ArrowLeft className="h-4 w-4" /> Previous
              </button>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={saveCurrentResponse}
                  disabled={submittingAnswer}
                  className="secondary-btn"
                >
                  <Save className="h-4 w-4" /> Save Draft
                </button>
                <button
                  onClick={goNext}
                  disabled={submittingAnswer}
                  className="primary-btn"
                >
                  {submittingAnswer ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                    </>
                  ) : currentIndex === totalQuestions - 1 ? (
                    <>
                      Finish Interview <ArrowRight className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      Next Question <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </article>
        </section>

        {/* Right Aside: Computer Vision Behavior Monitor & Live Status */}
        <aside className="space-y-5">
          <BehaviorMonitor
            videoRef={videoRef}
            active={cameraReady}
            onMetricsChange={(nextMetrics) => {
              visionMetricsRef.current = nextMetrics;
            }}
          />
          <div className="card p-5 xl:sticky xl:top-28">
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-700">Live Status</h2>
            <div className="mt-5 space-y-3">
              {[
                { icon: Camera, label: 'Camera', value: cameraReady ? 'Active' : 'Unavailable', ok: cameraReady },
                { icon: Mic, label: 'Microphone', value: microphoneReady ? 'Active' : 'Unavailable', ok: microphoneReady },
                { icon: CircleDot, label: 'Eye Tracking', value: cameraReady ? 'Tracking Active' : 'Waiting', ok: cameraReady },
                { icon: Wifi, label: 'Network', value: networkReady ? 'Online' : 'Offline', ok: networkReady },
              ].map(({ icon: Icon, label, value, ok }) => (
                <div key={label} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                  <div className="rounded-lg bg-slate-50 p-2 text-slate-600">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">{label}</p>
                    <p className={`text-xs ${ok ? 'text-emerald-600' : 'text-amber-600'}`}>{value}</p>
                  </div>
                  <span className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-xl bg-slate-50 p-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Completed</span>
                <span>
                  {answeredCount}/{totalQuestions}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-navy-700 transition-all duration-300"
                  style={{ width: `${(answeredCount / totalQuestions) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
