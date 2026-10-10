import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Code2, Mic, Minus, Play, Plus,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ProgressBar from '../components/ProgressBar';
import {
  Badge, CountUp, EmptyState, LoadingBlock, Notice, PageHeader, Panel, SectionTitle, Spinner,
} from '../components/ui';
import { api } from '../services/api';
import { STORAGE_KEYS, readInterviewJourney } from '../utils/interviewJourney';

// -------------------------------------------------------------
// BLOCK 1: Helpers
// -------------------------------------------------------------
const capitalize = (text) => (text ? text.replace(/^./, (character) => character.toUpperCase()) : '');

// Normalise both report shapes into [{ label, value }]: the /complete and
// /report responses carry `scores`; very old cached reports only have the
// raw columns. Components without data are dropped rather than shown as 0.
function scoreList(report) {
  const scores = Array.isArray(report.scores)
    ? report.scores
    : [
      { label: 'Answer Quality', value: report.answer_quality_score },
      { label: 'Communication', value: report.communication_score },
      { label: 'Speech Fluency', value: report.speech_fluency_score ?? report.voice_confidence_score },
      { label: 'Camera Engagement', value: report.camera_engagement_score },
    ];
  // With no substantive answers, Speech Fluency stays in the list as "—".
  return scores.filter((score) => (score.value !== null && score.value !== undefined)
    || (report.insufficient_responses && score.label === 'Speech Fluency'));
}

// Read the cached /complete response, but only for the interview requested.
function readCachedReport(interviewId) {
  const cached = localStorage.getItem(STORAGE_KEYS.latestReport);
  if (!cached) return null;
  try {
    const data = JSON.parse(cached);
    return data?.interview_id === interviewId ? data : null;
  } catch {
    localStorage.removeItem(STORAGE_KEYS.latestReport);
    return null;
  }
}

// Score bands shown on the overall scale.
const BANDS = [
  { label: 'Needs work', from: 0, to: 50 },
  { label: 'Developing', from: 50, to: 75 },
  { label: 'Strong', from: 75, to: 101 },
];
const bandFor = (score) => BANDS.find((band) => score >= band.from && score < band.to);

