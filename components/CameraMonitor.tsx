"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { saveClip } from "@/lib/clip-store";

const MODEL_URL        = "/models";
const MOTION_POLL_MS   = 500;
const MOTION_THRESHOLD = 35;
const MOTION_MIN_PCT   = 0.04;
const CAPTURE_COOLDOWN = 8_000;
const MATCH_THRESHOLD  = 0.55;
const DESCRIPTORS_KEY  = "face_descriptors";
const MOTION_UPLOAD_DELAY = 30_000; // Upload motion-only after 30s if no face detected

// 10 seconds of 1-second chunks = 10 chunks pre-event
const PRE_BUFFER_CHUNKS  = 10;
const POST_BUFFER_CHUNKS = 10;

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

/** Strip Cluster elements from a WebM header chunk, keeping only EBML+Segment metadata */
async function extractWebMMetadata(headerBlob: Blob): Promise<Blob> {
  const buf = new Uint8Array(await headerBlob.arrayBuffer());
  // Cluster element ID: 0x1F 0x43 0xB6 0x75
  for (let i = 4; i < buf.length - 4; i++) {
    if (buf[i] === 0x1F && buf[i+1] === 0x43 && buf[i+2] === 0xB6 && buf[i+3] === 0x75) {
      return new Blob([buf.slice(0, i)], { type: headerBlob.type });
    }
  }
  return headerBlob; // no cluster found, return as-is
}

function captureJpeg(video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Smaller resolution for faster uploads (160x120 instead of 320x240 = 75% less data)
  canvas.width  = 160;
  canvas.height = 120;
  ctx.drawImage(video, 0, 0, 160, 120);
  // More aggressive compression (0.5 instead of 0.7 = ~50% smaller files)
  return canvas.toDataURL("image/jpeg", 0.5);
}

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

function saveDescriptor(label: string, descriptor: Float32Array) {
  const stored = loadStoredDescriptors();
  const entry = stored.find((e) => e.label === label);
  if (entry) {
    entry.descriptors = [...entry.descriptors, descriptor].slice(-10);
  } else {
    stored.push({ label, descriptors: [descriptor] });
  }
  localStorage.setItem(DESCRIPTORS_KEY, JSON.stringify(
    stored.map((e) => ({ label: e.label, descriptors: e.descriptors.map((d) => Array.from(d)) }))
  ));
}

// Store visitor image locally in IndexedDB
async function storeVisitorLocally(imageData: string, faceLabel: string, timestamp: number) {
  const dbName = "visitors_db";
  const storeName = "captures";

  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);

    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);

      store.add({
        id: crypto.randomUUID(),
        timestamp,
        faceLabel,
        imageData,
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(storeName)) {
        const store = db.createObjectStore(storeName, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("faceLabel", "faceLabel", { unique: false });
      }
    };
  });
}

// Upload to cloud for multi-device access
async function uploadToCloud(imageData: string, faceLabel: string) {
  return fetch("/api/visitors/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageData, faceLabel }),
  });
}

