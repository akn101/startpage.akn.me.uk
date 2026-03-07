"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";

const MODEL_URL        = "/models";
const MOTION_POLL_MS   = 500;
const MOTION_THRESHOLD = 35;
const MOTION_MIN_PCT   = 0.04;
const CAPTURE_COOLDOWN = 8_000;
const MATCH_THRESHOLD  = 0.55;           // face descriptor distance
const DESCRIPTORS_KEY  = "face_descriptors";

/** Returns fraction of pixels that changed significantly between two frames */
function motionScore(prev: ImageData, curr: ImageData): number {
  let changed = 0;
  const total = prev.data.length / 4;
  for (let i = 0; i < prev.data.length; i += 4) {
    const dr = Math.abs(prev.data[i]   - curr.data[i]);
    const dg = Math.abs(prev.data[i+1] - curr.data[i+1]);
    const db = Math.abs(prev.data[i+2] - curr.data[i+2]);
    if ((dr + dg + db) / 3 > MOTION_THRESHOLD) changed++;
  }
  return changed / total;
}

function captureJpeg(video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  canvas.width  = video.videoWidth  || 320;
  canvas.height = video.videoHeight || 240;
  ctx.drawImage(video, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.7);
}

/** Load stored face descriptors from localStorage */
function loadStoredDescriptors(): { label: string; descriptors: Float32Array[] }[] {
  try {
    const raw = localStorage.getItem(DESCRIPTORS_KEY);
    if (!raw) return [];
    const parsed: { label: string; descriptors: number[][] }[] = JSON.parse(raw);
    return parsed.map((e) => ({
      label: e.label,
      descriptors: e.descriptors.map((d) => new Float32Array(d)),
    }));
  } catch {
    return [];
  }
}

/** Save a new descriptor for a label to localStorage (keep up to 10 per label) */
function saveDescriptor(label: string, descriptor: Float32Array) {
  const stored = loadStoredDescriptors();
  const entry = stored.find((e) => e.label === label);
  if (entry) {
    entry.descriptors = [...entry.descriptors, descriptor].slice(-10);
  } else {
    stored.push({ label, descriptors: [descriptor] });
  }
  const serialised = stored.map((e) => ({
    label: e.label,
    descriptors: e.descriptors.map((d) => Array.from(d)),
  }));
  localStorage.setItem(DESCRIPTORS_KEY, JSON.stringify(serialised));
}

export default function CameraMonitor({ enabled = true }: { enabled?: boolean }) {
  const { authenticated } = useAuth();
  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const prevFrameRef = useRef<ImageData | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const modelLoaded  = useRef(false);
  const lastCapture  = useRef(0);

  useEffect(() => {
    if (!authenticated || !enabled) return;

    let pollId: ReturnType<typeof setInterval>;

    async function init() {
      const faceapi = await import("@vladmandic/face-api");

      if (!modelLoaded.current) {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        modelLoaded.current = true;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 320, height: 240 },
        });
      } catch {
        return; // camera denied — silent
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});

      const scratch = document.createElement("canvas");
      scratch.width  = 80;
      scratch.height = 60;
      const sctx = scratch.getContext("2d")!;

      const poll = async () => {
        if (document.hidden || !video || !canvasRef.current) return;

        sctx.drawImage(video, 0, 0, 80, 60);
        const curr = sctx.getImageData(0, 0, 80, 60);
        const prev = prevFrameRef.current;
        prevFrameRef.current = curr;
        if (!prev) return;

        const score = motionScore(prev, curr);
        const now   = Date.now();
        if (score < MOTION_MIN_PCT || now - lastCapture.current <= CAPTURE_COOLDOWN) return;

        lastCapture.current = now;

        // Run full face detection with landmarks + descriptors
        const detections = await faceapi
          .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptors();

        let label: string;

        if (detections.length === 0) {
          label = "motion";
        } else {
          // Try to match against stored descriptors
          const stored = loadStoredDescriptors();
          if (stored.length > 0) {
            const labeledDescriptors = stored.map(
              (e) => new faceapi.LabeledFaceDescriptors(e.label, e.descriptors)
            );
            const matcher = new faceapi.FaceMatcher(labeledDescriptors, MATCH_THRESHOLD);
            const best    = matcher.findBestMatch(detections[0].descriptor);
            label = best.label === "unknown" ? "Unknown Visitor" : best.label;
          } else {
            // No stored reference yet — assume it's Ahnaf Kabir (first-time)
            label = "Ahnaf Kabir";
          }

          // Always save descriptor back to reinforce recognition
          saveDescriptor(label, detections[0].descriptor);
        }

        const imageData = captureJpeg(video, canvasRef.current);
        fetch("/api/visitors/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageData, faceLabel: label }),
        }).catch(() => {});
      };

      pollId = setInterval(poll, MOTION_POLL_MS);
    }

    init();

    return () => {
      clearInterval(pollId);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [authenticated, enabled]);

  return (
    <>
      <video ref={videoRef} style={{ display: "none" }} muted playsInline />
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </>
  );
}
