import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Camera,
  Check,
  Clock3,
  Square,
  Video,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BehaviorMonitor from '../components/BehaviorMonitor';
import {
  Badge, FlowSteps, Notice, Panel, SectionTitle, Skeleton, Spinner,
} from '../components/ui';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { STORAGE_KEYS, clearInterviewProgress } from '../utils/interviewJourney';

// Storage keys for persisting interview state and metrics in localStorage
const STORAGE_KEY = STORAGE_KEYS.progress;
const DURATION_KEY = STORAGE_KEYS.duration;
const INTERVIEW_ID_KEY = STORAGE_KEYS.interviewId;
const INTERVIEW_SECONDS = 10 * 60; // 10-minute guide timer (informational; it does not end the interview)

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
  // One public question issued by the adaptive backend
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [maxTurns, setMaxTurns] = useState(1);
  // Current database interview session UUID
  const [interviewId, setInterviewId] = useState(null);

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
  const [phase, setPhase] = useState('answering');
  const [flowError, setFlowError] = useState('');
  const [startAttempt, setStartAttempt] = useState(0);
  const busyRef = useRef(false);
  const responseIdRef = useRef(null);
  const startRequestRef = useRef(null);
  const recordingFinishedRef = useRef(null);
  const resolveRecordingRef = useRef(null);

  // -------------------------------------------------------------
  // BLOCK 3: Initialize Interview & Fetch AI Questions
  // -------------------------------------------------------------
  // Calls POST /api/interviews/start to create session and generate
  // the first role-specific question using Gemini,
  // specifically tailored to the target role and custom job description.
  const targetRole = useMemo(
    () => localStorage.getItem(STORAGE_KEYS.roleTitle) || 'Software Engineer',
    []
  );
  const targetJd = useMemo(
    () => localStorage.getItem(STORAGE_KEYS.jobDescription) || '',
    []
  );

  useEffect(() => {
    let isMounted = true;

    async function initInterviewSession() {
      setLoadingQuestions(true);
      const activeRole = localStorage.getItem(STORAGE_KEYS.roleTitle) || 'Software Engineer';
      const activeJd = localStorage.getItem(STORAGE_KEYS.jobDescription) || '';

      try {
        // Share the start request across StrictMode effect replays.
        if (!startRequestRef.current) {
          startRequestRef.current = api.startInterview(
            activeRole, user?.uid || null, activeJd || null,
            user?.email || null, user?.displayName || null,
          );
        }
        const sessionData = await startRequestRef.current;
        if (!isMounted) return;
        if (!sessionData?.question?.question || !sessionData.interview_id) {
          throw new Error('Invalid interview session');
        }
        setCurrentQuestion(sessionData.question);
        setCurrentTurn(sessionData.current_turn);
        setMaxTurns(sessionData.max_turns);
        setInterviewId(sessionData.interview_id);
        setResponses([{ ...sessionData.question, questionId: sessionData.question.index, answer: '', completed: false }]);
        // A new session starts clean: forget the previous interview's data.
        localStorage.setItem(INTERVIEW_ID_KEY, sessionData.interview_id);
        localStorage.removeItem(STORAGE_KEYS.latestReport);
        clearInterviewProgress();
        setFlowError('');
      } catch (err) {
        if (!isMounted) return;
        startRequestRef.current = null;
        setFlowError('Unable to start your interview. Please check your connection and retry.');
      } finally {
        if (isMounted) setLoadingQuestions(false);
      }
    }

    initInterviewSession();

    return () => {
      isMounted = false;
    };
  }, [user?.uid, startAttempt]);

  const currentIndex = responses.length - 1;
  const currentQuestionText = currentQuestion?.question || '';
  const currentResponse = responses[currentIndex] || { answer: '' };
  const totalQuestions = maxTurns;
  const progress = (currentTurn / maxTurns) * 100;
  const busy = ['recording', 'submitting', 'advancing', 'complete'].includes(phase);
  const answerLocked = busy || currentResponse.completed;

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
  // Runs the 1-second countdown, and saves turn progress locally whenever the
  // turns change (the Report page reads it). The timer value is deliberately
  // not part of the saved state, so storage is not rewritten every second.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (responses.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ interviewId, currentIndex, current_turn: currentTurn, max_turns: maxTurns, responses }));
    }
  }, [interviewId, currentIndex, currentTurn, maxTurns, responses]);

  const answeredCount = useMemo(
    () => responses.filter((item) => item.completed).length,
    [responses]
  );

  // -------------------------------------------------------------
  // BLOCK 6: User Input Handling & Saving
  // -------------------------------------------------------------
  const updateAnswer = (answer) => {
    if (answerLocked || busyRef.current) return;
    setResponses((current) =>
      current.map((item, index) => (index === currentIndex ? { ...item, answer } : item))
    );
  };

  // -------------------------------------------------------------
  // BLOCK 7: Answer Recording Controls (MediaRecorder API)
  // -------------------------------------------------------------
  // Starts recording audio/video into memory buffers.
  const startRecording = () => {
    if (answerLocked || busyRef.current) return;
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

      recordingFinishedRef.current = new Promise((resolve) => { resolveRecordingRef.current = resolve; });
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        recordedBlobRef.current = blob; // Save blob for backend upload
        const url = URL.createObjectURL(blob);
        playbackUrlRef.current = url;
        setPlaybackUrl(url);
        setRecordingSaved(true);
        setRecording(false);
        resolveRecordingRef.current?.();
        resolveRecordingRef.current = null;
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
  const goNext = async () => {
    if (busyRef.current || phase === 'complete' || !interviewId) return;
    if (!responseIdRef.current && !currentResponse.answer.trim()) return;
    busyRef.current = true;
    setFlowError('');
    let savedResponses = responses;
    try {
      if (!responseIdRef.current) {
        // onstop follows the final dataavailable event. Wait before reading the Blob.
        if (recordingFinishedRef.current) {
          setPhase('recording');
          stopRecording();
          await recordingFinishedRef.current;
        }
        setPhase('submitting');
        const result = await api.submitAnswer(interviewId, {
          questionIndex: currentQuestion.index,
          questionText: currentQuestionText,
          candidateAnswer: currentResponse.answer,
          videoBlob: recordedBlobRef.current,
        });
        if (!result?.response_id) throw new Error('Missing response identifier');
        responseIdRef.current = result.response_id;
        savedResponses = responses.map((item, index) => index === currentIndex
          ? { ...item, completed: true, response_id: result.response_id, evaluation: result.evaluation }
          : item);
        setResponses(savedResponses);
      }
      setPhase('advancing');
      const result = await api.nextQuestion(interviewId, responseIdRef.current);
      if (!result.is_complete && !result.next_question?.question) {
        throw new Error('Missing next question');
      }
      savedResponses = savedResponses.map((item, index) => index === currentIndex
        ? { ...item, evaluation: result.evaluation || item.evaluation, adaptation: result.adaptation }
        : item);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        interviewId, currentIndex, current_turn: result.current_turn, max_turns: result.max_turns,
        responses: savedResponses,
      }));

      // Release per-answer recording only after advancement succeeds.
      recordedBlobRef.current = null;
      recordingFinishedRef.current = null;
      setRecordingSaved(false);
      if (playbackUrlRef.current) {
        URL.revokeObjectURL(playbackUrlRef.current);
        playbackUrlRef.current = null;
        setPlaybackUrl('');
      }
      if (result.is_complete) {
        setResponses(savedResponses);
        setPhase('complete');
        localStorage.setItem(DURATION_KEY, String(INTERVIEW_SECONDS - secondsLeft));
        // Only real camera measurements are saved. When the vision model never
        // produced data, nothing is stored and the report omits the camera score
        // instead of showing an invented value.
        if (visionMetricsRef.current) {
          localStorage.setItem(STORAGE_KEYS.visionMetrics, JSON.stringify(visionMetricsRef.current));
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        navigate('/interview-complete');
        return;
      }
      responseIdRef.current = null;
      setCurrentQuestion(result.next_question);
      setCurrentTurn(result.current_turn);
      setMaxTurns(result.max_turns);
      setResponses([...savedResponses, { ...result.next_question, questionId: result.next_question.index, answer: '', completed: false }]);
      setPhase('answering');
    } catch (error) {
      const accepted = Boolean(responseIdRef.current);
      setPhase(accepted ? 'advance-error' : 'submit-error');
      setFlowError(accepted
        ? 'Your answer is saved. Retry to prepare the next question; your answer will not be submitted again.'
        : 'Your answer could not be submitted. Your text and recording are retained. Please retry.');
    } finally {
      busyRef.current = false;
    }
  };

  // -------------------------------------------------------------
  // BLOCK 9: Render Loading Skeleton State
  // -------------------------------------------------------------
  if (loadingQuestions) {
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <FlowSteps current={1} />
        <Panel className="p-8 sm:p-10">
          <div className="flex items-center gap-2 text-[13px] text-ink-3">
            <Spinner /> Preparing your interview
          </div>
          <h2 className="mt-4 font-serif text-3xl leading-tight text-ink">Writing your first question for {targetRole}…</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">
            Gemini is reading the role requirements. The first question starts at medium difficulty and later questions adapt to your answers.
          </p>
          <div className="mt-8 space-y-3">
            <Skeleton className="h-5 w-11/12" />
            <Skeleton className="h-5 w-8/12" />
          </div>
        </Panel>
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <Panel className="mx-auto max-w-xl p-6">
        <p role="alert" className="text-sm text-ink-2">{flowError}</p>
        <button className="primary-btn mt-4" onClick={() => setStartAttempt((value) => value + 1)}>Retry Start</button>
      </Panel>
    );
  }

  // -------------------------------------------------------------
  // BLOCK 10: Render Main Interview Interface
  // -------------------------------------------------------------
  const phaseMessage = phase === 'recording' ? 'Finishing your recording…'
    : phase === 'submitting' ? 'Analyzing your response…'
    : phase === 'advancing' ? 'Preparing the next question…' : '';
  const liveStatus = [
    { label: 'Camera', value: cameraReady ? 'Active' : 'Unavailable', ok: cameraReady },
    { label: 'Microphone', value: microphoneReady ? 'Active' : 'Unavailable', ok: microphoneReady },
    { label: 'Eye Tracking', value: cameraReady ? 'Tracking' : 'Waiting', ok: cameraReady },
    { label: 'Network', value: networkReady ? 'Online' : 'Offline', ok: networkReady },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header: role, question counter, timer and segmented progress */}
      <header className="reveal space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
              <span>{targetRole}</span>
              {targetJd && <Badge tone="ink">Tailored to JD</Badge>}
            </div>
            <h1 className="mt-1 font-serif text-[2.1rem] tracking-[-0.02em] leading-none text-ink">
              Question {currentTurn} of {maxTurns}
            </h1>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-line bg-surface px-3.5 py-1.5 sm:self-auto">
            <Clock3 className="h-3.5 w-3.5 text-ink-3" />
            <span className="sr-only">Interview Timer</span>
            <span className="num font-mono text-sm text-ink">{formatTime(secondsLeft)}</span>
          </div>
        </div>
        <div
          role="progressbar"
          aria-label="Interview progress"
          aria-valuemin={0}
          aria-valuemax={maxTurns}
          aria-valuenow={currentTurn}
          className="flex gap-1.5"
        >
          {Array.from({ length: maxTurns }, (_, index) => {
            const turn = index + 1;
            const state = turn < currentTurn || (turn === currentTurn && currentResponse.completed) ? 'done'
              : turn === currentTurn ? 'active' : 'todo';
            return (
              <span key={turn} className="relative h-1 flex-1 overflow-hidden rounded-full bg-line">
                {state !== 'todo' && (
                  <span className={`grow-x absolute inset-0 rounded-full ${state === 'done' ? 'bg-ink' : 'bg-ink/35'}`} />
                )}
              </span>
            );
          })}
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Question and answer */}
        <section className="space-y-5">
          <Panel i={1} as="article" key={`question-${currentTurn}`} className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="num font-mono text-ink-3">Q{currentTurn}</span>
              <span className="text-ink-4">·</span>
              <Badge>{currentQuestion.difficulty?.replace(/^./, (c) => c.toUpperCase())}</Badge>
              {currentQuestion.is_follow_up && <Badge tone="ink">AI Follow-up</Badge>}
              {currentQuestion.topic && <span className="text-ink-3">{currentQuestion.topic}</span>}
            </div>
            <h2 className="mt-4 font-serif text-[1.5rem] leading-snug text-ink sm:text-[1.75rem]">
              {currentQuestionText}
            </h2>
          </Panel>

          <Panel i={2} as="article" className="p-6 sm:p-7">
            <SectionTitle
              title="Your answer"
              description="Type or review your response. It is scored against the question's private rubric."
              action={<span className="num font-mono text-xs text-ink-4">{currentResponse.answer.length} chars</span>}
            />
            <textarea
              aria-label="Your answer"
              disabled={answerLocked}
              rows="9"
              value={currentResponse.answer}
              onChange={(e) => updateAnswer(e.target.value)}
              className="input-field mt-5 resize-y !text-[15px] leading-relaxed"
              placeholder="Explain your approach, the concepts involved and the trade-offs you would weigh…"
            />
            {flowError && <Notice tone="warn" role="alert" className="mt-4">{flowError}</Notice>}
            {currentResponse.completed && <p className="mt-3 text-[13px] text-ink-3">Answer submitted. This response is now read-only.</p>}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p role="status" className="flex items-center gap-2 text-[13px] text-ink-2">
                {phaseMessage && <Spinner className="h-3.5 w-3.5" />}
                {phaseMessage}
              </p>
              <button onClick={goNext} disabled={busy || (!currentResponse.completed && !currentResponse.answer.trim())} className="primary-btn">
                {busy ? <><Spinner /> Please wait</>
                  : phase === 'advance-error' ? 'Retry Next Question'
                  : phase === 'submit-error' ? 'Retry Submission'
                  : <>Submit Answer <ArrowRight className="h-4 w-4" /></>}
              </button>
            </div>
          </Panel>
        </section>

        {/* Camera, recording, engagement and status */}
        <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
          <Panel i={3} className="overflow-hidden">
            <div className="relative aspect-video bg-ink">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              {!cameraReady && (
                <div className="absolute inset-0 grid place-items-center text-center text-paper/60">
                  <div>
                    <Camera className="mx-auto h-6 w-6" strokeWidth={1.5} />
                    <p className="mt-2 text-[13px]">Camera preview unavailable</p>
                  </div>
                </div>
              )}
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-ink/60 px-2.5 py-1 text-[11px] font-medium text-paper backdrop-blur">
                <span className={`h-2 w-2 rounded-full ${recording ? 'pulse-dot bg-[#e0796d]' : 'bg-paper/60'}`} />
                {recording ? 'Recording' : 'Camera on'}
              </div>
            </div>
            <div className="space-y-3 p-4">
              {!recording ? (
                <button
                  onClick={startRecording}
                  disabled={!cameraReady || !microphoneReady || answerLocked}
                  className="secondary-btn w-full"
                >
                  <Video className="h-4 w-4" /> Start Answer Recording
                </button>
              ) : (
                <button onClick={stopRecording} className="danger-btn w-full">
                  <Square className="h-3.5 w-3.5 fill-current" /> Stop Answer
                </button>
              )}
              {recording && (
                <p className="flex items-center gap-2 text-xs text-bad">
                  <span className="pulse-dot h-2 w-2 rounded-full bg-bad" /> Recording video and audio…
                </p>
              )}
              {recordingSaved && !recording && (
                <p className="fade-in flex items-center gap-2 text-xs text-ok">
                  <Check className="h-3.5 w-3.5" /> Answer video recorded and ready
                </p>
              )}
              {playbackUrl && (
                <video controls src={playbackUrl} className="fade-in max-h-44 w-full rounded-control bg-ink" />
              )}
              {mediaError && <Notice tone="warn">{mediaError}</Notice>}
            </div>
          </Panel>

          <BehaviorMonitor
            videoRef={videoRef}
            active={cameraReady}
            onMetricsChange={(nextMetrics) => {
              visionMetricsRef.current = nextMetrics;
            }}
          />

          <Panel i={5} className="p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold text-ink">Live status</h2>
              <span className="num font-mono text-xs text-ink-3">{answeredCount}/{totalQuestions} answered</span>
            </div>
            <ul className="mt-3 divide-y divide-line">
              {liveStatus.map(({ label, value, ok }) => (
                <li key={label} className="flex items-center justify-between py-2.5 text-[13px]">
                  <span className="text-ink-2">{label}</span>
                  <span className={`flex items-center gap-2 ${ok ? 'text-ink' : 'text-warn'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-ok' : 'bg-warn'}`} />
                    {value}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
