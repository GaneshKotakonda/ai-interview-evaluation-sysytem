const VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let landmarkerPromise;

function scoreToPercent(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function average(...values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function categoryMap(categories = []) {
  return new Map(categories.map((item) => [item.categoryName, item.score]));
}

async function createLandmarker(delegate = 'GPU') {
  const { FaceLandmarker, FilesetResolver } = await import(/* @vite-ignore */ VISION_CDN);
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);

  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate,
    },
    runningMode: 'VIDEO',
    numFaces: 2,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
}

export async function getFaceLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = createLandmarker('GPU').catch(async () => createLandmarker('CPU'));
  }
  return landmarkerPromise;
}

function estimateHeadPose(landmarks) {
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const nose = landmarks[1];

  if (!leftEye || !rightEye || !nose) {
    return { yaw: 0, pitch: 0, centered: false };
  }

  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const eyeMidY = (leftEye.y + rightEye.y) / 2;
  const eyeDistance = Math.max(Math.abs(rightEye.x - leftEye.x), 0.001);

  const yaw = (nose.x - eyeMidX) / eyeDistance;
  const pitch = (nose.y - eyeMidY) / eyeDistance;

  // These thresholds are deliberately broad: they are behavioural indicators,
  // not biometric identification or a clinical measurement.
  return {
    yaw,
    pitch,
    centered: Math.abs(yaw) < 0.45 && pitch > 0.65 && pitch < 1.7,
  };
}

function estimateEyeContact(landmarks, blendshapeScores) {
  const left = landmarks[33];
  const right = landmarks[263];
  const nose = landmarks[1];

  if (!left || !right || !nose) return false;

  const head = estimateHeadPose(landmarks);
  const eyeLeftIn = blendshapeScores.get('eyeLookInLeft') || 0;
  const eyeLeftOut = blendshapeScores.get('eyeLookOutLeft') || 0;
  const eyeLeftUp = blendshapeScores.get('eyeLookUpLeft') || 0;
  const eyeLeftDown = blendshapeScores.get('eyeLookDownLeft') || 0;
  const eyeRightIn = blendshapeScores.get('eyeLookInRight') || 0;
  const eyeRightOut = blendshapeScores.get('eyeLookOutRight') || 0;
  const eyeRightUp = blendshapeScores.get('eyeLookUpRight') || 0;
  const eyeRightDown = blendshapeScores.get('eyeLookDownRight') || 0;

  const horizontalGaze = average(
    eyeLeftIn,
    eyeLeftOut,
    eyeRightIn,
    eyeRightOut,
  );
  const verticalGaze = average(
    eyeLeftUp,
    eyeLeftDown,
    eyeRightUp,
    eyeRightDown,
  );

  return head.centered && horizontalGaze < 0.3 && verticalGaze < 0.3;
}

function classifyExpression(blendshapeScores) {
  const smile = average(
    blendshapeScores.get('mouthSmileLeft') || 0,
    blendshapeScores.get('mouthSmileRight') || 0,
  );
  const jawOpen = blendshapeScores.get('jawOpen') || 0;
  const browDown = average(
    blendshapeScores.get('browDownLeft') || 0,
    blendshapeScores.get('browDownRight') || 0,
  );
  const eyeWide = average(
    blendshapeScores.get('eyeWideLeft') || 0,
    blendshapeScores.get('eyeWideRight') || 0,
  );

  if (smile > 0.45) return 'smiling';
  if (jawOpen > 0.55 && eyeWide > 0.35) return 'surprised';
  if (browDown > 0.42) return 'focused';
  return 'neutral';
}

export function analyzeFaceResult(result) {
  const faces = result?.faceLandmarks || [];

  if (!faces.length) {
    return {
      faceCount: 0,
      facePresent: false,
      eyeContact: false,
      headCentered: false,
      expression: 'no-face',
    };
  }

  const primaryLandmarks = faces[0];
  const blendshapeCategories = result.faceBlendshapes?.[0]?.categories || [];
  const scores = categoryMap(blendshapeCategories);
  const head = estimateHeadPose(primaryLandmarks);

  return {
    faceCount: faces.length,
    facePresent: true,
    eyeContact: estimateEyeContact(primaryLandmarks, scores),
    headCentered: head.centered,
    expression: classifyExpression(scores),
  };
}

export function metricsSnapshot(stats) {
  const observed = Math.max(stats.observedMs, 1);
  const present = stats.facePresentMs / observed;
  const eyeContact = stats.eyeContactMs / Math.max(stats.facePresentMs, 1);
  const headCentered = stats.headCenteredMs / Math.max(stats.facePresentMs, 1);

  return {
    facePresence: scoreToPercent(present),
    eyeContact: scoreToPercent(eyeContact),
    cameraFacing: scoreToPercent(headCentered),
    lookingAway: scoreToPercent(1 - eyeContact),
    multipleFaceEvents: stats.multipleFaceEvents,
    framesAnalyzed: stats.framesAnalyzed,
    expressions: {
      neutral: scoreToPercent(stats.expressionMs.neutral / observed),
      smiling: scoreToPercent(stats.expressionMs.smiling / observed),
      focused: scoreToPercent(stats.expressionMs.focused / observed),
      surprised: scoreToPercent(stats.expressionMs.surprised / observed),
      noFace: scoreToPercent(stats.expressionMs['no-face'] / observed),
    },
    analysis: {
      method: 'MediaPipe Face Landmarker',
      version: '1.0.1',
      note: 'Behavioural estimates from face landmarks and blendshape signals. Not a psychological or biometric assessment.',
    },
  };
}

export function createVisionStats() {
  return {
    observedMs: 0,
    facePresentMs: 0,
    eyeContactMs: 0,
    headCenteredMs: 0,
    multipleFaceEvents: 0,
    framesAnalyzed: 0,
    expressionMs: {
      neutral: 0,
      smiling: 0,
      focused: 0,
      surprised: 0,
      'no-face': 0,
    },
  };
}