export default function CameraMonitor({ enabled = true }: { enabled?: boolean }) {
  const { authenticated } = useAuth();
  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const prevFrameRef  = useRef<ImageData | null>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const modelLoaded   = useRef(false);
  const lastCapture   = useRef(0);
  const pendingMotionRef = useRef<{ imageData: string; timestamp: number } | null>(null);
  const lastFaceTimeRef  = useRef(Date.now());

  // Clip buffering refs
  const recorderRef        = useRef<MediaRecorder | null>(null);
  const headerChunkRef     = useRef<Blob | null>(null);
  const preBufferRef       = useRef<Blob[]>([]);
  const capturingPostRef   = useRef(false);
  const postBufferRef      = useRef<Blob[]>([]);
  const captureTimestampRef = useRef(0);
  const captureLabelRef    = useRef("");
  const mimeTypeRef        = useRef("video/webm");
  const stoppingRef        = useRef(false); // ignore final chunk on teardown

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

      // ── MediaRecorder for clip buffering ─────────────────────────
      const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
        .find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
      mimeTypeRef.current = mimeType;

      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      stoppingRef.current = false;
      let isFirstChunk = true;

      recorder.ondataavailable = (e) => {
        if (stoppingRef.current || !e.data || e.data.size === 0) return;

        // First chunk = EBML header + Tracks — keep separate, don't ring-buffer it
        if (isFirstChunk) {
          headerChunkRef.current = e.data;
          isFirstChunk = false;
          return;
        }

        if (capturingPostRef.current) {
          postBufferRef.current.push(e.data);
          if (postBufferRef.current.length >= POST_BUFFER_CHUNKS) {
            capturingPostRef.current = false;
            // Assemble and save clip asynchronously
            const header = headerChunkRef.current;
            const preBufs = [...preBufferRef.current];
            const postBufs = [...postBufferRef.current];
            postBufferRef.current = [];
            if (header) {
              extractWebMMetadata(header).then((metadata) => {
                const blob = new Blob(
                  [metadata, ...preBufs, ...postBufs],
                  { type: mimeType },
                );
                saveClip({
                  id: crypto.randomUUID(),
                  timestamp: captureTimestampRef.current,
                  faceLabel: captureLabelRef.current,
                  blob,
                }).catch(() => {});
              });
            }
          }
        } else {
          // Keep a rolling window of the last PRE_BUFFER_CHUNKS chunks
          preBufferRef.current.push(e.data);
          if (preBufferRef.current.length > PRE_BUFFER_CHUNKS) {
            preBufferRef.current.shift();
          }
        }
      };

      recorder.start(1_000); // 1-second chunks
      // ─────────────────────────────────────────────────────────────

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

        const detections = await faceapi
          .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptors();

        const imageData = captureJpeg(video, canvasRef.current);
        if (!imageData) return;

        let label: string;

        if (detections.length === 0) {
          // Motion without face - queue for delayed upload
          lastFaceTimeRef.current = now;
          pendingMotionRef.current = { imageData, timestamp: now };
          label = "motion";

          // Upload after 30s if no face detected in the meantime
          setTimeout(() => {
            const pending = pendingMotionRef.current;
            if (pending && pending.timestamp === now && Date.now() - lastFaceTimeRef.current >= MOTION_UPLOAD_DELAY) {
              storeVisitorLocally(pending.imageData, "motion", pending.timestamp).catch(() => {});
              uploadToCloud(pending.imageData, "motion").catch(() => {});
              pendingMotionRef.current = null;
            }
          }, MOTION_UPLOAD_DELAY);

          return;
        }

        // Face detected - cancel any pending motion upload and proceed
        lastFaceTimeRef.current = now;
        pendingMotionRef.current = null;

        {
          const stored = loadStoredDescriptors();
          if (stored.length > 0) {
            const labeledDescriptors = stored.map(
              (e) => new faceapi.LabeledFaceDescriptors(e.label, e.descriptors)
            );
            const matcher = new faceapi.FaceMatcher(labeledDescriptors, MATCH_THRESHOLD);
            const best    = matcher.findBestMatch(detections[0].descriptor);
            label = best.label === "unknown" ? "Unknown Visitor" : best.label;
          } else {
            label = "Ahnaf Kabir";
          }
          saveDescriptor(label, detections[0].descriptor);
        }

        // Trigger clip capture (post-buffer starts accumulating)
        if (!capturingPostRef.current) {
          captureTimestampRef.current = now;
          captureLabelRef.current     = label;
          postBufferRef.current       = [];
          capturingPostRef.current    = true;
        }

        // Store locally AND upload to cloud for multi-device access
        storeVisitorLocally(imageData, label, now).catch(() => {});
        uploadToCloud(imageData, label).catch(() => {});
      };

      pollId = setInterval(poll, MOTION_POLL_MS);
    }

    init();

    return () => {
      clearInterval(pollId);
      stoppingRef.current = true;
      recorderRef.current?.stop();
      recorderRef.current = null;
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