// -------------------------------------------------------------
// BLOCK 2: Presentational sections
// -------------------------------------------------------------
function OverallScore({ score }) {
  const hasScore = typeof score === 'number' && Number.isFinite(score);
  const band = hasScore ? bandFor(score) : null;
  const position = hasScore ? Math.max(0, Math.min(score, 100)) : 0;
  // Start the marker at 0 and let it slide to the score after mount.
  const [markerAt, setMarkerAt] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setMarkerAt(position), 150);
    return () => clearTimeout(timer);
  }, [position]);
  return (
    <div className="flex h-full flex-col">
      <p className="text-[13px] text-ink-3">Overall score</p>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="num font-serif text-[4.5rem] tracking-[-0.03em] leading-[0.85] text-ink">
          {hasScore ? <CountUp value={score} duration={1100} /> : '—'}
        </span>
        <span className="text-lg text-ink-3">/ 100</span>
      </div>
      {band && <p className="mt-3 font-serif text-2xl italic text-ink-2">{band.label}</p>}

      {hasScore && (
        <div className="mt-auto pt-8">
          <div className="relative">
            <div className="flex gap-1">
              {BANDS.map((item) => (
                <span
                  key={item.label}
                  className={`h-1.5 rounded-full ${item === band ? 'bg-ink' : 'bg-line'}`}
                  style={{ width: `${Math.min(item.to, 100) - item.from}%` }}
                />
              ))}
            </div>
            <span
              className="absolute -top-1.5 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-surface bg-ink shadow transition-[left] duration-1000 ease-out"
              style={{ left: `${markerAt}%` }}
              aria-hidden="true"
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-ink-4">
            {BANDS.map((item) => <span key={item.label}>{item.label}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

const CRITERIA = [
  ['correctness', 'Correctness'],
  ['completeness', 'Completeness'],
  ['technical_depth', 'Technical depth'],
  ['relevance', 'Relevance'],
];
const COMPONENT_LABELS = {
  answer_quality: 'Answer quality',
  communication: 'Communication',
  speech_fluency: 'Speech fluency',
  camera_engagement: 'Camera engagement',
};
const present = (value) => value !== null && value !== undefined;

// Questions answered / skipped / completion rate (scoring v3 reports).
function CompletionBlock({ completion }) {
  if (!completion) return null;
  return (
    <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-line pt-5">
      <Figure label="Questions answered" value={`${completion.answered} / ${completion.total}`} />
      <Figure label="Questions skipped" value={completion.skipped} />
      <Figure label="Completion rate" value={`${completion.rate_percent}%`} />
    </dl>
  );
}

// Small "label value" pair used in metric rows.
function Figure({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="num mt-1 font-mono text-[15px] text-ink">{value}</dd>
    </div>
  );
}

function CriteriaPanel({ criteria, i }) {
  const rows = CRITERIA.filter(([key]) => present(criteria?.[key]));
  if (!rows.length) return null;
  return (
    <Panel i={i} as="article" className="p-6">
      <SectionTitle title="Answer criteria" description="Average across every answer, scored by the AI evaluator." />
      <div className="mt-5 space-y-4">
        {rows.map(([key, label], index) => <ProgressBar key={key} label={label} value={criteria[key]} i={index} />)}
      </div>
    </Panel>
  );
}

function DeliveryPanel({ speech, vision, i }) {
  const hasSpeech = speech && speech.answers_with_audio;
  const hasVision = vision && present(vision.answers_with_camera);
  if (!hasSpeech && !hasVision) return null;
  return (
    <Panel i={i} as="article" className="p-6">
      <SectionTitle title="Delivery" description="How the answers were spoken and how you appeared on camera." />
      {hasSpeech ? (
        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label="Pace" value={present(speech.words_per_minute) ? `${speech.words_per_minute} wpm` : '—'} />
          <Figure label="Fillers" value={present(speech.fillers_per_minute) ? `${speech.fillers_per_minute}/min` : '—'} />
          <Figure label="Long pauses" value={speech.long_pauses ?? '—'} />
          <Figure label="Spoken answers" value={speech.answers_with_audio} />
        </dl>
      ) : (
        <p className="mt-4 text-[13px] text-ink-3">Answers were typed, so speech delivery was estimated from filler words in the text.</p>
      )}
      {hasVision && (
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4">
          <Figure label="Screen gaze" value={present(vision.eyeContact) ? `${vision.eyeContact}%` : '—'} />
          <Figure label="Face visible" value={present(vision.facePresence) ? `${vision.facePresence}%` : '—'} />
          <Figure label="Head aligned" value={present(vision.cameraFacing) ? `${vision.cameraFacing}%` : '—'} />
          <Figure label="Extra faces" value={vision.multipleFaceEvents ?? 0} />
        </dl>
      )}
    </Panel>
  );
}

function ScoreMethod({ scoring }) {
  const weights = scoring?.weights;
  if (!weights) return null;
  return (
    <div className="mt-6 border-t border-line pt-5">
      <p className="text-xs font-medium text-ink-2">How this score was calculated</p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
        {Object.entries(weights).map(([name, weight]) => (
          <li key={name}>{COMPONENT_LABELS[name] || name} <span className="num font-mono text-ink">{Math.round(weight * 100)}%</span></li>
        ))}
      </ul>
    </div>
  );
}

// Fetches an owner-only recording on demand and plays it inline.
function Recording({ interviewId, index, kind }) {
  const [url, setUrl] = useState('');
  const [state, setState] = useState('idle');
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (url) {
    return kind === 'video'
      ? <video controls autoPlay src={url} className="fade-in mt-3 max-h-64 w-full rounded-control bg-ink" />
      : <audio controls autoPlay src={url} className="fade-in mt-3 w-full" />;
  }
  return (
    <button
      type="button"
      className="ghost-btn mt-2 !px-2 !py-1 text-xs"
      disabled={state === 'loading'}
      onClick={async () => {
        setState('loading');
        try {
          setUrl(await api.getAnswerMediaUrl(interviewId, index, kind));
        } catch {
          setState('error');
        }
      }}
    >
      {state === 'loading' ? <Spinner className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      {state === 'error' ? 'Recording unavailable' : kind === 'video' ? 'Play recording' : 'Play audio'}
    </button>
  );
}

const clock = (seconds) => {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

// The whole interview as one player, with a jump list per answer. Parts
// (one per page load) are fetched on demand with the owner's token.
function InterviewRecording({ interviewId, parts, turns, playerRef }) {
  const videoRef = useRef(null);
  const urlsRef = useRef({});
  const stopAtRef = useRef(null);
  const [part, setPart] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | ready | error

  useEffect(() => () => Object.values(urlsRef.current).forEach((url) => URL.revokeObjectURL(url)), []);

  const play = useCallback(async (targetPart, start = 0, end = null) => {
    try {
      setState('loading');
      if (!urlsRef.current[targetPart]) {
        urlsRef.current[targetPart] = await api.getRecordingUrl(interviewId, targetPart);
      }
      const video = videoRef.current;
      if (!video) return;
      if (part !== targetPart || !video.src) {
        video.src = urlsRef.current[targetPart];
        await new Promise((resolve) => {
          if (video.readyState >= 1) resolve();
          else video.addEventListener('loadedmetadata', resolve, { once: true });
        });
      }
      setPart(targetPart);
      stopAtRef.current = end;
      video.currentTime = start;
      setState('ready');
      await video.play?.()?.catch?.(() => {});
    } catch {
      setState('error');
    }
  }, [interviewId, part]);

  // Let each journey turn jump here.
  useEffect(() => {
    if (playerRef) playerRef.current = { play };
  }, [playerRef, play]);

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (video && stopAtRef.current !== null && video.currentTime >= stopAtRef.current) {
      video.pause();
      stopAtRef.current = null;
    }
  };

  const chapters = turns.filter((turn) => turn.recording);
  return (
    <Panel i={3} className="overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="relative aspect-video bg-ink">
          <video ref={videoRef} controls playsInline onTimeUpdate={onTimeUpdate} className="h-full w-full" />
          {state !== 'ready' && (
            <div className="absolute inset-0 grid place-items-center text-center text-paper/70">
              {state === 'loading' ? <Spinner className="h-6 w-6" /> : (
                <button type="button" className="btn bg-paper text-ink hover:bg-white" onClick={() => play(parts[0])}>
                  <Play className="h-4 w-4" /> {state === 'error' ? 'Recording unavailable — retry' : 'Play interview recording'}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="p-5">
          <SectionTitle title="Interview recording" description="Jump to any answer." />
          <ol className="mt-3 divide-y divide-line">
            {chapters.map((turn) => (
              <li key={turn.index}>
                <button
                  type="button"
                  onClick={() => play(turn.recording.part, turn.recording.start, turn.recording.end)}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-[13px] text-ink-2 transition hover:text-ink"
                >
                  <span className="min-w-0 truncate">Question {turn.index}{turn.topic ? ` · ${turn.topic}` : ''}</span>
                  <span className="num shrink-0 font-mono text-xs text-ink-3">{clock(turn.recording.start)}</span>
                </button>
              </li>
            ))}
            {parts.length > 1 && <li className="pt-2.5 text-xs text-ink-3">Recorded in {parts.length} parts (the page was reloaded).</li>}
          </ol>
        </div>
      </div>
    </Panel>
  );
}

const INTEGRITY_LEVELS = {
  clean: { label: 'Clean', tone: 'ok', text: 'No integrity issues were recorded.' },
  minor: { label: 'Minor issues', tone: 'warn', text: 'A few events were recorded; review them below.' },
  flagged: { label: 'Flagged', tone: 'bad', text: 'Repeated or serious integrity events were recorded.' },
  review: { label: 'Needs review', tone: 'warn', text: 'Signs of malpractice were found; affected answers were penalised.' },
  invalid: { label: 'Invalid', tone: 'bad', text: 'The candidate\'s identity could not be confirmed throughout, so the interview scores 0.' },
};
const LEAVING = ['fullscreen_exit', 'tab_hidden', 'window_blur'];
const MINOR_EVENTS = ['paste_blocked', 'copy_blocked', 'context_menu', 'devtools_shortcut', 'print_screen'];
const FACE_VERDICTS = {
  mismatch: 'Different person', multiple_faces: 'More than one face', no_face: 'No face', unclear: 'Unclear', uncertain: 'Inconclusive',
};

// Owner-only evidence image, fetched with the ID token.
function IdentityImage({ interviewId, name, label }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let active = true;
    let objectUrl;
    api.getIdentityImageUrl?.(interviewId, name)
      .then((value) => {
        objectUrl = value;
        if (active) setUrl(value);
        else URL.revokeObjectURL(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [interviewId, name]);
  return (
    <figure className="w-28 shrink-0">
      <div className="aspect-[4/3] overflow-hidden rounded-control border border-line bg-sunken">
        {url && <img src={url} alt={label} className="h-full w-full object-cover" />}
      </div>
      <figcaption className="mt-1 text-[11px] leading-tight text-ink-3">{label}</figcaption>
    </figure>
  );
}

function IdentitySection({ integrity, identity, interviewId, playerRef }) {
  const summary = integrity.identity;
  if (!summary && !identity) return null;
  const voice = summary?.voice_checks || {};
  const voiceTotal = Object.values(voice).reduce((total, count) => total + count, 0);
  const face = summary?.face_checks || {};
  const faceTotal = Object.values(face).reduce((total, count) => total + count, 0);
  const flagged = identity?.flagged_checks?.filter((check) => check.image_name) || [];
  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="text-[13px] font-semibold text-ink">Identity</h3>
      {!(summary?.enrolled || identity?.enrolled) ? (
        <p className="mt-2 text-[13px] text-ink-3">Identity was not checked in this interview.</p>
      ) : (
        <>
          <p className="mt-2 text-[13px] text-ink-2">
            {voiceTotal > 0 && `Voice matched in ${voice.match || 0} of ${voiceTotal} spoken answers`}
            {voiceTotal > 0 && faceTotal > 0 && ' · '}
            {faceTotal > 0 && `face matched in ${face.match || 0} of ${faceTotal} camera checks`}
            {summary?.face_mismatch_events ? ` · a different person was confirmed ${summary.face_mismatch_events}×` : ''}
          </p>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {identity?.photo && <IdentityImage interviewId={interviewId} name={identity.photo} label="Enrolment photo" />}
            {flagged.slice(0, 8).map((check) => (
              <button
                key={check.id}
                type="button"
                className="text-left"
                disabled={!playerRef || !check.recording_part || check.at_seconds == null}
                onClick={() => playerRef?.current?.play(check.recording_part, Math.max(0, check.at_seconds - 3))}
              >
                <IdentityImage
                  interviewId={interviewId}
                  name={check.image_name}
                  label={`${FACE_VERDICTS[check.verdict] || check.verdict}${check.at_seconds != null ? ` · ${clock(check.at_seconds)}` : ''}`}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Proctoring, identity and malpractice: the verdict and the evidence.
function IntegrityPanel({ integrity, events, identity, interviewId, playerRef, i }) {
  if (!integrity) return null;
  const level = INTEGRITY_LEVELS[integrity.verdict] || INTEGRITY_LEVELS[integrity.level] || INTEGRITY_LEVELS.minor;
  const counts = integrity.counts || {};
  const blocked = MINOR_EVENTS.reduce((total, type) => total + (counts[type] || 0), 0);
  const penalised = (integrity.answers_zeroed || 0) + (integrity.answers_capped || 0);
  const left = LEAVING.reduce((total, type) => total + (counts[type] || 0), 0);
  return (
    <Panel i={i} className="p-6 sm:p-7">
      <SectionTitle
        title="Integrity"
        description="Identity checks, other people or devices in view, other voices, reading detection and leaving the interview."
        action={<Badge tone={level.tone}>{level.label}</Badge>}
      />
      <p className="mt-2 text-[13px] text-ink-2">{level.text}</p>
      {integrity.reasons?.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13px] text-ink-2">
          {integrity.reasons.map((reason) => (
            <li key={reason} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-3" />{reason}</li>
          ))}
        </ul>
      )}
      {integrity.score_before_integrity != null && (integrity.verdict === 'invalid' || penalised > 0) && (
        <p className="mt-3 text-xs text-ink-3">Score before integrity adjustments: <span className="num font-mono text-ink">{integrity.score_before_integrity}</span></p>
      )}
      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label="Integrity warnings" value={`${integrity.violations ?? 0}×`} />
        <Figure label="Left the interview" value={`${left}× · ${Math.round(integrity.time_away_seconds || 0)} s`} />
        <Figure label="Answers penalised" value={penalised} />
        <Figure label="Blocked actions" value={blocked} />
        <Figure label="Gaze warnings" value={`${integrity.gaze_warnings ?? 0}×`} />
      </dl>
      <IdentitySection integrity={integrity} identity={identity} interviewId={interviewId} playerRef={playerRef} />
      {events?.length > 0 && (
        <ol className="mt-5 divide-y divide-line border-t border-line">
          {events.map((event, index) => (
            <li key={index} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]">
              <span className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${event.major ? 'bg-bad' : 'bg-warn'}`} />
                <span className="text-ink">{event.label}</span>
                {event.question_index && <span className="text-ink-3">· question {event.question_index}</span>}
                {event.duration_seconds != null && event.major && <span className="text-ink-3">· {Math.round(event.duration_seconds)} s</span>}
              </span>
              {playerRef && event.recording_part && event.at_seconds != null ? (
                <button type="button" className="num font-mono text-xs text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
                  onClick={() => playerRef.current?.play(event.recording_part, Math.max(0, event.at_seconds - 3))}>
                  {clock(event.at_seconds)}
                </button>
              ) : event.at_seconds != null && <span className="num font-mono text-xs text-ink-3">{clock(event.at_seconds)}</span>}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

const LANGUAGE_LABELS = { python: 'Python', javascript: 'JavaScript', cpp: 'C++', java: 'Java' };

const PENALTY_TEXT = {
  zero: 'Scored 0: another person appears to have given this answer.',
  cap: 'Capped at 40: this answer showed signs of assistance.',
};

function TurnIntegrity({ integrity }) {
  const flags = integrity?.flags || [];
  if (!flags.length) return null;
  return (
    <div className="mt-3 rounded-control border border-line bg-paper p-3">
      <div className="flex flex-wrap gap-1.5">
        {flags.map((flag) => (
          <Badge key={flag.code} tone={flag.severity === 'review' ? 'warn' : 'bad'}>{flag.label}</Badge>
        ))}
      </div>
      {PENALTY_TEXT[integrity.action] && (
        <p className="mt-2 text-xs text-bad">
          {PENALTY_TEXT[integrity.action]}
          {integrity.original_score != null && ` Graded ${integrity.original_score}/100 before the adjustment.`}
        </p>
      )}
      {flags.filter((flag) => flag.detail).map((flag) => (
        <p key={`${flag.code}-detail`} className="mt-1 text-xs leading-relaxed text-ink-3">{flag.detail}</p>
      ))}
    </div>
  );
}

function TurnDetails({ turn, interviewId, playerRef }) {
  const criteria = turn.evaluation?.criteria_scores;
  const skipped = turn.evaluation?.evaluation_source === 'skipped';
  const criteriaRows = skipped ? [] : CRITERIA.filter(([key]) => present(criteria?.[key]));
  const speech = turn.speech_metrics;
  const vision = turn.vision_metrics;
  const codingResult = turn.coding_result;
  return (
    <>
      {codingResult && (
        <div className="mt-2 space-y-1 text-xs text-ink-3">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><Code2 className="h-3 w-3" /> {LANGUAGE_LABELS[codingResult.language] || codingResult.language}</span>
            <span className="num font-mono text-ink">{codingResult.passed}/{codingResult.total} tests passed</span>
            <span>{codingResult.examples_passed} examples · {codingResult.hidden_passed} hidden</span>
            {codingResult.complexity && <span>{codingResult.complexity}</span>}
            {codingResult.review_score != null && <span>Code review {codingResult.review_score}/100</span>}
          </p>
          {!codingResult.compiled && <p className="text-warn">The code did not compile.</p>}
        </div>
      )}
      {criteriaRows.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
          {criteriaRows.map(([key, label]) => (
            <span key={key}>{label} <span className="num font-mono text-ink">{criteria[key]}</span></span>
          ))}
        </p>
      )}
      {(speech || turn.transcript_source) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
          <span className="inline-flex items-center gap-1"><Mic className="h-3 w-3" /> Spoken answer</span>
          {present(speech?.words_per_minute) && <span>{speech.words_per_minute} wpm</span>}
          {present(speech?.filler_count) && <span>{speech.filler_count} fillers</span>}
          {present(speech?.long_pauses) && <span>{speech.long_pauses} long pauses</span>}
        </p>
      )}
      {vision && present(vision.eyeContact) && (
        <p className="mt-1 text-xs text-ink-3">
          Screen gaze {vision.eyeContact}%
          {present(vision.facePresence) && ` · face visible ${vision.facePresence}%`}
          {vision.multipleFaceEvents ? ` · another face appeared ${vision.multipleFaceEvents}×` : ''}
        </p>
      )}
      {turn.answer && (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-xs text-ink-2 transition hover:text-ink">
            <span className="group-open:hidden">Show your answer</span>
            <span className="hidden group-open:inline">Hide your answer</span>
          </summary>
          {codingResult ? (
            <pre className="mt-2 max-h-80 overflow-auto rounded-control border border-line bg-paper p-3 font-mono text-[12px] leading-relaxed text-ink-2">{turn.answer}</pre>
          ) : (
            <p className="mt-2 whitespace-pre-line rounded-control border border-line bg-paper p-3 text-[13px] leading-relaxed text-ink-2">{turn.answer}</p>
          )}
        </details>
      )}
      {turn.transcript_source && present(criteria?.relevance) && criteria.relevance < 35 && (
        <p className="mt-2 text-xs text-warn">This answer looked unrelated to the question; background speech may have been picked up.</p>
      )}
      {turn.recording && playerRef ? (
        <button
          type="button"
          className="ghost-btn mt-2 !px-2 !py-1 text-xs"
          onClick={() => playerRef.current?.play(turn.recording.part, turn.recording.start, turn.recording.end)}
        >
          <Play className="h-3.5 w-3.5" /> Play this answer
        </button>
      ) : interviewId && (turn.has_video || turn.has_audio) && (
        <Recording interviewId={interviewId} index={turn.index} kind={turn.has_video ? 'video' : 'audio'} />
      )}
    </>
  );
}

function AdaptiveJourney({ turns, interviewId, playerRef }) {
  return (
    <Panel i={3} className="p-6 sm:p-8">
      <SectionTitle
        title="Adaptive Interview Journey"
        description="How each answer moved the interview: difficulty, follow-ups, score and what the system decided next."
      />
      <ol className="relative mt-7 space-y-8 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-line">
        {turns.map((turn, index) => (
          <li key={turn.response_id || turn.index || index} className="reveal relative pl-10" style={{ '--i': index + 4 }}>
            <span className="num absolute left-0 top-0 grid h-6 w-6 place-items-center rounded-full border border-line-strong bg-surface font-mono text-[11px] text-ink-2">
              {turn.index || index + 1}
            </span>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-ink-3">Question {turn.index || index + 1}</span>
              {turn.difficulty && <Badge>{capitalize(turn.difficulty)}</Badge>}
              {turn.is_follow_up && <Badge tone="ink">AI Follow-up</Badge>}
              {turn.evaluation?.evaluation_source === 'skipped' && <Badge tone="warn">Skipped</Badge>}
              {turn.topic && <span className="text-ink-3">{turn.topic}</span>}
            </div>
            <h3 className="mt-2 font-serif text-xl leading-snug text-ink">{turn.kind === 'coding' && turn.coding_title ? `Coding: ${turn.coding_title}` : turn.question}</h3>
            {turn.evaluation?.answer_quality_score != null && (
              <p className="num mt-3 font-mono text-[13px] text-ink">
                Technical score: {turn.integrity?.adjusted_score ?? turn.evaluation.answer_quality_score}/100
              </p>
            )}
            <TurnIntegrity integrity={turn.integrity} />
            <TurnDetails turn={turn} interviewId={interviewId} playerRef={playerRef} />
            {turn.evaluation?.feedback && <p className="mt-3 text-sm leading-relaxed text-ink-2">{turn.evaluation.feedback}</p>}
            {turn.evaluation?.evaluation_source === 'fallback' && (
              <p className="mt-2 text-xs text-warn">Approximate score: the AI evaluator was unavailable for this answer.</p>
            )}
            {turn.adaptation?.reason && (
              <p className="mt-3 border-l-2 border-line-strong pl-3 text-[13px] text-ink-3">Adaptation: {turn.adaptation.reason}</p>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function FeedbackList({ title, items, positive, i }) {
  const Icon = positive ? Plus : Minus;
  return (
    <Panel i={i} as="article" className="p-6">
      <SectionTitle title={title} />
      {items.length ? (
        <ul className="mt-4 divide-y divide-line">
          {items.map((item, index) => (
            <li key={index} className="flex gap-3 py-3 text-sm leading-relaxed text-ink-2">
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${positive ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>
                <Icon className="h-3 w-3" strokeWidth={2.5} />
              </span>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-3">Not enough data yet.</p>
      )}
    </Panel>
  );
}

// -------------------------------------------------------------
// BLOCK 3: Page
// -------------------------------------------------------------
// The interview comes from ?id=<uuid> (links from the Dashboard) or, after
// finishing an interview, from the id saved in localStorage.
export default function Report() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedId = searchParams.get('id');
  const interviewId = requestedId || localStorage.getItem(STORAGE_KEYS.interviewId);
  const localJourney = readInterviewJourney(interviewId);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const playerRef = useRef(null);
  const [error, setError] = useState('');

  // Show the cached report instantly, then replace it with the saved one.
  useEffect(() => {
    let active = true;
    const cached = readCachedReport(interviewId);
    if (cached) setReport(cached);
    if (!interviewId) {
      setLoading(false);
      return () => { active = false; };
    }
    api.getReport(interviewId)
      .then((data) => { if (active) setReport(data); })
      .catch(() => {
        if (active && !cached) setError('We could not load this report. Return to the dashboard and try again.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [interviewId]);

  if (loading && !report) {
    return <LoadingBlock label="Loading evaluation report…" className="min-h-[50vh]" />;
  }

  if (!report) {
    return (
      <Panel className="mx-auto max-w-xl">
        <EmptyState
          icon={AlertTriangle}
          title="Report unavailable"
          headingLevel="h1"
          action={<button onClick={() => navigate('/dashboard')} className="primary-btn">Back to Dashboard</button>}
        >
          {error || 'Complete an interview to generate a performance report.'}
        </EmptyState>
      </Panel>
    );
  }

  // The server's turns carry transcripts, criteria and delivery metrics;
  // this browser's local copy is only used until they are available.
  const serverTurns = Array.isArray(report.turns) ? report.turns : [];
  const recordingParts = Array.isArray(report.recording_parts) ? report.recording_parts : [];
  const journey = serverTurns.length ? serverTurns : localJourney;
  const scores = scoreList(report);
  const strengths = Array.isArray(report.strengths) ? report.strengths : [];
  const improvements = Array.isArray(report.improvements) ? report.improvements : [];
  const targetRole = report.role_title
    || (!requestedId && localStorage.getItem(STORAGE_KEYS.roleTitle))
    || 'Selected role';
  const summary = report.summary_feedback || report.feedback || 'No summary feedback is available for this report.';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        kicker="Saved evaluation report"
        title="Interview Performance Report"
        description={`Saved answer evaluation and observable camera-engagement signals for ${targetRole}${report.answer_mode === 'voice' ? ' · spoken interview' : ''}.`}
        actions={(
          <button onClick={() => navigate('/dashboard')} className="secondary-btn">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </button>
        )}
      />

      {report.integrity?.verdict === 'invalid' && (
        <Notice tone="bad">
          This interview is invalid: the candidate&apos;s identity could not be confirmed throughout, so the overall score is 0. See Integrity below.
        </Notice>
      )}
      {(report.ended_early || report.integrity?.ended_early) && (
        <Notice tone="bad">
          This interview ended early after repeated integrity warnings. Unanswered questions earn no credit.
        </Notice>
      )}

      {report.insufficient_responses && (
        <Notice tone="warn">
          Insufficient substantive responses were provided to evaluate interview performance.
        </Notice>
      )}

      <Panel i={1} className="grid overflow-hidden md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="border-b border-line p-6 sm:p-8 md:border-b-0 md:border-r">
          <OverallScore score={report.overall_score ?? report.overallScore} />
        </div>
        <div className="p-6 sm:p-8">
          <SectionTitle title="Evaluation Breakdown" description="Answer quality, communication, speech fluency and camera engagement." />
          <div className="mt-6 space-y-5">
            {scores.map((score, index) => <ProgressBar key={score.label} {...score} i={index} />)}
          </div>
          <CompletionBlock completion={report.completion} />
          <ScoreMethod scoring={report.scoring} />
          <p className="mt-5 text-xs leading-relaxed text-ink-3">
            Scores summarise this practice session; they are not hiring decisions. Camera engagement is an observable
            approximation, and when the camera model was unavailable it is left out and the other parts are re-weighted.
          </p>
        </div>
      </Panel>

      <Panel i={2} className="p-6 sm:p-8">
        <p className="text-[13px] text-ink-3">Summary Feedback</p>
        <blockquote className="mt-3 font-serif text-[1.4rem] leading-snug text-ink">“{summary}”</blockquote>
      </Panel>

      {(report.criteria_scores || report.speech_metrics || report.vision_metrics?.answers_with_camera) && (
        <section className="grid gap-5 lg:grid-cols-2">
          {!report.insufficient_responses && <CriteriaPanel criteria={report.criteria_scores} i={3} />}
          <DeliveryPanel speech={report.speech_metrics} vision={report.vision_metrics} i={3} />
        </section>
      )}

      <IntegrityPanel
        integrity={report.integrity}
        events={report.proctoring_events}
        identity={report.identity}
        interviewId={report.interview_id || interviewId}
        playerRef={recordingParts.length > 0 ? playerRef : null}
        i={3}
      />

      {recordingParts.length > 0 && (
        <InterviewRecording interviewId={report.interview_id || interviewId} parts={recordingParts} turns={journey} playerRef={playerRef} />
      )}

      {journey.length > 0 && (
        <AdaptiveJourney
          turns={journey}
          interviewId={report.interview_id || interviewId}
          playerRef={recordingParts.length > 0 ? playerRef : null}
        />
      )}

      <section className="grid gap-5 lg:grid-cols-2">
        <FeedbackList title="Key Strengths" items={strengths} positive i={4} />
        <FeedbackList title="Areas to Improve" items={improvements} i={5} />
      </section>
    </div>
  );
}
